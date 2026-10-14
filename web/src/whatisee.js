// What I see (docs/ANALYST.md, built 14 Oct during the sale): every Face reads itself from the chain and tells its
// holder, in plain words, what it carries, how those prices moved, what trading costs, what happened to it, and what
// could hurt it (the scam guard). Plus two pages for anyone: /market (every token a basket can carry) and /check
// (a link, an address, a transaction or a signature request, before you click or sign).
// Facts only: the words come from analysis.js and guard.js, the numbers from Chainlink, Uniswap and the Face's events.
import { parseAbi, parseAbiItem, encodePacked, getAddress } from "viem";
import { state, read, readAt } from "./chain.js";
import { tokenList, route, describeStrategy, TRADER } from "./actions.js";
import { logs, when, openApprovals } from "./journal.js";
import { feedOf, priceHistory, latestPrice } from "./value.js";
import { DAY, digest, footer, marketRow, utc, wordingProblems } from "./analysis.js";
import { knownFrom, check, addressFacts } from "./guard.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
// Uniswap's QuoterV2 (config/trader.<chain>.json, from the official Uniswap registry): quotes are eth_calls, nothing is sent
const QUOTER = { 4663: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7" }; // lowercase: the mixed case in the config fails its checksum
const QUOTER_ABI = parseAbi(["function quoteExactInput(bytes path, uint256 amountIn) view returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksList, uint256 gasEstimate)"]);
const EV = {
  seeded: parseAbiItem("event FaceSeeded(uint256 indexed tokenId, address indexed account, uint32 indexed basketId)"),
  upgraded: parseAbiItem("event FaceUpgraded(uint256 indexed tokenId, address indexed account, uint8 tier, uint32 indexed basketId)"),
  bonus: parseAbiItem("event SetBonusPaidTo(uint256 indexed setId, uint256 indexed anchorId, address indexed account, uint32 basketId)"),
  agentSet: parseAbiItem("event AgentSet(address indexed agent, address indexed grantor, uint64 expiry, uint64 epoch, uint256 valueAllowance)"),
  perms: parseAbiItem("event AgentPermissionsUpdated(uint64 indexed epoch, (address target, bytes4 selector)[] permissions, bool allowed)"),
  approvalForAll: parseAbiItem("event ApprovalForAll(address indexed owner, address indexed operator, bool approved)"),
};
const NAMES = parseAbi(["function name() view returns (string)", "function symbol() view returns (string)", "function isApprovedForAll(address, address) view returns (bool)"]);
const SWAP = "0x98e9bbb6"; // swapWithNote: NeonTrader's trade, the output always back into the Face
const TTL = 5 * 60_000;

// Chainlink histories, shared by the Face panel and the market page for a few minutes
const histories = new Map();
function history(token, since) {
  const key = `${token.toLowerCase()}:${Math.floor(since / 3600)}`;
  const hit = histories.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.p;
  const p = feedOf(token).then((f) => (f ? priceHistory(f, since) : []));
  p.catch(() => histories.delete(key));
  histories.set(key, { at: Date.now(), p });
  return p;
}
const priceOf = (token) => (token ? token : tokenList(state.dep).find((t) => t.symbol === "ETH")?.address);
const priceAtT = (points, t) => {
  let v = null;
  for (const [u, p] of points) if (u <= t) v = p;
  return points.length && points[0][0] <= t ? v : null;
};

/** The cost of a $10 trade against USDG, in and out, compared with Chainlink: { into, outOf, fee } or null. */
async function tradeCost(sym, price, usdg) {
  const quoter = QUOTER[state.dep.chain.id];
  const list = tokenList(state.dep);
  const t = list.find((x) => x.symbol === sym);
  const u = list.find((x) => x.symbol === "USDG");
  if (!quoter || !t || !u || !price) return null;
  const enc = (r) => encodePacked(r.path.flatMap((_, i) => (i ? ["uint24", "address"] : ["address"])), r.path.flatMap((a, i) => (i ? [r.fees[i - 1], a] : [a])));
  const out = route(state.dep, t, u);
  const inn = route(state.dep, u, t);
  const decT = sym === "ETH" ? 18 : Number(await readAt(t.address, "erc20", "decimals"));
  const decU = Number(await readAt(u.address, "erc20", "decimals"));
  const amtT = BigInt(Math.round((10 / price) * 10 ** Math.min(decT, 15))) * 10n ** BigInt(Math.max(0, decT - 15));
  const amtU = BigInt(Math.round((10 / usdg) * 10 ** decU));
  const [[gotU], [gotT]] = await Promise.all([
    state.pub.readContract({ address: quoter, abi: QUOTER_ABI, functionName: "quoteExactInput", args: [enc(out), amtT] }),
    state.pub.readContract({ address: quoter, abi: QUOTER_ABI, functionName: "quoteExactInput", args: [enc(inn), amtU] }),
  ]);
  const outValue = (Number(gotU) / 10 ** decU) * usdg;
  const inValue = (Number(gotT) / 10 ** decT) * price;
  return { outOf: 1 - outValue / 10, into: 1 - inValue / 10, fee: out.fees.reduce((s, f) => s + f, 0) / 1e6 };
}

/** The agent in words, with what it may call; `risky` lists permissions that reach beyond NeonTrader's trade. */
async function agentWords(account) {
  const [agent, , expiry, active, allowance] = await readAt(account, "account", "agentConfig");
  if (!active) return { text: null, risky: [] };
  const sets = await logs(account, EV.agentSet, { agent });
  const epoch = sets.at(-1)?.args.epoch;
  const perms = new Map();
  if (epoch != null)
    for (const l of await logs(account, EV.perms, { epoch }))
      for (const p of l.args.permissions) l.args.allowed ? perms.set(`${p.target.toLowerCase()}:${p.selector}`, p) : perms.delete(`${p.target.toLowerCase()}:${p.selector}`);
  const known = knownFrom(state.dep);
  const trader = state.dep.trader.toLowerCase();
  const risky = [...perms.values()].filter((p) => !(p.target.toLowerCase() === trader && p.selector === SWAP));
  const who = state.dep.strategyAgent && agent.toLowerCase() === state.dep.strategyAgent.toLowerCase() ? "The NEONFACES strategy agent" : `Agent ${agent.slice(0, 6)}…${agent.slice(-4)}`;
  const can = [perms.size - risky.length ? "trade through NeonTrader (the output comes back into me)" : null, ...risky.map((p) => `call ${p.selector} on ${known.find((k) => k.address === p.target.toLowerCase())?.name ?? p.target}`)].filter(Boolean);
  return {
    text: `${who} can act for me until ${utc(Number(expiry))}, with ${(Number(allowance) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH to spend${can.length ? `; allowed: ${can.join("; ")}` : ""}. My holder can stop it any time.`,
    risky,
  };
}

/** Tokens and NFTs in the account that NEONFACES doesn't list, from Blockscout's index (not the chain itself):
 *  [{ address, name, symbol, type, scam }] (scam = Blockscout's own reputation flag), or null if it didn't answer. */
async function strangers(account) {
  const base = state.dep.chain.explorer;
  if (!base) return null;
  const r = await fetch(`${base}/api/v2/addresses/${account}/token-balances`).then((x) => (x.ok ? x.json() : null));
  if (!Array.isArray(r)) return null;
  const listed = new Set([...tokenList(state.dep).map((t) => t.address.toLowerCase()), state.dep.faces.toLowerCase()]);
  return r
    .filter((b) => b.token && b.value !== "0")
    .map(({ token: t }) => ({ address: String(t.address_hash ?? t.address ?? "").toLowerCase(), name: t.name ?? "", symbol: t.symbol ?? "", type: t.type ?? "token", scam: /scam|spam/i.test(t.reputation ?? "") }))
    .filter((t) => t.address && !listed.has(t.address));
}

/** The scam guard on one Face: [{ level, text }]. */
async function safety(id, account, tokens, agentRisky) {
  const out = [];
  const known = knownFrom(state.dep);
  const [approvals, others, nftOps] = await Promise.all([
    openApprovals([account], tokens).catch(() => null),
    strangers(account).catch(() => null),
    logs(state.dep.faces, EV.approvalForAll, { owner: account }).catch(() => []),
  ]);
  if (approvals == null) out.push({ level: "info", text: "I couldn't read my token approvals right now." });
  else if (approvals.length) for (const a of approvals) out.push({ level: "danger", text: `${a.spender.slice(0, 6)}…${a.spender.slice(-4)} may take ${a.amount} ${a.sym} out of me. A lock doesn't stop it: my holder can revoke it.` });
  else out.push({ level: "ok", text: "No open token approvals: nothing inside me can be taken by another contract." });
  const ops = new Set();
  for (const l of nftOps) (l.args.approved ? ops.add(l.args.operator) : ops.delete(l.args.operator));
  for (const op of ops)
    if (await state.pub.readContract({ address: state.dep.faces, abi: NAMES, functionName: "isApprovedForAll", args: [account, op] }).catch(() => false))
      out.push({ level: "danger", text: `${op.slice(0, 6)}…${op.slice(-4)} may move every NEONFACES piece inside me.` });
  if (agentRisky.length) out.push({ level: "warn", text: `My agent may make ${agentRisky.length === 1 ? "a call" : `${agentRisky.length} calls`} besides NeonTrader's trade: those can move things out of me. Check them on this page.` });
  if (others == null) out.push({ level: "info", text: "I couldn't list other tokens right now (that list comes from Blockscout)." });
  else
    for (const t of others) {
      const facts = addressFacts({ code: true, name: t.name, symbol: t.symbol }, known);
      const bad = facts.level === "danger" || t.scam;
      out.push({
        level: bad ? "danger" : "warn",
        text: `Someone sent me ${t.symbol || t.name || "a token"} (${t.type}${t.name ? `, "${t.name}"` : ""}, ${t.address.slice(0, 6)}…${t.address.slice(-4)}), which NEONFACES doesn't list.${
          bad ? ` It is bait${t.scam ? " (Blockscout marks it as a scam)" : ""}: don't open any link it shows or try to trade it.` : " NeonTrader can't trade it; leaving it alone is safe."
        }`,
      });
    }
  const lockedUntil = Number(await readAt(account, "account", "effectiveLockedUntil").catch(() => 0n));
  if (lockedUntil * 1000 > Date.now()) out.push({ level: "ok", text: `Locked until ${utc(lockedUntil)}: nothing leaves me, whoever asks.` });
  return out;
}

/** The deliveries into this Face (base seed, top-up, set bonus) priced at their own time: { t, usd } or null. */
async function delivered(id, seed, bonusLegs, points) {
  const idn = BigInt(id);
  const [s, u, b] = await Promise.all([
    logs(state.dep.seeder, EV.seeded, { tokenId: idn }),
    logs(state.dep.seeder, EV.upgraded, { tokenId: idn }),
    logs(state.dep.seeder, EV.bonus, { anchorId: idn }),
  ]);
  const parts = [[s[0], seed.legs], [u[0], seed.upgradeLegs], [b[0], bonusLegs]].filter(([l, legs]) => l && legs.length);
  if (!parts.length) return null;
  let usd = 0;
  let last = 0;
  for (const [l, legs] of parts) {
    const t = await when(l);
    last = Math.max(last, t);
    for (const leg of legs) {
      const pts = points.get(leg.token.toLowerCase()) ?? (await history(leg.token, t - DAY));
      const p = priceAtT(pts, t);
      if (p == null) return null; // older than the prices read: say nothing rather than guess
      const dec = Number(await readAt(leg.token, "erc20", "decimals"));
      usd += (Number(leg.amount) / 10 ** dec) * p;
    }
  }
  return { t: last, usd };
}

/**
 * The "What I see" panel on a Face page. rows: the balances the page already read ({ sym, token, bal, dec });
 * seed: seedOf(id); bonus: the set bonus legs; entries: the journal (newest first).
 */
export async function renderSees(el, { id, account, seed, rows, tokens, bonus, entries }) {
  if (!el || !state.dep.trader) return;
  el.hidden = false;
  el.dataset.face = String(id); // a later Face on the same page wins over a slow earlier one
  el.innerHTML = `<h3>What I see</h3><p class="fine sees-wait">Reading the chain: prices, pools, events…</p>`;
  const now = Math.floor(Date.now() / 1000);
  const held = rows.filter((r) => r.bal > 0n);
  const since = now - 31 * DAY;
  const items = await Promise.all(
    held.map(async (r) => {
      const addr = priceOf(r.token);
      const [last, points] = await Promise.all([addr ? latestPrice(addr).catch(() => null) : null, addr ? history(addr, since).catch(() => []) : []]);
      const amount = Number(r.bal) / 10 ** r.dec;
      return { sym: r.sym === "WETH" ? "ETH" : r.sym, token: addr, amount, price: last?.price ?? null, usd: last ? amount * last.price : null, updatedAt: last?.updatedAt ?? null, points };
    }),
  );
  const points = new Map(items.filter((i) => i.token).map((i) => [i.token.toLowerCase(), i.points]));
  const usdg = items.find((i) => i.sym === "USDG")?.price ?? (await latestPrice(tokenList(state.dep).find((t) => t.symbol === "USDG").address).catch(() => null))?.price ?? 1;
  const [deliv, costs, agent, strategy] = await Promise.all([
    delivered(id, seed, bonus, points).catch(() => null),
    Promise.all(items.filter((i) => i.usd != null && i.sym !== "USDG").map(async (i) => [i.sym, await tradeCost(i.sym, i.price, usdg).catch(() => null)])).then(Object.fromEntries),
    agentWords(account).catch(() => ({ text: null, risky: [] })),
    state.pub.readContract({ address: state.dep.trader, abi: TRADER, functionName: "strategyOf", args: [account] }).catch(() => null),
  ]);
  const safe = await safety(id, account, tokens, agent.risky).catch(() => [{ level: "info", text: "I couldn't run my safety checks right now." }]);
  const lockedUntil = Number(await readAt(account, "account", "effectiveLockedUntil").catch(() => 0n));
  const f = {
    now,
    id,
    items,
    delivered: deliv,
    traded: (entries ?? []).some((e) => e.text.startsWith("Traded")),
    costs,
    activity: {
      entries: entries?.length ?? 0,
      latest: entries?.[0] ?? null,
      strategy: strategy && Number(strategy.kind) ? describeStrategy(state.dep, strategy) : null,
      agent: agent.text,
      lockedUntil,
    },
  };
  const sections = digest(f);
  // the wording rule runs on the page too: a sentence that fails it is not shown
  const clean = (t) => !wordingProblems(t).length;
  const worst = ["danger", "warn", "info", "ok"].find((l) => safe.some((s) => s.level === l)) ?? "ok";
  const at = (t) => `<time>${esc(utc(t).slice(4))}</time>`;
  if (el.dataset.face !== String(id)) return;
  el.innerHTML = `
    <h3>What I see</h3>
    <p class="lead-sm">What I can read about myself on the chain, in plain words. Facts, not advice.</p>
    <details class="sees-sec sees-safety ${worst}" ${worst === "ok" ? "" : "open"}>
      <summary><span>Safety</span><b class="badge ${worst === "ok" ? "ok" : "warn"}">${worst === "ok" ? "clear" : worst === "danger" ? "look" : "note"}</b>${at(now)}</summary>
      <ul>${safe.map((s) => `<li class="${s.level}">${esc(s.text)}</li>`).join("")}</ul>
      <p class="fine">A clean check is not a guarantee: a new scam can look clean. Nobody from NEONFACES DMs first, and there is nothing to claim. <a href="/check" data-link>Check a link or a request →</a></p>
    </details>
    ${sections
      .map(
        (s, k) => `<details class="sees-sec" ${k === 0 ? "open" : ""}>
      <summary><span>${esc(s.title)}</span>${at(s.asOf)}</summary>
      <ul>${s.lines.filter(clean).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    </details>`,
      )
      .join("")}
    <p class="fine">${esc(footer(items))} <a href="/market" data-link>Market watch →</a></p>`;
}

// =====================================================================================
// /market: every token a basket can carry, the same facts in one row each
// =====================================================================================
export async function renderMarket(root) {
  const body = root.querySelector("#market-rows");
  const note = root.querySelector("#market-note");
  if (state.preview || !state.dep?.trader) return;
  const now = Math.floor(Date.now() / 1000);
  const list = tokenList(state.dep);
  body.innerHTML = list.map((t) => `<tr data-sym="${esc(t.symbol)}"><td>${esc(t.symbol)}</td><td colspan="7" class="fine">reading…</td></tr>`).join("");
  const pct = (x) => (x == null ? "–" : `<span class="${x > 0 ? "up" : x < 0 ? "down" : ""}">${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%</span>`);
  const price = (p) => (p == null ? "–" : `$${p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: p < 10 ? 4 : 2 })}`);
  await Promise.all(
    list.map(async (t) => {
      const tr = body.querySelector(`tr[data-sym="${CSS.escape(t.symbol)}"]`);
      try {
        const [points, last] = await Promise.all([history(t.address, now - 31 * DAY), latestPrice(t.address)]);
        if (last && (!points.length || points.at(-1)[0] < last.updatedAt)) points.push([last.updatedAt, last.price]);
        const r = marketRow(t.symbol, points, now);
        const dollar = r.kind === "dollars";
        tr.innerHTML = `<td>${esc(t.symbol)}</td><td>${esc(r.kind)}</td><td>${price(r.price)}</td><td>${dollar ? "–" : pct(r.d1)}</td><td>${dollar ? "–" : pct(r.d7)}</td><td>${dollar ? "–" : pct(r.d30)}</td><td>${dollar || r.swing == null ? "–" : `${(r.swing * 100).toFixed(1)}%`}</td><td class="fine">${
          r.price == null ? "no price" : `${esc(utc(r.updatedAt))}${r.paused ? " · too old to trade" : ""}`
        }</td>`;
      } catch {
        tr.innerHTML = `<td>${esc(t.symbol)}</td><td colspan="7" class="fine">the price feed didn't answer</td>`;
      }
    }),
  );
  note.textContent = `Read ${utc(now)} from the Chainlink feeds NeonTrader trades on. "Typical day" is how much the price moved on an ordinary day over the last 30 days. Chainlink writes a new price when it moves enough, and at least once a day; NeonTrader won't trade on a price older than 26 hours, and Stock Token prices pause at weekends. Facts from the chain, not advice. Stock Tokens give economic exposure only, not legal ownership of shares; availability depends on where you live and on the issuer's terms.`;
}

// =====================================================================================
// /check: paste a link, an address, a transaction or a signature request
// =====================================================================================
export function setupCheck(root) {
  const form = root.querySelector("#check-form");
  const input = root.querySelector("#check-input");
  const out = root.querySelector("#check-result");
  if (!form || form.dataset.ready) return;
  form.dataset.ready = "1";
  form.onsubmit = async (e) => {
    e.preventDefault();
    const known = state.dep ? knownFrom(state.dep) : [];
    const r = check(input.value, known);
    if (!r) {
      out.hidden = true;
      return;
    }
    if (r.kind === "seed") input.value = ""; // never keep a seed phrase on screen
    const paint = (x) => {
      out.hidden = false;
      out.className = `check-result ${x.level}`;
      out.innerHTML = `<h4>${esc(x.title)}</h4><ul>${x.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`;
    };
    paint(r);
    if (r.needs === "address" && state.pub && r.level === "info") {
      try {
        const a = getAddress(r.address);
        const code = await state.pub.getCode({ address: a });
        const facts = { code: !!code && code !== "0x" };
        if (facts.code) {
          [facts.name, facts.symbol] = await Promise.all([
            state.pub.readContract({ address: a, abi: NAMES, functionName: "name" }).catch(() => ""),
            state.pub.readContract({ address: a, abi: NAMES, functionName: "symbol" }).catch(() => ""),
          ]);
        }
        const more = addressFacts(facts, known);
        paint({ ...r, level: more.level === "danger" ? "danger" : r.level, title: more.level === "danger" ? "Not ours, and it pretends to be" : r.title, lines: [r.lines[0], ...more.lines, ...r.lines.slice(1)] });
      } catch {}
    }
  };
}
