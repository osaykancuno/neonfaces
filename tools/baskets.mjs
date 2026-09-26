// Resolve seed baskets from USD targets into on-chain token amounts.
//
//   node baskets.mjs [--live] [../config/baskets.plan.json]
//
// Tier 1 = base baskets (every Face, at mint); tiers 2/3 = top-ups after reveal (Watch / Heavy Stare).
// Writes ../contracts/config/baskets.<chainId>.json (read by Deploy.s.sol) and prints the
// pool budget needed to seed all 5555 Faces (per token and in USD).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseUnits, formatUnits, getAddress, createPublicClient, http, parseAbi } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const live = args.includes("--live");
const planPath = resolve(args.find((a) => !a.startsWith("--")) ?? resolve(here, "../config/baskets.plan.json"));
const plan = JSON.parse(readFileSync(planPath, "utf8"));

// --live: current prices from the Chainlink feeds (8 decimals), refusing stale ones
if (live) {
  const rpc = process.env.RPC_URL ?? { 4663: "https://rpc.mainnet.chain.robinhood.com" }[plan.chainId];
  const client = createPublicClient({ transport: http(rpc) });
  const feedAbi = parseAbi(["function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)", "function description() view returns (string)"]);
  let oldest = Infinity;
  for (const [sym, t] of Object.entries(plan.tokens)) {
    if (!t.feed || t.stable) continue; // stablecoins at face value ($1)
    const [, answer, , updatedAt] = await client.readContract({ address: t.feed, abi: feedAbi, functionName: "latestRoundData" });
    const age = Date.now() / 1000 - Number(updatedAt);
    if (age > 26 * 3600) throw new Error(`${sym} feed is stale (${Math.round(age / 3600)} h): markets closed? retry on a trading day`);
    plan.prices[sym] = Number(answer) / 1e8;
    oldest = Math.min(oldest, Number(updatedAt));
  }
  plan.pricesAsOf = `${new Date(oldest * 1000).toISOString()} (Chainlink, oldest feed update)`;
  console.log("live prices:", Object.entries(plan.prices).map(([k, v]) => `${k} $${v}`).join("  "));

  // Can the vault buy every leg now? NeonTrader wants at least the Chainlink value minus pool fees minus 1%:
  // quote a $50 buy from ETH on the real pools (QuoterV2) and compare. A leg that fails here would stay
  // pending until its pool comes back in line with the feed: swap it before deploying.
  const trader = JSON.parse(readFileSync(resolve(here, `../config/trader.${plan.chainId}.json`), "utf8"));
  const { route } = await import("./route.mjs");
  const quoterAbi = parseAbi(["function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)"]);
  const feedPrice = async (feed) => Number((await client.readContract({ address: feed, abi: feedAbi, functionName: "latestRoundData" }))[1]) / 1e8;
  const weth = trader.tokens.find((t) => t.symbol === "WETH");
  const ethUsd = await feedPrice(weth.feed);
  const ethIn = parseUnits((50 / ethUsd).toFixed(18), 18);
  const blocked = [];
  for (const sym of new Set(plan.baskets.flatMap((b) => Object.keys(b.legs)))) {
    const to = trader.tokens.find((t) => t.address.toLowerCase() === plan.tokens[sym].address.toLowerCase());
    if (!to) { blocked.push(`${sym} (not in NeonTrader)`); continue; }
    const { path, fees } = route(trader.tokens, weth, to);
    let packed = "0x";
    path.forEach((a, i) => { packed += a.slice(2).toLowerCase() + (i < fees.length ? fees[i].toString(16).padStart(6, "0") : ""); });
    const { result } = await client.simulateContract({ address: getAddress(trader.uniswap.quoterV2), abi: quoterAbi, functionName: "quoteExactInput", args: [packed, ethIn] });
    const feeBps = fees.reduce((s, f) => s + Math.floor(f / 100), 0);
    const outPrice = plan.tokens[sym].stable ? await feedPrice(plan.tokens[sym].feed) : plan.prices[sym];
    const fair = (50 / outPrice) * 10 ** plan.tokens[sym].decimals;
    const margin = (Number(result[0]) / (fair * (10_000 - feeBps - 100) / 10_000) - 1) * 100;
    console.log(`  ${sym.padEnd(6)} buy margin ${margin.toFixed(2)}%${margin < 0 ? "  BLOCKED: the pool is more than 1% above Chainlink" : margin < 0.3 ? "  thin" : ""}`);
    if (margin < 0) blocked.push(sym);
  }
  if (blocked.length) console.warn(`\nThe vault can't buy ${blocked.join(", ")} right now. Re-check on a trading day; if it persists, replace the leg.\n`);
}

const missing = Object.entries(plan.prices).filter(([, p]) => !(p > 0)).map(([t]) => t);
const used = new Set(plan.baskets.flatMap((b) => Object.keys(b.legs)));
const missingUsed = missing.filter((t) => used.has(t));
if (missingUsed.length) {
  console.error(`Set a USD price > 0 for: ${missingUsed.join(", ")} in ${planPath} (field "prices"), then re-run.`);
  process.exit(1);
}

const baskets = plan.baskets.map((b, i) => {
  const tokens = [];
  const amounts = [];
  let usd = 0;
  for (const [sym, usdTarget] of Object.entries(b.legs)) {
    const t = plan.tokens[sym];
    if (!t) throw new Error(`unknown token ${sym}`);
    const price = plan.prices[sym];
    // amount = usd / price, rounded to 6 significant decimals to keep numbers readable on-chain
    const units = (usdTarget / price).toFixed(Math.min(t.decimals, 8));
    tokens.push(getAddress(t.address));
    amounts.push(parseUnits(units, t.decimals).toString());
    usd += usdTarget;
  }
  return { id: i + 1, name: b.name, tokens, amounts, usd };
});

// budget: each tier draws uniformly among its baskets
const need = {};
let usdTotal = 0;
for (const [tier, ids] of Object.entries(plan.tiers)) {
  const faces = plan.tierSizes[tier];
  for (const id of ids) {
    const b = baskets[id - 1];
    const share = faces / ids.length;
    usdTotal += b.usd * share;
    b.tokens.forEach((addr, k) => {
      need[addr] = (need[addr] ?? 0n) + BigInt(b.amounts[k]) * BigInt(Math.ceil(share));
    });
  }
}

const out = {
  _generated: `from ${planPath} on ${new Date().toISOString()} with prices as of ${plan.pricesAsOf}`,
  chainId: plan.chainId,
  basketCount: baskets.length,
  baskets: baskets.map(({ tokens, amounts, name }) => ({ name, tokens, amounts })),
  tiers: Object.fromEntries(Object.entries(plan.tiers).map(([k, v]) => [k, v])),
};
const outPath = resolve(here, `../contracts/config/baskets.${plan.chainId}.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2));

console.log(`wrote ${outPath}\n`);
for (const b of baskets) console.log(`  #${b.id} ${b.name.padEnd(28)} ~$${b.usd.toFixed(2)}`);
console.log(`\nPool needed to seed all 5555 Faces (~$${Math.round(usdTotal).toLocaleString("en-US")}):`);
const bySymbol = Object.fromEntries(Object.entries(plan.tokens).map(([s, t]) => [getAddress(t.address), [s, t.decimals]]));
for (const [addr, amt] of Object.entries(need)) {
  const [sym, dec] = bySymbol[addr];
  console.log(`  ${sym.padEnd(6)} ${formatUnits(amt, dec)}`);
}
