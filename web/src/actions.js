// Holder actions on a Face, and the action links an AI assistant (or anyone) can prepare for a holder.
//
// A link only PREPARES an action: the Face page shows it in plain words and nothing happens until the holder
// confirms in their own wallet. What a link can ask is deliberately narrow:
//   ?do=trade&from=USDG&to=TSLA&amount=20                 trade inside the Face through NeonTrader (fair price, back into the Face)
//   ?do=withdraw&token=TSLA|all[&amount=0.5]              move tokens/ETH from the Face to the holder's own wallet (never elsewhere)
//   ?do=lock&days=7                                       lock the Face's wallet (1..365 days)
//   ?do=strategy&kind=accumulate&token=TSLA&funding=USDG&usd=5&every=7d[&days=90&cap=50&eth=0]
//   ?do=strategy&kind=keep-liquid&percent=40[...]         ?do=strategy&kind=trim&token=TSLA&percent=50[...]
//   ?do=stop-agent                                        revoke the agent
// Strategies are always delegated to the published NEONFACES strategy agent, never to an address from a link.
import { parseAbi, parseUnits, formatUnits, encodeFunctionData, maxUint256, getAddress, toFunctionSelector } from "viem";

export const TRADER = parseAbi([
  "function swapWithNote(address[] path, uint24[] fees, uint256 amountIn, uint256 slippageBps, string note) payable returns (uint256)",
  "function quote(address[] path, uint24[] fees, uint256 amountIn, uint256 slippageBps) view returns (uint256 minOut, uint256 valueUsd8)",
  "function setDailyLimit(uint256 usd8)",
  "function dailyLimit(address) view returns (uint256)",
  "function leftToday(address) view returns (uint256)",
  "function setStrategy((uint8 kind, address token, address funding, uint16 bps, uint32 every, uint96 usd8) s)",
  "function strategyOf(address) view returns ((uint8 kind, address token, address funding, uint16 bps, uint32 every, uint96 usd8))",
]);
const ERC20 = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]);
export const KINDS = { accumulate: 1, "keep-liquid": 2, trim: 3 };
const EVERY = { "1d": 86_400, "7d": 604_800, "30d": 2_592_000 };
const SLIPPAGE = 50n;

const dec = new Map();
async function decimalsOf(ctx, t) {
  if (t.symbol === "ETH" || t.symbol === "WETH") return 18;
  if (!dec.has(t.address)) dec.set(t.address, ctx.state.pub.readContract({ address: t.address, abi: ERC20, functionName: "decimals" }).then(Number));
  return dec.get(t.address);
}

/** Tradable tokens from deployment.json, with ETH standing for WETH. */
export function tokenList(dep) {
  return (dep.tradeTokens ?? []).map((t) => ({ ...t, address: getAddress(t.address), symbol: t.symbol === "WETH" ? "ETH" : t.symbol }));
}
const find = (dep, sym) => tokenList(dep).find((t) => t.symbol === String(sym ?? "").toUpperCase());

/** v3 route: direct when one side is USDG, otherwise through USDG. */
export function route(dep, from, to) {
  const usdg = find(dep, "USDG");
  const path = [from];
  if (from.symbol !== "USDG" && to.symbol !== "USDG") path.push(usdg);
  path.push(to);
  return { path: path.map((t) => t.address), fees: path.slice(1).map((t, i) => (path[i].symbol === "USDG" ? t.fee : path[i].fee)) };
}

export function describeStrategy(dep, s) {
  const sym = (a) => tokenList(dep).find((t) => t.address.toLowerCase() === a.toLowerCase())?.symbol ?? "?";
  const every = (sec) => {
    const [n, unit] = sec % 604_800 === 0 ? [sec / 604_800, "week"] : sec % 86_400 === 0 ? [sec / 86_400, "day"] : [Math.round(sec / 3600), "hour"];
    return n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
  };
  const kind = Number(s.kind);
  if (kind === 1) return `Buy ${sym(s.token)} with $${(Number(s.usd8) / 1e8).toLocaleString("en-US")} of ${sym(s.funding)} ${every(Number(s.every))}.`;
  if (kind === 2) return `Keep at least ${Number(s.bps) / 100}% of this Face in ${sym(s.token)}, selling its largest holding when it drops below (checked ${every(Number(s.every))}).`;
  if (kind === 3) return `When ${sym(s.token)} is more than ${Number(s.bps) / 100}% of this Face, sell the excess into ${sym(s.funding)} (checked ${every(Number(s.every))}).`;
  return "No strategy.";
}

/** Read and validate an action from a link. Returns { do, ... } or throws a message for the holder. */
export function parseLink(dep, params) {
  const act = params.get("do");
  if (!act) return null;
  const num = (k, min, max) => {
    const v = Number(params.get(k));
    if (!Number.isFinite(v) || v < min || v > max) throw new Error(`"${k}" must be a number between ${min} and ${max}.`);
    return v;
  };
  const tok = (k) => {
    const t = find(dep, params.get(k));
    if (!t) throw new Error(`"${params.get(k)}" is not a token the Face can trade (${tokenList(dep).map((x) => x.symbol).join(", ")}).`);
    return t;
  };
  if (act === "trade") {
    const from = tok("from"), to = tok("to");
    if (from.symbol === to.symbol) throw new Error("Pick two different tokens.");
    return { do: "trade", from, to, amount: String(num("amount", 0, 1e12)) };
  }
  if (act === "withdraw") {
    const all = String(params.get("token")).toLowerCase() === "all";
    return { do: "withdraw", token: all ? null : tok("token"), amount: params.get("amount") && params.get("amount") !== "all" ? String(num("amount", 0, 1e12)) : null };
  }
  if (act === "lock") return { do: "lock", days: Math.round(num("days", 1, 365)) };
  if (act === "stop-agent") return { do: "stop-agent" };
  if (act === "strategy") {
    if (!dep.strategyAgent) throw new Error("The strategy agent isn't published yet.");
    const kind = KINDS[params.get("kind")];
    if (!kind) throw new Error('"kind" must be accumulate, keep-liquid or trim.');
    const every = EVERY[params.get("every") ?? "7d"];
    if (!every) throw new Error('"every" must be 1d, 7d or 30d.');
    const s = { kind, token: "0x0000000000000000000000000000000000000000", funding: "0x0000000000000000000000000000000000000000", bps: 0, every, usd8: 0n };
    if (kind === 1) Object.assign(s, { token: tok("token").address, funding: tok("funding").address, usd8: BigInt(Math.round(num("usd", 1, 100_000) * 1e8)) });
    if (kind === 2) Object.assign(s, { token: find(dep, "USDG").address, bps: Math.round(num("percent", 1, 99) * 100) });
    if (kind === 3) Object.assign(s, { token: tok("token").address, funding: find(dep, "USDG").address, bps: Math.round(num("percent", 1, 99) * 100) });
    return {
      do: "strategy", s,
      days: Math.round(params.get("days") ? num("days", 1, 365) : 90),
      cap: params.get("cap") ? num("cap", 1, 1_000_000) : kind === 1 ? Math.max(50, Number(s.usd8) / 1e8) : 200,
      eth: params.get("eth") ? String(num("eth", 0, 10)) : "0",
    };
  }
  throw new Error(`Unknown action "${act}".`);
}

/** Plain-language summary + the transactions to send, for one action. */
export async function build(ctx, account, holder, a) {
  const dep = ctx.state.dep;
  const pub = ctx.state.pub;
  const call = (target, abi, functionName, args, value = 0n) => ({ target, value, data: encodeFunctionData({ abi, functionName, args }) });
  if (a.do === "trade") {
    const d = await decimalsOf(ctx, a.from);
    const amountIn = parseUnits(a.amount, d);
    const { path, fees } = route(dep, a.from, a.to);
    const [minOut, usd8] = await pub.readContract({ address: dep.trader, abi: TRADER, functionName: "quote", args: [path, fees, amountIn, SLIPPAGE] });
    const [left, cap] = await Promise.all([
      pub.readContract({ address: dep.trader, abi: TRADER, functionName: "leftToday", args: [account] }),
      pub.readContract({ address: dep.trader, abi: TRADER, functionName: "dailyLimit", args: [account] }),
    ]);
    const calls = [];
    const eth = a.from.symbol === "ETH";
    if (!eth) {
      const allowance = await pub.readContract({ address: a.from.address, abi: ERC20, functionName: "allowance", args: [account, dep.trader] });
      if (allowance < amountIn) calls.push(call(a.from.address, ERC20, "approve", [dep.trader, maxUint256]));
    }
    let raise = "";
    if (usd8 > left) {
      calls.push(call(dep.trader, TRADER, "setDailyLimit", [cap + usd8 - left]));
      raise = ` The Face's daily trading limit rises to $${(Number(cap + usd8 - left) / 1e8).toFixed(2)} so this fits (it also applies to any agent).`;
    }
    calls.push(call(dep.trader, TRADER, "swapWithNote", [path, fees, amountIn, SLIPPAGE, "holder trade"], eth ? amountIn : 0n));
    const dOut = await decimalsOf(ctx, a.to);
    return {
      text: `Trade ${a.amount} ${a.from.symbol} (about $${(Number(usd8) / 1e8).toFixed(2)}) for at least ${Number(formatUnits(minOut, dOut)).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${a.to.symbol}, inside this Face. The price is checked against Chainlink and the ${a.to.symbol} comes straight back into the Face.${raise}`,
      txs: [{ kind: "batch", calls }],
    };
  }
  if (a.do === "withdraw") {
    const list = a.token ? [a.token] : tokenList(dep);
    const calls = [];
    const parts = [];
    for (const t of list) {
      const d = await decimalsOf(ctx, t);
      const bal = t.symbol === "ETH" ? await pub.getBalance({ address: account }) : await pub.readContract({ address: t.address, abi: ERC20, functionName: "balanceOf", args: [account] });
      const amt = a.amount && a.token ? parseUnits(a.amount, d) : bal;
      if (amt === 0n) continue;
      if (amt > bal) throw new Error(`The Face holds only ${formatUnits(bal, d)} ${t.symbol}.`);
      calls.push(t.symbol === "ETH" ? { target: holder, value: amt, data: "0x" } : call(t.address, ERC20, "transfer", [holder, amt]));
      parts.push(`${Number(formatUnits(amt, d)).toLocaleString("en-US", { maximumFractionDigits: 6 })} ${t.symbol}`);
    }
    if (!calls.length) throw new Error("Nothing to withdraw.");
    return { text: `Move ${parts.join(", ")} from this Face to your wallet ${holder.slice(0, 6)}…${holder.slice(-4)}. Only to you, nowhere else.`, txs: [{ kind: "batch", calls }] };
  }
  if (a.do === "lock") {
    const until = BigInt(Math.floor(Date.now() / 1000) + a.days * 86_400);
    return { text: `Lock this Face's wallet for ${a.days} day${a.days > 1 ? "s" : ""}: nothing can leave it until then, not even by you. It can't be shortened.${a.days > 30 ? " Only confirm if you chose this length yourself." : ""}`, txs: [{ kind: "account", fn: "lock", args: [until] }] };
  }
  if (a.do === "stop-agent") return { text: "Stop the agent now: it loses every permission immediately.", txs: [{ kind: "account", fn: "revokeAgent", args: [] }] };
  if (a.do === "strategy") {
    const approvals = tokenList(dep).filter((t) => t.symbol !== "ETH").map((t) => call(t.address, ERC20, "approve", [dep.trader, maxUint256]));
    const setup = [...approvals, call(dep.trader, TRADER, "setDailyLimit", [BigInt(Math.round(a.cap * 1e8))]), call(dep.trader, TRADER, "setStrategy", [a.s])];
    const expiry = BigInt(Math.floor(Date.now() / 1000) + a.days * 86_400);
    const selector = toFunctionSelector("function swapWithNote(address[],uint24[],uint256,uint256,string)");
    return {
      text: `${describeStrategy(dep, a.s)} The NEONFACES strategy agent (${dep.strategyAgent.slice(0, 6)}…${dep.strategyAgent.slice(-4)}) will do it for ${a.days} days, at most $${a.cap.toLocaleString("en-US")} of trades per day${Number(a.eth) ? ` and ${a.eth} ETH in total` : ""}. Every trade is checked against Chainlink, comes back into the Face and is explained in its journal. You can stop it any time, and it stops if you sell the Face.`,
      txs: [
        { kind: "batch", calls: setup },
        { kind: "account", fn: "setAgent", args: [dep.strategyAgent, expiry, [{ target: dep.trader, selector }], parseUnits(a.eth, 18)] },
      ],
    };
  }
  throw new Error("Unknown action.");
}

/** Send the transactions of a built action, in order. */
export async function run(ctx, account, built) {
  for (const t of built.txs) {
    const ok =
      t.kind === "batch"
        ? await ctx.send(account, ctx.ABI.accountExec, "executeBatch", [t.calls, 0], null)
        : await ctx.send(account, ctx.ABI.account, t.fn, t.args, null);
    if (!ok) return false;
  }
  ctx.reload();
  return true;
}
