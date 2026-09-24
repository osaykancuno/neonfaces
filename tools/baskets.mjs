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
