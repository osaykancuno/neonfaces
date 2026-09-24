// Resolve seed baskets from USD targets into on-chain token amounts.
//
//   node baskets.mjs [../config/baskets.plan.json]
//
// Writes ../contracts/config/baskets.<chainId>.json (read by Deploy.s.sol) and prints the
// pool budget needed to seed all 5555 Faces (per token and in USD).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseUnits, formatUnits, getAddress } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const planPath = resolve(process.argv[2] ?? resolve(here, "../config/baskets.plan.json"));
const plan = JSON.parse(readFileSync(planPath, "utf8"));

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
console.log(`\nPool needed to seed all 5555 Faces (~$${Math.round(usdTotal).toLocaleString()}):`);
const bySymbol = Object.fromEntries(Object.entries(plan.tokens).map(([s, t]) => [getAddress(t.address), [s, t.decimals]]));
for (const [addr, amt] of Object.entries(need)) {
  const [sym, dec] = bySymbol[addr];
  console.log(`  ${sym.padEnd(6)} ${formatUnits(amt, dec)}`);
}
