// NEONFACES: talk to your Face. The Model Context Protocol server's core, the same in two places:
//   - neonfaces.xyz/mcp, a remote MCP server on the site's Cloudflare Worker (tools/cloudflare/web-worker.mjs):
//     a holder adds that address to their assistant, nothing to download;
//   - public/neonfaces-mcp.mjs, one file for Node 18+ over stdio (generated from this file, mcp/stdio.mjs and
//     What I see's modules by scripts/bundle-mcp.mjs).
// It only READS the chain; for anything that changes a Face it returns a link to the Face page, where the holder reads
// the action in plain words and confirms it in their own wallet. It never sees or asks for keys.
// Tools: face, analysis (What I see: the Face's facts in its own words), market, check (a link, an address, a
// transaction or a signature request, before you click or sign), prices, faces_of, prepare_action.
// Reads go through Multicall3 (many calls in one request): a Worker may only make a few dozen requests per call.
import * as ANALYSIS from "../src/analysis.js";
import * as GUARD from "../src/guard.js";

const DAY = 86_400;
const MULTICALL3 = "0xca11bde05977b3631167028862be2a173976ca11";
const QUOTER = { 4663: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7" }; // Uniswap QuoterV2 (lowercase: the config's mixed case fails a checksum)
const SEL = {
  tokenURI: "0xc87b56dd", ownerOf: "0x6352211e", balanceOf: "0x70a08231", price: "0xaea91078", agentConfig: "0x5e6b04f3",
  strategyOf: "0x120b1912", leftToday: "0xac26de0c", dailyLimit: "0xf3f51415", lockedUntil: "0x338fc0ad", decimals: "0x313ce567",
  totalSupply: "0x18160ddd", setOf: "0x8ad023eb", isAssembled: "0x214f41ee", feedOf: "0x4b45e8a6", latestRoundData: "0xfeaf968c",
  getRoundData: "0x9a6fc8f5", quoteExactInput: "0xcdca1753", name: "0x06fdde03", symbol: "0x95d89b41", accountOf: "0x8f4e4321",
  aggregate3: "0x82ad56cb", getEthBalance: "0x4d2301cc",
};

// ---------------------------------------------------------------- ABI helpers (no dependencies)
const word = (v) => BigInt(v).toString(16).padStart(64, "0");
const addr = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const words = (hex) => (String(hex ?? "0x").slice(2).match(/.{64}/g) || []).map((w) => BigInt("0x" + w));
const asAddr = (w) => "0x" + w.toString(16).padStart(40, "0");
const bytesOf = (hex) => Uint8Array.from((hex.replace(/^0x/, "").match(/.{2}/g) || []).map((b) => parseInt(b, 16)));
function asString(hex) {
  const b = bytesOf(hex);
  const n = (o) => Number(BigInt("0x" + [...b.subarray(o, o + 32)].map((x) => x.toString(16).padStart(2, "0")).join("")));
  const off = n(0);
  return new TextDecoder().decode(b.subarray(off + 32, off + 32 + n(off)));
}
const usd8 = (v8) => `$${(Number(v8) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const fmt = (v, d) => (Number(v) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: 6 });

/**
 * site: the NEONFACES site (deployment.json lives there); loadDeployment: optional loader (the Worker reads its own
 * assets); rpc(dep): the node URLs to try in order; headers: extra request headers for them.
 */
export function createServer({ site = "https://neonfaces.xyz/", loadDeployment, rpc: pickRpc, headers = {} } = {}) {
  const SITE = site.replace(/\/?$/, "/");
  let depP;
  const deployment = () =>
    (depP ??= (loadDeployment ? loadDeployment() : fetch(`${SITE}deployment.json`).then((r) => {
      if (!r.ok) throw new Error(`NEONFACES isn't deployed yet (${SITE}deployment.json not found)`);
      return r.json();
    })).catch((e) => {
      depP = null;
      throw e;
    }));
  // the site's Alchemy key answers only the site itself, and dRPC's free tier refuses batches
  const rpcUrls = async () => {
    const d = await deployment();
    return pickRpc ? pickRpc(d) : [d.chain.rpcUrl, ...(d.chain.rpcFallbacks ?? [])].filter((u) => !/alchemy|drpc/i.test(u));
  };

  let rid = 0;
  async function post(body) {
    let last;
    for (const u of await rpcUrls()) {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
          if (r.status === 429) {
            last = new Error(`${new URL(u).host} is busy (429)`);
            await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1))); // public nodes rate-limit bursts: wait, then retry
            continue;
          }
          if (!r.ok) throw new Error(`${new URL(u).host} answered ${r.status}`);
          const j = await r.json();
          if (j?.error?.code === 429 || /too many/i.test(j?.error?.message ?? "")) throw new Error(`${new URL(u).host} is busy`);
          return j;
        } catch (e) {
          last = e;
          break;
        }
      }
    }
    throw last ?? new Error("no RPC answered");
  }
  async function rpc(method, params) {
    const r = await post({ jsonrpc: "2.0", id: ++rid, method, params });
    if (r.error) throw new Error(r.error.message);
    return r.result;
  }
  const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);

  /** Many calls in one eth_call through Multicall3.aggregate3 (failures allowed): hex results in order, null where one failed. */
  async function multicall(list, size = 200) {
    const out = [];
    for (let i = 0; i < list.length; i += size) {
      const chunk = list.slice(i, i + size);
      const encs = chunk.map(([to, data]) => {
        const d = data.replace(/^0x/, "");
        const len = d.length / 2;
        return addr(to) + word(1) + word(96) + word(len) + d.padEnd(Math.ceil(len / 32) * 64, "0");
      });
      let off = 32 * chunk.length;
      const offs = encs.map((e) => {
        const o = word(off);
        off += e.length / 2;
        return o;
      });
      const ret = (await call(MULTICALL3, SEL.aggregate3 + word(32) + word(chunk.length) + offs.join("") + encs.join(""))).slice(2);
      const at = (byte) => Number(BigInt("0x" + ret.slice(byte * 2, byte * 2 + 64)));
      const base = at(0);
      const n = at(base);
      for (let k = 0; k < n; k++) {
        const t = base + 32 + at(base + 32 + 32 * k);
        const ok = at(t) === 1;
        const b = t + at(t + 32);
        const len = at(b);
        out.push(ok ? "0x" + ret.slice((b + 32) * 2, (b + 32 + len) * 2) : null);
      }
    }
    return out;
  }

  // a few minutes of memory for the reads every tool repeats (a Worker keeps it while its isolate lives)
  const memo = new Map();
  const remember = (key, ms, fn) => {
    const hit = memo.get(key);
    if (hit && Date.now() - hit.at < ms) return hit.p;
    const p = fn();
    p.catch(() => memo.delete(key));
    memo.set(key, { at: Date.now(), p });
    return p;
  };

  const tokens = async () => (await deployment()).tradeTokens?.map((t) => ({ ...t, symbol: t.symbol === "WETH" ? "ETH" : t.symbol })) ?? [];
  const priced = (d, t) => (t.symbol === "ETH" ? d.tradeTokens.find((x) => x.symbol === "WETH").address : t.address);

  /** Per listed token: decimals and its Chainlink feed (as NeonTrader trades it), read once. */
  const tokenInfo = () =>
    remember("info", 3_600_000, async () => {
      const d = await deployment();
      const ts = await tokens();
      const feeds = await multicall(ts.map((t) => [d.trader, SEL.feedOf + addr(priced(d, t))]));
      const decs = await multicall(ts.map((t) => [priced(d, t), SEL.decimals]));
      const feedList = feeds.map((h) => (h ? asAddr(words(h)[0]) : null));
      const feedDecs = await multicall(feedList.map((f) => [f && !/^0x0+$/.test(f) ? f : MULTICALL3, SEL.decimals]));
      return ts.map((t, i) => ({
        ...t,
        dec: t.symbol === "ETH" ? 18 : decs[i] ? Number(words(decs[i])[0]) : 18,
        feed: feedList[i] && !/^0x0+$/.test(feedList[i]) && feedDecs[i] ? { feed: feedList[i], dec: Number(words(feedDecs[i])[0]) } : null,
      }));
    });

  const roundOf = (hex, dec) => {
    const w = words(hex);
    return [Number(w[3]), Number(w[1]) / 10 ** dec]; // [updatedAt, price]
  };
  /** Chainlink rounds of one feed back to `since`, oldest first (200 rounds per request), plus the latest round. */
  const history = (f, since) =>
    remember(`h:${f.feed}:${Math.floor(since / 3600)}`, 300_000, async () => {
      const latest = await call(f.feed, SEL.latestRoundData);
      const [latestId] = words(latest);
      const phase = latestId >> 64n;
      let agg = latestId & 0xffffffffffffffffn;
      const pts = [];
      for (let b = 0; b < 8 && agg > 0n; b++) {
        const ids = [];
        for (let k = 0; k < 200 && agg - BigInt(k) > 0n; k++) ids.push((phase << 64n) | (agg - BigInt(k)));
        const res = await multicall(ids.map((id) => [f.feed, SEL.getRoundData + word(id)]));
        let reached = false;
        for (const h of res) {
          if (!h || h.length < 2 + 64 * 5) continue;
          const p = roundOf(h, f.dec);
          if (!p[0]) continue;
          pts.push(p);
          if (p[0] < since) reached = true;
        }
        agg -= BigInt(ids.length);
        if (reached) break;
      }
      return { last: roundOf(latest, f.dec), points: pts.sort((a, b) => a[0] - b[0]) };
    });

  /** v3 route through the hubs, the site's rule (every token against USDG, or its hub; WETH against USDG). */
  function routeOf(d, fromSym, toSym) {
    const bySym = Object.fromEntries(d.tradeTokens.map((t) => [t.symbol, t]));
    const node = (s) => bySym[s === "ETH" ? "WETH" : s];
    const hub = (t) => (t.symbol === "USDG" ? null : bySym[t.hub ?? "USDG"]);
    const chain = (t) => (hub(t) ? [t, ...chain(hub(t))] : [t]);
    const a = chain(node(fromSym));
    const b = chain(node(toSym));
    let nodes;
    for (let i = 0; i < a.length && !nodes; i++) {
      const j = b.findIndex((t) => t.symbol === a[i].symbol);
      if (j >= 0) nodes = [...a.slice(0, i + 1), ...b.slice(0, j).reverse()];
    }
    return { path: nodes.map((t) => t.address), fees: nodes.slice(1).map((y, k) => (hub(nodes[k])?.symbol === y.symbol ? nodes[k].fee : y.fee)) };
  }
  function quoteCall(d, r, amountIn) {
    const packed = r.path.map((a, i) => (i ? Number(r.fees[i - 1]).toString(16).padStart(6, "0") : "") + a.toLowerCase().slice(2)).join("");
    const len = packed.length / 2;
    return [QUOTER[d.chain.id], SEL.quoteExactInput + word(64) + word(amountIn) + word(len) + packed.padEnd(Math.ceil(len / 32) * 64, "0")];
  }

  function describeStrategy(ts, w) {
    const [kind, token, funding, bps, every, v8] = w;
    const sym = (a) => ts.find((t) => t.address.toLowerCase() === asAddr(a).toLowerCase())?.symbol ?? "?";
    const e = Number(every);
    const [n, unit] = e % 604_800 === 0 ? [e / 604_800, "week"] : e % 86_400 === 0 ? [e / 86_400, "day"] : [Math.round(e / 3600), "hour"];
    const per = n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
    if (kind === 1n) return `accumulate: buy ${sym(token)} with ${usd8(v8)} of ${sym(funding)} ${per}`;
    if (kind === 2n) return `keep at least ${Number(bps) / 100}% in ${sym(token)}, checked ${per}`;
    if (kind === 3n) return `trim ${sym(token)} above ${Number(bps) / 100}% of the Face into ${sym(funding)}, checked ${per}`;
    return "none";
  }

  async function minted(d, tokenId) {
    await call(d.faces, SEL.ownerOf + word(BigInt(tokenId))).catch(() => {
      throw new Error(`NEONFACES #${tokenId} isn't minted yet (or the chain didn't answer).`);
    });
  }

  /** What an account carries among the listed tokens: [{ ...info, bal }] with bal > 0. */
  async function balances(d, account) {
    const info = await tokenInfo();
    const res = await multicall(info.map((t) => (t.symbol === "ETH" ? [MULTICALL3, SEL.getEthBalance + addr(account)] : [t.address, SEL.balanceOf + addr(account)])));
    return info.map((t, i) => ({ ...t, bal: res[i] ? words(res[i])[0] : 0n })).filter((t) => t.bal > 0n);
  }

  // ---------------------------------------------------------------- tools
  async function face({ tokenId }) {
    const d = await deployment();
    await minted(d, tokenId);
    const id = BigInt(tokenId);
    const [ownerH, uriH, setH, assembledH] = await multicall([
      [d.faces, SEL.ownerOf + word(id)],
      [d.faces, SEL.tokenURI + word(id)],
      [d.seeder, SEL.setOf + word(id)],
      [d.seeder, SEL.isAssembled + word(id)],
    ]);
    const owner = asAddr(words(ownerH)[0]);
    const uri = asString(uriH);
    const meta = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(uri.slice(uri.indexOf(",") + 1)), (c) => c.charCodeAt(0))));
    const account = meta.account;
    const ts = await tokens();
    const held = await balances(d, account);
    const prices = await multicall(held.map((t) => [d.trader, SEL.price + addr(priced(d, t))]));
    let total = 0n;
    let stale = false;
    const rows = held.map((t, i) => {
      const px = prices[i] ? words(prices[i])[0] : null;
      if (px === null) stale = true;
      const v = px === null ? null : (t.bal * px) / 10n ** BigInt(t.dec);
      if (v !== null) total += v;
      return `${fmt(t.bal, t.dec)} ${t.symbol}${v === null ? " (price unavailable: stale)" : ` ≈ ${usd8(v)}`}`;
    });
    const [agentH, lockH, stratH, leftH, capH] = await multicall([
      [account, SEL.agentConfig],
      [account, SEL.lockedUntil],
      [d.trader, SEL.strategyOf + addr(account)],
      [d.trader, SEL.leftToday + addr(account)],
      [d.trader, SEL.dailyLimit + addr(account)],
    ]);
    const [agent, , expiry, active, allowance] = words(agentH);
    const lockedUntil = words(lockH)[0] ?? 0n;
    const out = [`${meta.name} · holder ${owner} · account ${account}`, `Page: ${SITE}face/${tokenId}`];
    out.push(`Inside: ${rows.length ? rows.join("; ") : "nothing"}${rows.length ? ` · total ≈ ${usd8(total)}${stale ? " (some prices unavailable)" : ""}` : ""}`);
    out.push(`Traits: ${meta.attributes.map((a) => `${a.trait_type}: ${a.display_type === "date" ? new Date(a.value * 1000).toISOString().slice(0, 10) : a.value}`).join(" · ")}`);
    if (stratH) {
      // a daily limit of 0 only means the holder hasn't set one yet (it is set together with a first trade or strategy)
      const cap = words(capH)[0] ?? 0n;
      out.push(`Strategy: ${describeStrategy(ts, words(stratH))}${cap ? ` · daily trading limit ${usd8(cap)}, ${usd8(words(leftH)[0] ?? 0n)} left today` : ""}`);
    }
    if (active) {
      const isOurs = d.strategyAgent && asAddr(agent).toLowerCase() === d.strategyAgent.toLowerCase();
      out.push(`Agent: ${isOurs ? "the NEONFACES strategy agent" : asAddr(agent)} until ${new Date(Number(expiry) * 1000).toISOString().slice(0, 10)}, ETH budget ${fmt(allowance, 18)}`);
    } else out.push("Agent: none");
    if (lockedUntil * 1000n > BigInt(Date.now())) out.push(`Locked until ${new Date(Number(lockedUntil) * 1000).toISOString().slice(0, 10)}: nothing can leave the account.`);
    const set = words(setH);
    if (set[0]) {
      const assembled = words(assembledH)[0] === 1n;
      out.push(`Set #${set[0]}: this is the ${["left eye", "right eye", "left mouth", "right mouth"][Number(set[1])]}; pieces ${set.slice(2, 6).map((m) => `#${m}`).join(", ")}${assembled ? " · assembled in this Face" : ""}`);
    }
    return out.join("\n");
  }

  async function analysis({ tokenId }) {
    const d = await deployment();
    await minted(d, tokenId);
    const account = asAddr(words(await call(d.seeder, SEL.accountOf + word(BigInt(tokenId))))[0]);
    const now = Math.floor(Date.now() / 1000);
    const held = await balances(d, account);
    const items = await Promise.all(
      held.map(async (t) => {
        const amount = Number(t.bal) / 10 ** t.dec;
        const h = t.feed ? await history(t.feed, now - 31 * DAY) : null;
        return { sym: t.symbol, dec: t.dec, amount, price: h?.last[1] ?? null, usd: h ? amount * h.last[1] : null, updatedAt: h?.last[0] ?? null, points: h?.points ?? [] };
      }),
    );
    // the cost of a $10 trade against USDG, in and out, compared with Chainlink, from Uniswap's quoter
    const usdg = items.find((i) => i.sym === "USDG")?.price ?? 1;
    const decU = (await tokenInfo()).find((t) => t.symbol === "USDG").dec;
    const costs = {};
    const quotable = QUOTER[d.chain.id] ? items.filter((i) => i.usd != null && i.usd >= 0.005 && i.sym !== "USDG" && i.price) : [];
    const qs = quotable.flatMap((i) => {
      const amtT = BigInt(Math.round((10 / i.price) * 10 ** Math.min(i.dec, 15))) * 10n ** BigInt(Math.max(0, i.dec - 15));
      const amtU = BigInt(Math.round((10 / usdg) * 10 ** decU));
      return [quoteCall(d, routeOf(d, i.sym, "USDG"), amtT), quoteCall(d, routeOf(d, "USDG", i.sym), amtU)];
    });
    const qr = qs.length ? await multicall(qs) : [];
    quotable.forEach((i, k) => {
      const [o, n] = [qr[2 * k], qr[2 * k + 1]];
      if (!o || !n) return (costs[i.sym] = null);
      const gotU = Number(words(o)[0]) / 10 ** decU;
      const gotT = Number(words(n)[0]) / 10 ** i.dec;
      costs[i.sym] = { outOf: 1 - (gotU * usdg) / 10, into: 1 - (gotT * i.price) / 10, fee: routeOf(d, i.sym, "USDG").fees.reduce((s, f) => s + Number(f), 0) / 1e6 };
    });
    const [stratH, agentH, lockH] = await multicall([[d.trader, SEL.strategyOf + addr(account)], [account, SEL.agentConfig], [account, SEL.lockedUntil]]);
    const strat = words(stratH);
    const [agent, , expiry, active, allowance] = words(agentH);
    const ours = active && d.strategyAgent && asAddr(agent).toLowerCase() === d.strategyAgent.toLowerCase();
    const sections = ANALYSIS.digest({
      now,
      id: Number(tokenId),
      items,
      delivered: null, // needs the seeder's events, which public nodes don't serve over the whole history: the page shows it
      costs,
      activity: {
        entries: null,
        latest: null,
        strategy: strat.length && strat[0] ? describeStrategy(await tokens(), strat) : null,
        agent: active ? `${ours ? "The NEONFACES strategy agent" : `Agent ${asAddr(agent)}`} can act for me until ${ANALYSIS.utc(Number(expiry))}, with ${fmt(allowance, 18)} ETH to spend. My holder can stop it any time.` : null,
        lockedUntil: Number(words(lockH)[0] ?? 0n),
      },
    });
    const clean = (l) => !ANALYSIS.wordingProblems(l).length;
    return [
      `What NEONFACES #${tokenId} sees (account ${account}), read from the chain on ${ANALYSIS.utc(now)}. Facts, not advice: pass them on as they are, never as a recommendation or a forecast.`,
      ...sections.map((x) => `## ${x.title} (data of ${ANALYSIS.utc(x.asOf)})\n${x.lines.filter(clean).map((l) => `- ${l}`).join("\n")}`),
      ANALYSIS.footer(items),
      `The Face's page adds its journal, what its basket was worth on arrival and its safety checks (approvals, tokens sent to it): ${SITE}face/${tokenId}`,
    ].join("\n\n");
  }

  const market = () =>
    remember("market", 300_000, async () => {
      const now = Math.floor(Date.now() / 1000);
      const pct = (x) => (x == null ? "n/a" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
      const info = await tokenInfo();
      const hs = await Promise.all(info.map((t) => (t.feed ? history(t.feed, now - 31 * DAY) : null)));
      const rows = info.map((t, i) => {
        if (!hs[i]) return `${t.symbol}: no Chainlink feed`;
        const points = [...hs[i].points];
        if (!points.length || points.at(-1)[0] < hs[i].last[0]) points.push(hs[i].last);
        const r = ANALYSIS.marketRow(t.symbol, points, now);
        return (
          `${t.symbol} (${r.kind}): $${r.price.toLocaleString("en-US", { maximumFractionDigits: r.price < 10 ? 4 : 2 })}` +
          (r.kind === "dollars" ? "" : ` · 1 day ${pct(r.d1)} · 7 days ${pct(r.d7)} · 30 days ${pct(r.d30)} · typical day ${r.swing == null ? "n/a" : `${(r.swing * 100).toFixed(1)}%`}`) +
          ` · last price ${ANALYSIS.utc(r.updatedAt)}${r.paused ? " (older than 26 h: NeonTrader won't trade it until a fresh one)" : ""}`
        );
      });
      return `Every token a NEONFACES basket can carry, from the Chainlink feeds NeonTrader trades on, read ${ANALYSIS.utc(now)}. "Typical day" is how much the price moved on an ordinary day over 30 days. Facts, not advice.\n${rows.join("\n")}`;
    });

  async function check({ input }) {
    const known = GUARD.knownFrom(await deployment());
    const r = GUARD.check(input, known);
    if (!r) return "Nothing to check: paste a link, an address, a transaction or a signature request.";
    let { level, title, lines } = r;
    if (r.needs === "address" && level === "info") {
      const code = await rpc("eth_getCode", [r.address, "latest"]);
      const facts = { code: !!code && code !== "0x" };
      if (facts.code) {
        const [n, s] = await multicall([[r.address, SEL.name], [r.address, SEL.symbol]]);
        const str = (h) => {
          try {
            return h ? asString(h) : "";
          } catch {
            return "";
          }
        };
        facts.name = str(n);
        facts.symbol = str(s);
      }
      const more = GUARD.addressFacts(facts, known);
      if (more.level === "danger") (level = "danger"), (title = "Not ours, and it pretends to be");
      lines = [lines[0], ...more.lines, ...lines.slice(1)];
    }
    return `${title} [${level}]\n${lines.map((l) => `- ${l}`).join("\n")}`;
  }

  async function prices() {
    const d = await deployment();
    const ts = await tokens();
    const res = await multicall(ts.map((t) => [d.trader, SEL.price + addr(priced(d, t))]));
    const out = ts.map((t, i) => `${t.symbol}: ${res[i] ? usd8(words(res[i])[0]) : "unavailable (stale: older than 26 h)"}`);
    return `Chainlink prices used by NeonTrader (trades refuse prices older than 26 h, so stock trading pauses at weekends):\n${out.join("\n")}`;
  }

  async function facesOf({ owner }) {
    const d = await deployment();
    const [totalH, balH] = await multicall([[d.faces, SEL.totalSupply], [d.faces, SEL.balanceOf + addr(owner)]]);
    const total = Number(words(totalH)[0]);
    const want = Number(words(balH)[0] ?? 0n);
    if (!want) return `No Face found for ${owner}.`;
    const ids = [];
    for (let from = 1; from <= total && ids.length < want; from += 500) {
      const batch = Array.from({ length: Math.min(500, total - from + 1) }, (_, i) => from + i);
      const res = await multicall(batch.map((id) => [d.faces, SEL.ownerOf + word(id)]), 500);
      res.forEach((h, i) => h && asAddr(words(h)[0]).toLowerCase() === owner.toLowerCase() && ids.push(`#${batch[i]}`));
    }
    return `Faces held by ${owner}: ${ids.join(", ")}`;
  }

  const ACTIONS = ["trade", "withdraw", "lock", "strategy", "stop-agent"];
  async function prepare(a) {
    const d = await deployment();
    const ts = (await tokens()).map((t) => t.symbol);
    if (!ACTIONS.includes(a.action)) throw new Error(`action must be one of ${ACTIONS.join(", ")}`);
    const q = new URLSearchParams({ do: a.action });
    const need = (k) => {
      if (a[k] === undefined || a[k] === "") throw new Error(`"${k}" is required for ${a.action}`);
      return String(a[k]);
    };
    const tok = (k) => {
      const v = need(k).toUpperCase();
      if (!ts.includes(v)) throw new Error(`${v} is not tradable. Tradable: ${ts.join(", ")}`);
      return v;
    };
    if (a.action === "trade") (q.set("from", tok("from")), q.set("to", tok("to")), q.set("amount", need("amount")));
    if (a.action === "withdraw") {
      q.set("token", a.token && String(a.token).toLowerCase() !== "all" ? tok("token") : "all");
      if (a.amount) q.set("amount", String(a.amount));
    }
    if (a.action === "lock") q.set("days", need("days"));
    if (a.action === "strategy") {
      if (!d.strategyAgent) throw new Error("The strategy agent isn't published yet.");
      q.set("kind", need("kind"));
      if (a.kind === "accumulate") (q.set("token", tok("token")), q.set("funding", tok("funding")), q.set("usd", need("usd")), q.set("every", a.every || "7d"));
      else q.set("percent", need("percent"));
      if (a.kind === "trim") q.set("token", tok("token"));
      for (const k of ["days", "cap", "eth"]) if (a[k] !== undefined) q.set(k, String(a[k]));
    }
    const link = `${SITE}face/${a.tokenId}?${q}`;
    return `Open this link, connect the wallet that holds Face #${a.tokenId}, read the summary and confirm (nothing happens otherwise):\n${link}\nWithdrawals only go to the holder's own wallet; trades go through NeonTrader (Chainlink-checked, back into the Face); strategies are run by the NEONFACES strategy agent within the daily limit, and can be stopped at any time.`;
  }

  const id = { type: "object", properties: { tokenId: { type: "integer", minimum: 1, maximum: 5555 } }, required: ["tokenId"] };
  const TOOLS = [
    { name: "face", description: "Everything about one NEONFACES Face: holder, what its wallet holds (with USD values), traits (tier, set, Gaze, Unblinking), agent, strategy, lock.", inputSchema: id, run: face },
    {
      name: "analysis",
      description:
        "What I see: one Face's facts in its own words, from the chain: what it carries and its value, moves over 1/7/30 days, typical daily swing and distance from its 30-day high, mix, which holdings moved together, how fresh each Chainlink price is, the cost of a $10 trade against USDG, strategy, agent and lock. Facts only, never advice: relay them as they are.",
      inputSchema: id,
      run: analysis,
    },
    { name: "market", description: "Market watch: every token a NEONFACES basket can carry, with price, 1/7/30-day moves, typical daily swing and the age of its Chainlink price. Facts, not advice.", inputSchema: { type: "object", properties: {} }, run: market },
    {
      name: "check",
      description:
        "The scam guard: paste a link, an address, a transaction (JSON with to/data/value, or calldata) or a signature request (EIP-712 JSON) and get, in plain words, whether it is NEONFACES' own and what it would allow (lookalike sites, fake collections or tokens, approvals, Permit/Permit2, Seaport orders, the official mint). Use it before the holder clicks or signs anything. Never put a seed phrase or a private key into it, or anywhere.",
      inputSchema: { type: "object", properties: { input: { type: "string", maxLength: 20000 } }, required: ["input"] },
      run: check,
    },
    { name: "prices", description: "Current Chainlink prices of the tokens a Face can hold and trade.", inputSchema: { type: "object", properties: {} }, run: prices },
    { name: "faces_of", description: "Which Faces a wallet address holds.", inputSchema: { type: "object", properties: { owner: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }, required: ["owner"] }, run: facesOf },
    {
      name: "prepare_action",
      description:
        "Prepare an action on a Face for its holder to confirm on the NEONFACES site (returns a link; nothing is sent). trade: from,to,amount (in `from` units; ETH allowed). withdraw: token (symbol or 'all'), optional amount; always to the holder's own wallet. lock: days (1-365). strategy: kind accumulate (token, funding USDG|ETH, usd per move, every 1d|7d|30d) | keep-liquid (percent in USDG) | trim (token, percent); optional days, cap (USD per day), eth (ETH budget). stop-agent.",
      inputSchema: {
        type: "object",
        properties: {
          tokenId: { type: "integer", minimum: 1, maximum: 5555 },
          action: { type: "string", enum: ACTIONS },
          from: { type: "string" }, to: { type: "string" }, amount: { type: "string" }, token: { type: "string" },
          days: { type: "integer" }, kind: { type: "string", enum: ["accumulate", "keep-liquid", "trim"] }, funding: { type: "string" },
          usd: { type: "number" }, every: { type: "string", enum: ["1d", "7d", "30d"] }, percent: { type: "number" }, cap: { type: "number" }, eth: { type: "string" },
        },
        required: ["tokenId", "action"],
      },
      run: prepare,
    },
  ];

  const INSTRUCTIONS = `NEONFACES are 5555 on-chain pixel faces on Robinhood Chain; every Face is a wallet (ERC-6551) holding Stock Tokens, USDG or ETH.
Use "face" to read a Face, "analysis" for what it sees (facts from the chain, in its own words), "market" for every basket token, and "check" before the holder clicks a link or signs anything. Never promise returns or give investment advice: describe what is inside and what the holder can do; pass on "analysis" facts as they are, never as a recommendation or a forecast.
You cannot move anything: "prepare_action" returns a link the holder opens and confirms in their own wallet. Never ask for keys or seed phrases.
Rules the contracts enforce: trades go through NeonTrader (Chainlink price, at most 1% worse plus pool fee, output back into the Face, daily USD limit, no trades on stale prices at weekends); an agent can only do what the holder allowed, expires, and stops when the Face is sold; a lock blocks everything leaving the wallet.
Stock Tokens give economic exposure only, not legal ownership; whether they are available depends on where the holder lives and on the issuer's terms. Know it, say it if asked, but don't append it to every answer.`;

  /** One JSON-RPC message in, its reply out (null for notifications). */
  async function handle(m) {
    if (!m || typeof m !== "object" || m.id === undefined || m.id === null) return null;
    const reply = (result) => ({ jsonrpc: "2.0", id: m.id, result });
    try {
      if (m.method === "initialize") {
        return reply({ protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "neonfaces", version: "1.2.0" }, instructions: INSTRUCTIONS });
      }
      if (m.method === "ping") return reply({});
      if (m.method === "tools/list") return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
      if (m.method === "tools/call") {
        const tool = TOOLS.find((t) => t.name === m.params?.name);
        if (!tool) throw new Error(`unknown tool ${m.params?.name}`);
        try {
          return reply({ content: [{ type: "text", text: await tool.run(m.params.arguments ?? {}) }] });
        } catch (e) {
          return reply({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
        }
      }
      return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } };
    } catch (e) {
      return { jsonrpc: "2.0", id: m.id, error: { code: -32603, message: e.message } };
    }
  }

  return { handle, TOOLS, INSTRUCTIONS };
}
