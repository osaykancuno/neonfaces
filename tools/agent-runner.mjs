// The NEONFACES strategy agent: runs the standing strategies holders leave on NeonTrader, for every Face that
// delegated to this agent's address. It is an ordinary scoped agent: it can only call NeonTrader.swapWithNote
// through the Face (output back into the Face, at most 2% under the Chainlink price, the holder's daily USD cap),
// and each move carries a short note that the Face's journal shows.
//
//   RUNNER_PK=<strategy agent key> node agent-runner.mjs <chainId> [--once] [--dry]
//   env: RPC_URL, RUNNER_STATE (JSON carried between --once runs), INTERVAL (seconds, default 600)
//
// Strategies (NeonTrader.setStrategy, chosen by the holder on the Face page):
//   1 ACCUMULATE   buy `token` for `usd8` dollars of `funding` (USDG, or ETH within the agent's ETH budget), every `every` s
//   2 KEEP_LIQUID  keep at least `bps` of the Face's value in `token` (USDG): sell the largest holding when below
//   3 TRIM         sell `token` into `funding` when it is more than `bps` of the Face's value
// A 2-point band avoids trading back and forth; moves under $1 are skipped; stale prices (weekends) skip the run.
// Scheduled by .github/workflows/keeper.yml next to the keeper (no server).
import { route as routeOf } from "./route.mjs";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi, parseAbiItem, encodeFunctionData, formatUnits, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = dirname(fileURLToPath(import.meta.url));
const chainId = Number(process.argv[2] ?? 4663);
const once = process.argv.includes("--once");
const dry = process.argv.includes("--dry");
const INTERVAL = Number(process.env.INTERVAL ?? 600);
const STATE = process.env.RUNNER_STATE;
const BAND_BPS = 200n; // 2 points either side of a target
const MIN_USD8 = 1n * 10n ** 8n;
const SLIPPAGE = 50n;

const dep = JSON.parse(readFileSync(resolve(here, `../contracts/deployments/${chainId}.json`), "utf8"));
const cfg = JSON.parse(readFileSync(resolve(here, `../config/trader.${chainId}.json`), "utf8"));
const rpc = process.env.RPC_URL || { 4663: "https://rpc.mainnet.chain.robinhood.com", 46630: "https://rpc.testnet.chain.robinhood.com" }[chainId];
if (!process.env.RUNNER_PK) throw new Error("set RUNNER_PK (the strategy agent key: gas only, holders delegate to its address)");
if (!dep.trader) throw new Error("deployments file needs trader");
const chain = { id: chainId, name: "robinhood", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
const me = privateKeyToAccount(process.env.RUNNER_PK);
const pub = createPublicClient({ chain, transport: http(rpc, { batch: true }) });
const wallet = createWalletClient({ account: me, chain, transport: http(rpc) });

const abi = parseAbi([
  "function strategyOf(address) view returns ((uint8 kind, address token, address funding, uint16 bps, uint32 every, uint96 usd8))",
  "function price(address) view returns (uint256)",
  "function leftToday(address) view returns (uint256)",
  "function swapWithNote(address[] path, uint24[] fees, uint256 amountIn, uint256 slippageBps, string note) payable returns (uint256)",
  "function agentConfig() view returns (address agent, address grantor, uint64 expiry, bool active, uint256 valueAllowance)",
  "function effectiveLockedUntil() view returns (uint64)",
  "function executeAsAgent(address target, uint256 value, bytes data) returns (bytes)",
  "function token() view returns (uint256 chainId, address tokenContract, uint256 tokenId)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "error AgentNotActive()",
  "error AgentCallNotAllowed(address target, bytes4 selector)",
  "error AgentValueExceeded(uint256 requested, uint256 remaining)",
  "error AccountIsLocked(uint64 until)",
  "error DailyLimitExceeded(uint256 requestedUsd8, uint256 leftUsd8)",
  "error StalePrice(address token, uint256 updatedAt)",
]);
const STRATEGY_SET = parseAbiItem("event StrategySet(address indexed account, (uint8 kind, address token, address funding, uint16 bps, uint32 every, uint96 usd8) strategy)");
const read = (address, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const tokens = cfg.tokens.map((t) => ({ ...t, address: getAddress(t.address), dec: t.symbol === "WETH" ? 18 : t.decimals ?? null }));
for (const t of tokens) if (t.dec == null) t.dec = Number(await read(t.address, "decimals"));
const bySym = Object.fromEntries(tokens.map((t) => [t.symbol, t]));
const byAddr = Object.fromEntries(tokens.map((t) => [t.address.toLowerCase(), t]));
const USDG = bySym.USDG;
const WETH = bySym.WETH;
const symOf = (a) => (a.toLowerCase() === WETH.address.toLowerCase() ? "ETH" : byAddr[a.toLowerCase()]?.symbol ?? "?");

/** v3 route through the hubs (tools/route.mjs). */
const route = (from, to) => routeOf(tokens, from, to);

// ---- state: accounts with a strategy, last move per account, last block scanned
let st = { trader: dep.trader, fromBlock: String(dep.deployBlock ?? 0), accounts: {}, lastMove: {} };
if (STATE && existsSync(STATE)) {
  const j = JSON.parse(readFileSync(STATE, "utf8"));
  if (j.trader === dep.trader) st = j;
}
const save = () => STATE && writeFileSync(STATE, JSON.stringify(st));

async function discover() {
  const latest = await pub.getBlockNumber();
  let from = BigInt(st.fromBlock);
  const step = 50_000n;
  while (from <= latest) {
    const to = from + step - 1n < latest ? from + step - 1n : latest;
    const logs = await pub.getLogs({ address: dep.trader, event: STRATEGY_SET, fromBlock: from, toBlock: to });
    for (const l of logs) {
      if (l.args.strategy.kind === 0) delete st.accounts[l.args.account];
      else st.accounts[l.args.account] = true;
    }
    from = to + 1n;
  }
  st.fromBlock = String(latest + 1n);
}

/** Value of each listed holding (USD, 8 decimals), ETH included. */
async function holdings(account) {
  const out = [];
  for (const t of tokens) {
    const bal = t === WETH ? await pub.getBalance({ address: account }) : await read(t.address, "balanceOf", [account]);
    if (bal === 0n) continue;
    const px = await read(dep.trader, "price", [t.address]);
    out.push({ t, bal, usd8: (bal * px) / 10n ** BigInt(t.dec) });
  }
  return out;
}

const amountFor = (usd8, px, dec) => (usd8 * 10n ** BigInt(dec)) / px;
const pct = (bps) => `${(Number(bps) / 100).toFixed(0)}%`;
const usd = (v) => `$${(Number(v) / 1e8).toFixed(2)}`;
const EVERY = (s) => (s % 604_800 === 0 ? `${s / 604_800}w` : s % 86_400 === 0 ? `${s / 86_400}d` : `${Math.round(s / 3600)}h`);

/** Decide one move for this account, or null. */
async function plan(account, s) {
  const left = await read(dep.trader, "leftToday", [account]);
  if (s.kind === 1) {
    const from = byAddr[s.funding.toLowerCase()];
    const to = byAddr[s.token.toLowerCase()];
    let v = BigInt(s.usd8);
    if (v > left) v = left;
    const px = await read(dep.trader, "price", [from.address]);
    const amountIn = amountFor(v, px, from.dec);
    const bal = from === WETH ? await pub.getBalance({ address: account }) : await read(from.address, "balanceOf", [account]);
    if (bal < amountIn) return { skip: `not enough ${symOf(from.address)} to accumulate (${formatUnits(bal, from.dec)})` };
    return { from, to, amountIn, v, note: `accumulate ${symOf(to.address)}: ${usd(s.usd8)} every ${EVERY(s.every)}` };
  }
  const h = await holdings(account);
  const total = h.reduce((a, x) => a + x.usd8, 0n);
  if (total === 0n) return { skip: "empty Face" };
  if (s.kind === 2) {
    const stable = byAddr[s.token.toLowerCase()];
    const have = h.find((x) => x.t === stable)?.usd8 ?? 0n;
    const target = (total * BigInt(s.bps)) / 10_000n;
    if (have * 10_000n >= target * 10_000n - total * BAND_BPS) return { skip: `${symOf(stable.address)} at ${pct((have * 10_000n) / total)}, target ${pct(s.bps)}` };
    const sellable = h.filter((x) => x.t !== stable && x.t !== WETH).sort((a, b) => (b.usd8 > a.usd8 ? 1 : -1));
    if (!sellable.length) return { skip: "nothing to sell" };
    const from = sellable[0];
    let v = target - have;
    if (v > from.usd8) v = from.usd8;
    if (v > left) v = left;
    const amountIn = (from.bal * v) / from.usd8;
    return { from: from.t, to: stable, amountIn, v, note: `keep ${pct(s.bps)} liquid: ${symOf(stable.address)} ${pct((have * 10_000n) / total)} -> ${pct(((have + v) * 10_000n) / total)}` };
  }
  if (s.kind === 3) {
    const tok = byAddr[s.token.toLowerCase()];
    const x = h.find((y) => y.t === tok);
    if (!x) return { skip: `no ${symOf(tok.address)}` };
    const cap = (total * BigInt(s.bps)) / 10_000n;
    if (x.usd8 * 10_000n <= cap * 10_000n + total * BAND_BPS) return { skip: `${symOf(tok.address)} at ${pct((x.usd8 * 10_000n) / total)}, cap ${pct(s.bps)}` };
    let v = x.usd8 - cap;
    if (v > left) v = left;
    const amountIn = (x.bal * v) / x.usd8;
    return { from: tok, to: byAddr[s.funding.toLowerCase()], amountIn, v, note: `trim ${symOf(tok.address)} above ${pct(s.bps)}: ${pct((x.usd8 * 10_000n) / total)} -> ${pct(((x.usd8 - v) * 10_000n) / total)}` };
  }
  return null;
}

async function runAccount(account) {
  const [agent, , , active, allowance] = await read(account, "agentConfig");
  if (!active || agent.toLowerCase() !== me.address.toLowerCase()) return; // not (or no longer) delegated to us
  if (Number(await read(account, "effectiveLockedUntil")) * 1000 > Date.now()) return;
  const s = await read(dep.trader, "strategyOf", [account]);
  if (s.kind === 0) return;
  const last = st.lastMove[account] ?? 0;
  if (Date.now() / 1000 < last + s.every) return;
  const [, , faceId] = await read(account, "token");
  let m;
  try {
    m = await plan(account, s);
  } catch (e) {
    return log(`Face #${faceId}: waiting (${e.shortMessage ?? e.message})`); // stale prices at weekends
  }
  if (!m) return;
  if (m.skip) {
    if (s.kind !== 1) st.lastMove[account] = Math.floor(Date.now() / 1000); // checked: nothing to do this period
    return log(`Face #${faceId}: ${m.skip}`);
  }
  if (m.v < MIN_USD8 || m.amountIn === 0n) return log(`Face #${faceId}: move under $1 (daily cap or tiny balance), skipped`);
  const value = m.from === WETH ? m.amountIn : 0n;
  if (value > allowance) return log(`Face #${faceId}: ETH budget too low for ${m.note}`);
  const { path, fees } = route(m.from, m.to);
  const data = encodeFunctionData({ abi, functionName: "swapWithNote", args: [path, fees, m.amountIn, SLIPPAGE, m.note] });
  log(`Face #${faceId}: ${m.note} (${formatUnits(m.amountIn, m.from.dec)} ${symOf(m.from.address)}, ${usd(m.v)})${dry ? " [dry]" : ""}`);
  if (dry) return;
  const { request } = await pub.simulateContract({ address: account, abi, functionName: "executeAsAgent", args: [dep.trader, value, data], account: me });
  const hash = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`reverted ${hash}`);
  st.lastMove[account] = Math.floor(Date.now() / 1000);
  log(`  done ${hash}`);
}

async function round() {
  await discover();
  const accounts = Object.keys(st.accounts);
  for (const a of accounts) {
    try {
      await runAccount(a);
    } catch (e) {
      log(`${a}: ${e.shortMessage ?? e.message}`);
    }
  }
  log(`strategies ${accounts.length} · agent ${me.address}`);
}

do {
  try {
    await round();
  } catch (e) {
    log("round failed:", e.shortMessage ?? e.message);
  }
  save();
  if (!once) await new Promise((r) => setTimeout(r, INTERVAL * 1000));
} while (!once);
