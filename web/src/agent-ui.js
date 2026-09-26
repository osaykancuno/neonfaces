// Holder controls on the Face page, written for people who have never configured an agent.
// Everything is phrased in plain language; the raw (contract, function) format only exists under "Advanced".
//
// Ready-made actions come from /agent-presets.json (published by the team with verified addresses):
// { "presets": [ { "id", "title", "plain", "risk": "low"|"careful", "needsEth": bool,
//                  "approvals": [{ "token", "spender", "label" }],      // done once by the holder, optional
//                  "dailyLimit": { "target", "signature", "decimals" },  // optional: wizard asks a USD/day cap
//                  "calls": [{ "target", "signature", "label" }] } ] }
import { formatEther, parseEther, toFunctionSelector, parseAbiItem, encodeFunctionData, parseAbi, maxUint256 } from "viem";
import { TRADER, tokenList, describeStrategy, parseLink, build, run } from "./actions.js";

const RISKY = {
  "0xa9059cbb": "transfer: can send tokens anywhere",
  "0x23b872dd": "transferFrom: can move tokens",
  "0x095ea7b3": "approve: can let anyone spend your tokens, including itself",
  "0x39509351": "increaseAllowance: same risk as approve",
  "0xa22cb465": "setApprovalForAll: hands over whole NFT collections",
  "0x42842e0e": "safeTransferFrom: can move NFTs out",
  "0xd505accf": "permit: signature-based approvals",
};

const ERC20_APPROVE = parseAbi(["function approve(address spender, uint256 amount) returns (bool)"]);
const TRADER_VIEW = parseAbi(["function leftToday(address) view returns (uint256)", "function dailyLimit(address) view returns (uint256)"]);
const ACCOUNT_EVENTS = parseAbi([
  "event AgentSet(address indexed agent, address indexed grantor, uint64 expiry, uint64 epoch, uint256 valueAllowance)",
  "event AgentPermissionsUpdated(uint64 indexed epoch, (address target, bytes4 selector)[] permissions, bool allowed)",
  "event AgentRevoked(uint64 epoch)",
]);

let presetsCache;
async function loadPresets() {
  presetsCache ??= fetch("/agent-presets.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { presets: [] }))
    .then((j) => (j.presets ?? []).map((p) => ({ ...p, calls: p.calls.map((c) => ({ ...c, selector: toFunctionSelector(`function ${c.signature}`) })) })))
    .catch(() => []);
  return presetsCache;
}

/** Tokens the published actions can trade (shown on the Face page when the account holds them). */
export async function knownTokens() {
  const presets = await loadPresets();
  return [...new Set(presets.flatMap((p) => (p.approvals ?? []).map((a) => a.token)))];
}

const dayMs = 86_400_000;
const niceDate = (sec) => new Date(Number(sec) * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Advanced format: "0xContract functionName(types)" per line. */
export function parseAdvanced(text) {
  const calls = [];
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [target, ...rest] = line.split(/\s+/);
    const sig = rest.join("");
    if (!/^0x[0-9a-fA-F]{40}$/.test(target) || !sig) throw new Error(`Line not understood: "${line}". Expected: 0xContract functionName(types)`);
    const selector = /^0x[0-9a-fA-F]{8}$/.test(sig) ? sig.toLowerCase() : toFunctionSelector(sig.startsWith("function") ? sig : `function ${sig}`);
    calls.push({ target, selector, label: `${sig} on ${short(target)}` });
  }
  return calls;
}

/** What the current agent is allowed to do, rebuilt from the account's events. */
async function currentPermissions(ctx, account) {
  const logs = await ctx.state.pub.getLogs({ address: account, events: ACCOUNT_EVENTS, fromBlock: BigInt(ctx.state.dep.deployBlock ?? 0) });
  let epoch = null;
  for (const l of logs) if (l.eventName === "AgentSet") epoch = l.args.epoch;
  if (epoch === null) return [];
  const allowed = new Map();
  for (const l of logs) {
    if (l.eventName !== "AgentPermissionsUpdated" || l.args.epoch !== epoch) continue;
    for (const p of l.args.permissions) {
      const key = `${p.target.toLowerCase()}:${p.selector}`;
      if (l.args.allowed) allowed.set(key, p);
      else allowed.delete(key);
    }
  }
  return [...allowed.values()];
}

function describe(perm, presets) {
  for (const p of presets) {
    const c = p.calls.find((c) => c.target.toLowerCase() === perm.target.toLowerCase() && c.selector === perm.selector);
    if (c) return esc(c.label ?? p.title);
  }
  return `function <code>${perm.selector}</code> on ${short(perm.target)}${RISKY[perm.selector] ? ` <span class="risk">${RISKY[perm.selector]}</span>` : ""}`;
}

/**
 * ctx = { state, send, readAt, ABI, toast, reload }
 */
export async function holderPanel(ctx, host, id, account, agentInfo, lockedUntil) {
  const presets = await loadPresets();
  const [agent, , expiry, active, allowance] = agentInfo;
  const lockedNow = Number(lockedUntil) * 1000 > Date.now();
  const perms = active ? await currentPermissions(ctx, account).catch(() => []) : [];
  const limited = presets.find((p) => p.dailyLimit);
  let tradeLine = "";
  if (active && limited) {
    try {
      const [left, cap] = await Promise.all([
        ctx.state.pub.readContract({ address: limited.dailyLimit.target, abi: TRADER_VIEW, functionName: "leftToday", args: [account] }),
        ctx.state.pub.readContract({ address: limited.dailyLimit.target, abi: TRADER_VIEW, functionName: "dailyLimit", args: [account] }),
      ]);
      const usd = (v) => `$${(Number(v) / 10 ** limited.dailyLimit.decimals).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
      if (cap > 0n) tradeLine = `<p>Trading allowance: <b>${usd(left)}</b> left today, out of <b>${usd(cap)}</b> per day.</p>`;
    } catch {}
  }

  let strategyLine = "";
  const byStrategyAgent = active && ctx.state.dep.strategyAgent && agent.toLowerCase() === ctx.state.dep.strategyAgent.toLowerCase();
  if (ctx.state.dep.trader) {
    try {
      const s = await ctx.state.pub.readContract({ address: ctx.state.dep.trader, abi: TRADER, functionName: "strategyOf", args: [account] });
      if (Number(s.kind)) strategyLine = `<p>Strategy${byStrategyAgent ? " (run by the NEONFACES strategy agent)" : ""}: <b>${esc(describeStrategy(ctx.state.dep, s))}</b></p>`;
    } catch {}
  }
  const tokens = tokenList(ctx.state.dep);
  const opts = (list, sel) => list.map((t) => `<option ${t.symbol === sel ? "selected" : ""}>${esc(t.symbol)}</option>`).join("");

  const box = document.createElement("div");
  box.id = "face-holder";
  box.className = "holder-panel";
  box.innerHTML = `
    <h3>Your Face · controls</h3>
    <section class="hp-card hp-prepared" id="hp-prepared" hidden></section>

    <section class="hp-card">
      <h4>Agent</h4>
      ${
        active
          ? `<p>An agent is working for this Face: <b>${byStrategyAgent ? "the NEONFACES strategy agent" : short(agent)}</b></p>${strategyLine}
             <p>It can:</p><ul class="hp-list">${perms.length ? perms.map((p) => `<li>${describe(p, presets)}</li>`).join("") : "<li>nothing yet</li>"}</ul>
             ${tradeLine}
             <p>Spending limit left: <b>${formatEther(allowance)} ETH</b> · stops on <b>${niceDate(expiry)}</b>, or immediately if you sell this Face.</p>
             <div class="row"><button class="btn btn-ghost" id="hp-stop">Stop the agent now</button><button class="btn btn-ghost" id="hp-limit">Change the ETH limit</button>${limited ? `<button class="btn btn-ghost" id="hp-daily">Change the daily trading limit</button>` : ""}</div>`
          : `<p>No agent. This Face only does what you do.</p>`
      }
    </section>

    ${
      ctx.state.dep.strategyAgent && tokens.length
        ? `<details class="hp-card" id="hp-strategy">
      <summary>Let this Face follow a strategy</summary>
      <p class="fine">No bot of your own needed: the NEONFACES strategy agent runs it for you, with the same limits as any agent. Every trade is checked against Chainlink, comes back into the Face, and is explained in its journal.</p>
      <div class="hp-form">
        <label><input type="radio" name="hp-kind" value="accumulate" checked> <b>Accumulate</b> buy one ticker regularly</label>
        <label><input type="radio" name="hp-kind" value="keep-liquid"> <b>Keep some liquid</b> hold a minimum share in USDG</label>
        <label><input type="radio" name="hp-kind" value="trim"> <b>Trim</b> sell a ticker when it grows too big</label>
        <div class="hp-row" data-k="accumulate">Buy <select id="hp-s-token">${opts(tokens.filter((t) => t.symbol !== "USDG" && t.symbol !== "ETH"), "TSLA")}</select> with $<input id="hp-s-usd" value="10" inputmode="decimal" size="5"> of <select id="hp-s-funding">${opts(tokens.filter((t) => t.symbol === "USDG" || t.symbol === "ETH"), "USDG")}</select> every <select id="hp-s-every"><option value="1d">day</option><option value="7d" selected>week</option><option value="30d">month</option></select></div>
        <div class="hp-row" data-k="keep-liquid" hidden>Keep at least <input id="hp-s-liquid" value="40" inputmode="decimal" size="3">% in USDG</div>
        <div class="hp-row" data-k="trim" hidden>Sell <select id="hp-s-trim">${opts(tokens.filter((t) => t.symbol !== "USDG" && t.symbol !== "ETH"), "TSLA")}</select> above <input id="hp-s-cap" value="50" inputmode="decimal" size="3">% of the Face</div>
        <div class="hp-row">For <select id="hp-s-days"><option>30</option><option selected>90</option><option>180</option><option>365</option></select> days · at most $<input id="hp-s-daily" value="200" inputmode="decimal" size="5"> of trades per day</div>
      </div>
      <div class="hp-summary" id="hp-s-summary"></div>
      <button class="btn btn-neon btn-wide" id="hp-s-go">Review</button>
    </details>`
        : ""
    }

    ${
      tokens.length
        ? `<details class="hp-card" id="hp-move">
      <summary>Withdraw or trade what's inside</summary>
      <div class="hp-form">
        <div class="hp-row"><b>Withdraw</b> <select id="hp-w-token"><option value="all">everything</option>${opts(tokens)}</select> amount <input id="hp-w-amount" placeholder="all" inputmode="decimal" size="8"> to your wallet <button class="btn btn-ghost" id="hp-w-go">Review</button></div>
        <div class="hp-row"><b>Trade</b> <input id="hp-t-amount" value="10" inputmode="decimal" size="8"> <select id="hp-t-from">${opts(tokens, "USDG")}</select> for <select id="hp-t-to">${opts(tokens, "TSLA")}</select> <button class="btn btn-ghost" id="hp-t-go">Review</button></div>
      </div>
      <div class="hp-summary" id="hp-m-summary"></div>
    </details>`
        : ""
    }

    <details class="hp-card" id="hp-wizard" ${active ? "" : "open"}>
      <summary>${active ? "Replace the agent" : "Set up an agent"}</summary>
      <ol class="hp-steps">
        <li>
          <b>Paste your agent's address</b>
          <p class="fine">The app or AI service you want to use shows you this address. It will never get your keys, your Face, or anything you don't allow below. It can't sign for you.</p>
          <input id="hp-agent" placeholder="0x…" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false">
        </li>
        <li>
          <b>What can it do?</b>
          ${
            presets.length
              ? `<div class="hp-presets">${presets
                  .map(
                    (p) => `<label class="hp-preset"><input type="checkbox" value="${esc(p.id)}" ${presets.length === 1 ? "checked" : ""}>
                      <span><b>${esc(p.title)}</b> <em class="badge ${p.risk === "low" ? "ok" : "warn"}">${p.risk === "low" ? "low risk" : "be careful"}</em><br>${esc(p.plain)}</span></label>`,
                  )
                  .join("")}</div>`
              : `<p class="fine">No ready-made actions are published yet. Use "Advanced" only if a developer gave you exact instructions.</p>`
          }
          <details class="hp-adv"><summary>Advanced (developers)</summary>
            <p class="fine">One per line: <code>0xContract functionName(types)</code></p>
            <textarea id="hp-advanced" rows="3" spellcheck="false"></textarea>
          </details>
        </li>
        <li>
          <b>For how long?</b>
          <div class="chips" id="hp-days">${[1, 7, 30, 90].map((d) => `<button type="button" data-v="${d}" class="${d === 30 ? "on" : ""}">${d === 1 ? "1 day" : `${d} days`}</button>`).join("")}</div>
        </li>
        <li>
          <b>How much ETH can it spend, at most?</b>
          <p class="fine">Taken from this Face's wallet, never from yours. Zero means it can't spend ETH at all.</p>
          <div class="chips" id="hp-eth">${["0", "0.01", "0.05", "0.1"].map((v) => `<button type="button" data-v="${v}" class="${v === "0" ? "on" : ""}">${v} ETH</button>`).join("")}<input id="hp-eth-custom" placeholder="other" inputmode="decimal"></div>
        </li>
        <li id="hp-day-step" hidden>
          <b>How much can it trade per day, at most?</b>
          <p class="fine">In dollars, counted at Chainlink prices. It resets every day at 00:00 UTC.</p>
          <div class="chips" id="hp-usd">${["50", "200", "1000"].map((v) => `<button type="button" data-v="${v}" class="${v === "200" ? "on" : ""}">$${Number(v).toLocaleString("en-US")}</button>`).join("")}<input id="hp-usd-custom" placeholder="other" inputmode="decimal"></div>
        </li>
      </ol>
      <div class="hp-summary" id="hp-summary"></div>
      <button class="btn btn-neon btn-wide" id="hp-confirm">Review and confirm</button>
    </details>

    <details class="hp-card" ${lockedNow ? "open" : ""}>
      <summary>Selling this Face? Lock its wallet</summary>
      ${lockedNow ? `<p class="neon">Locked until <b>${niceDate(lockedUntil)}</b>. Until then nothing leaves this wallet through you, an agent or a signature. Revoke any token approvals too (listed above), so buyers get exactly what they see.</p>` : ""}
      <p class="fine">While locked, nobody (not you, not your agent) can move anything out of this Face's wallet. The Face itself can still be sold, and the lock goes with it, so a buyer knows the contents can't disappear before the sale. You can extend a lock, never shorten it.</p>
      <div class="chips" id="hp-lock">${[1, 3, 7, 30].map((d) => `<button type="button" data-v="${d}" class="${d === 7 ? "on" : ""}">${d === 1 ? "until tomorrow" : `${d} days`}</button>`).join("")}</div>
      <button class="btn btn-neon" id="hp-lock-go">${lockedNow ? "Extend the lock" : "Lock the wallet"}</button>
    </details>`;
  host.after(box);

  // ---- chips
  const pick = (groupId) => {
    const g = box.querySelector(`#${groupId}`);
    g.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      g.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      if (groupId === "hp-eth") box.querySelector("#hp-eth-custom").value = "";
      if (groupId === "hp-usd") box.querySelector("#hp-usd-custom").value = "";
      summary();
    });
  };
  ["hp-days", "hp-eth", "hp-lock", "hp-usd"].forEach(pick);
  const chosen = (groupId) => box.querySelector(`#${groupId} button.on`)?.dataset.v;

  // ---- wizard state
  function plan() {
    const agentAddr = box.querySelector("#hp-agent").value.trim();
    const selected = presets.filter((p) => box.querySelector(`.hp-preset input[value="${CSS.escape(p.id)}"]`)?.checked);
    let calls = selected.flatMap((p) => p.calls);
    const approvals = selected.flatMap((p) => p.approvals ?? []);
    const advanced = parseAdvanced(box.querySelector("#hp-advanced").value);
    calls = [...calls, ...advanced];
    const custom = box.querySelector("#hp-eth-custom").value.trim();
    const eth = custom || chosen("hp-eth") || "0";
    const days = Number(chosen("hp-days") || 30);
    const risky = advanced.filter((c) => RISKY[c.selector]).map((c) => `${c.label}: ${RISKY[c.selector]}`);
    const limits = selected.filter((p) => p.dailyLimit).map((p) => p.dailyLimit);
    box.querySelector("#hp-day-step").hidden = limits.length === 0;
    const usd = box.querySelector("#hp-usd-custom").value.trim() || chosen("hp-usd") || "200";
    return { agentAddr, selected, calls, approvals, eth, days, risky, limits, usd, needsEth: selected.some((p) => p.needsEth) || advanced.length > 0 };
  }

  function summary() {
    const el = box.querySelector("#hp-summary");
    let p;
    try {
      p = plan();
    } catch (e) {
      el.innerHTML = `<p class="msg err">${esc(e.message)}</p>`;
      return null;
    }
    const ok = /^0x[0-9a-fA-F]{40}$/.test(p.agentAddr);
    const lines = [];
    if (!ok) lines.push(`<li class="todo">Paste the agent's address (step 1).</li>`);
    if (!p.calls.length) lines.push(`<li class="todo">Choose at least one thing it can do (step 2).</li>`);
    if (ok && p.calls.length) {
      lines.push(`<li><b>${short(p.agentAddr)}</b> will be able to: ${[...p.selected.map((s) => esc(s.title)), ...(p.calls.length > p.selected.flatMap((s) => s.calls).length ? ["custom actions (advanced)"] : [])].join(", ")}.</li>`);
      lines.push(`<li>It can spend at most <b>${esc(p.eth)} ETH</b> from this Face's wallet${p.needsEth || Number(p.eth) === 0 ? "" : " (the actions you picked don't need ETH)"}.</li>`);
      lines.push(`<li>It stops in <b>${p.days} day${p.days > 1 ? "s" : ""}</b>, or the moment you sell this Face. You can stop it any time.</li>`);
      lines.push(`<li>It can't sign for you, can't take the Face, and can't do anything else.</li>`);
      if (p.limits.length) lines.push(`<li>It can trade at most <b>$${esc(Number(p.usd).toLocaleString("en-US"))} per day</b>, at prices checked against Chainlink.</li>`);
      if (p.approvals.length || p.limits.length) lines.push(`<li>First, one setup transaction${p.approvals.length ? ` lets the trading contract use ${[...new Set(p.approvals.map((a) => esc(a.label)))].join(", ")}, and it can only ever pay this Face back` : ""}${p.limits.length ? `${p.approvals.length ? " and" : ""} sets the daily limit` : ""}.</li>`);
      if (p.risky.length) lines.push(`<li class="risk">Careful: your advanced lines include ${p.risky.map(esc).join("; ")}.</li>`);
    }
    el.innerHTML = `<ul>${lines.join("")}</ul>`;
    const btn = box.querySelector("#hp-confirm");
    btn.disabled = !(ok && p.calls.length);
    btn.textContent = p.approvals.length || p.limits.length ? "Confirm (2 transactions)" : "Confirm (1 transaction)";
    return ok && p.calls.length ? p : null;
  }
  box.querySelector("#hp-wizard").addEventListener("input", summary);
  box.querySelector("#hp-wizard").addEventListener("change", summary);
  summary();

  // ---- actions
  box.querySelector("#hp-confirm").onclick = async () => {
    const p = summary();
    if (!p) return;
    if (p.risky.length && !confirm(`These advanced permissions can move assets out of your Face:\n\n${p.risky.join("\n")}\n\nContinue?`)) return;
    let eth;
    try {
      eth = parseEther(p.eth);
    } catch {
      return ctx.toast("The ETH amount isn't a number.");
    }
    let usd8;
    try {
      usd8 = p.limits.map((l) => BigInt(Math.round(Number(p.usd) * 10 ** l.decimals)));
    } catch {
      return ctx.toast("The daily amount isn't a number.");
    }
    const setup = [
      ...p.approvals.map((a) => ({ target: a.token, value: 0n, data: encodeFunctionData({ abi: ERC20_APPROVE, functionName: "approve", args: [a.spender, maxUint256] }) })),
      ...p.limits.map((l, i) => {
        const item = parseAbiItem(`function ${l.signature}`);
        return { target: l.target, value: 0n, data: encodeFunctionData({ abi: [item], functionName: item.name, args: [usd8[i]] }) };
      }),
    ];
    if (setup.length) {
      const ok = await ctx.send(account, ctx.ABI.accountExec, "executeBatch", [setup, 0], null);
      if (!ok) return;
    }
    const expiry = BigInt(Math.floor((Date.now() + p.days * dayMs) / 1000));
    const permissions = p.calls.map((c) => ({ target: c.target, selector: c.selector }));
    await ctx.send(account, ctx.ABI.account, "setAgent", [p.agentAddr, expiry, permissions, eth], ctx.reload);
  };

  box.querySelector("#hp-stop")?.addEventListener("click", () => {
    if (confirm("Stop the agent now? It will lose every permission immediately.")) ctx.send(account, ctx.ABI.account, "revokeAgent", [], ctx.reload);
  });
  box.querySelector("#hp-limit")?.addEventListener("click", () => {
    const v = prompt("New spending limit in ETH (what the agent may still spend from this Face's wallet):", "0");
    if (v === null) return;
    try {
      ctx.send(account, ctx.ABI.account, "setAgentValueAllowance", [parseEther(v.trim())], ctx.reload);
    } catch {
      ctx.toast("That isn't a number.");
    }
  });
  box.querySelector("#hp-daily")?.addEventListener("click", () => {
    const v = prompt("New daily trading limit in US dollars (0 stops trading):", "200");
    if (v === null) return;
    const n = Number(v.trim());
    if (!Number.isFinite(n) || n < 0) return ctx.toast("That isn't a number.");
    const item = parseAbiItem(`function ${limited.dailyLimit.signature}`);
    const data = encodeFunctionData({ abi: [item], functionName: item.name, args: [BigInt(Math.round(n * 10 ** limited.dailyLimit.decimals))] });
    ctx.send(account, ctx.ABI.accountExec, "executeBatch", [[{ target: limited.dailyLimit.target, value: 0n, data }], 0], ctx.reload);
  });
  // ---- actions shared with prepared links (actions.js): review in plain words, then confirm
  const review = async (el, action, confirmLabel = "Confirm") => {
    el.innerHTML = `<p class="fine">Preparing…</p>`;
    try {
      const built = await build(ctx, account, ctx.state.account, action);
      el.innerHTML = `<p>${esc(built.text)}</p><button class="btn btn-neon">${confirmLabel} (${built.txs.length} transaction${built.txs.length > 1 ? "s" : ""})</button>`;
      el.querySelector("button").onclick = () => run(ctx, account, built);
    } catch (e) {
      el.innerHTML = `<p class="msg err">${esc(e.shortMessage ?? e.message)}</p>`;
    }
  };
  const q = (s) => box.querySelector(s);
  if (q("#hp-strategy")) {
    const kind = () => q('input[name="hp-kind"]:checked').value;
    q("#hp-strategy").addEventListener("change", () => q("#hp-strategy").querySelectorAll(".hp-row[data-k]").forEach((r) => (r.hidden = r.dataset.k !== kind())));
    q("#hp-s-go").onclick = () => {
      const k = kind();
      const p = new URLSearchParams({ do: "strategy", kind: k, days: q("#hp-s-days").value, cap: q("#hp-s-daily").value, every: k === "accumulate" ? q("#hp-s-every").value : "1d" });
      if (k === "accumulate") {
        p.set("token", q("#hp-s-token").value);
        p.set("funding", q("#hp-s-funding").value);
        p.set("usd", q("#hp-s-usd").value);
        if (q("#hp-s-funding").value === "ETH") p.set("eth", "0.05");
      }
      if (k === "keep-liquid") p.set("percent", q("#hp-s-liquid").value);
      if (k === "trim") (p.set("token", q("#hp-s-trim").value), p.set("percent", q("#hp-s-cap").value));
      try {
        review(q("#hp-s-summary"), parseLink(ctx.state.dep, p), "Start");
      } catch (e) {
        q("#hp-s-summary").innerHTML = `<p class="msg err">${esc(e.message)}</p>`;
      }
    };
  }
  if (q("#hp-move")) {
    q("#hp-w-go").onclick = () => {
      const p = new URLSearchParams({ do: "withdraw", token: q("#hp-w-token").value });
      if (q("#hp-w-amount").value.trim() && q("#hp-w-token").value !== "all") p.set("amount", q("#hp-w-amount").value.trim());
      try {
        review(q("#hp-m-summary"), parseLink(ctx.state.dep, p), "Withdraw");
      } catch (e) {
        q("#hp-m-summary").innerHTML = `<p class="msg err">${esc(e.message)}</p>`;
      }
    };
    q("#hp-t-go").onclick = () => {
      try {
        review(q("#hp-m-summary"), parseLink(ctx.state.dep, new URLSearchParams({ do: "trade", from: q("#hp-t-from").value, to: q("#hp-t-to").value, amount: q("#hp-t-amount").value })), "Trade");
      } catch (e) {
        q("#hp-m-summary").innerHTML = `<p class="msg err">${esc(e.message)}</p>`;
      }
    };
  }
  // a prepared action from a link (e.g. written by an AI assistant): shown first, never sent without a click
  const params = new URLSearchParams(location.search);
  if (params.get("do")) {
    const el = q("#hp-prepared");
    el.hidden = false;
    let action;
    try {
      action = parseLink(ctx.state.dep, params);
    } catch (e) {
      el.innerHTML = `<h4>Prepared action</h4><p class="msg err">This link asks for something the Face page can't do: ${esc(e.message)}</p>`;
    }
    if (action) {
      el.innerHTML = `<h4>Prepared for you</h4><p class="fine">A link opened this page with an action ready. Read it: nothing happens until you confirm in your wallet.</p><div class="hp-summary"></div><button class="btn btn-ghost" id="hp-p-no">Dismiss</button>`;
      review(el.querySelector(".hp-summary"), action);
      q("#hp-p-no").onclick = () => {
        history.replaceState({}, "", location.pathname);
        el.hidden = true;
      };
    }
  }

  box.querySelector("#hp-lock-go").onclick = () => {
    const days = Number(chosen("hp-lock") || 7);
    const until = Math.max(Date.now() + days * dayMs, Number(lockedUntil) * 1000 + 60_000);
    const msg = `Lock this Face's wallet until ${new Date(until).toLocaleString("en-GB")}?\n\nUntil then nobody, not even you, can move anything out of it. It can't be undone or shortened.`;
    if (confirm(msg)) ctx.send(account, ctx.ABI.account, "lock", [BigInt(Math.floor(until / 1000))], ctx.reload);
  };
}
