// Turn an allowlist into the CSV OpenSea Studio accepts for a presale stage.
//
//   node allowlist.mjs <input.csv> [stage-name]
//   node allowlist.mjs ../config/allowlists/robinhood.csv
//
// Input: `address,allowance` per line (header optional, allowance defaults to 1) — what tools/snapshot.mjs writes.
// Output: ../config/allowlists/opensea/<stage>.csv — `address,limit` per line, no header, no duplicates,
// checksummed (OpenSea's format: address, optional per-wallet limit, optional per-wallet price).
// Upload it to the matching presale stage in OpenSea Studio. Studio builds the SeaDrop Merkle root; the
// allowlist can't be edited once that stage has started minting.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, isAddress } from "viem";

const OPENSEA_MAX_PER_STAGE = 30_000;

const here = dirname(fileURLToPath(import.meta.url));
const [csvPath, stageArg] = process.argv.slice(2);
if (!csvPath) {
  console.error("usage: node allowlist.mjs <file.csv> [stage-name]");
  process.exit(1);
}
const stage = stageArg ?? basename(csvPath).replace(/\.csv$/i, "");

const rows = new Map();
const lines = readFileSync(resolve(csvPath), "utf8").split(/\r?\n/);
lines.forEach((line, i) => {
  const [a, n] = line.split(",").map((s) => s?.trim());
  if (!a || !isAddress(a, { strict: false })) {
    if (a && i > 0) console.warn(`line ${i + 1}: skipped invalid address "${a}" (ENS names are not accepted by OpenSea)`);
    return;
  }
  const addr = getAddress(a);
  const allowance = n ? Number(n) : 1;
  if (!Number.isInteger(allowance) || allowance < 1) throw new Error(`line ${i + 1}: bad allowance "${n}"`);
  // duplicates: keep the highest allowance
  rows.set(addr, Math.max(allowance, rows.get(addr) ?? 0));
});
if (rows.size === 0) throw new Error("no valid rows");
if (rows.size > OPENSEA_MAX_PER_STAGE) throw new Error(`${rows.size} wallets: OpenSea accepts at most ${OPENSEA_MAX_PER_STAGE} per stage`);

const out = [...rows.entries()].map(([a, n]) => `${a},${n}`).join("\n") + "\n";
const outPath = resolve(here, `../config/allowlists/opensea/${stage}.csv`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out);

const total = [...rows.values()].reduce((s, n) => s + n, 0);
const limits = [...new Set(rows.values())].sort((a, b) => a - b);
console.log(`${stage}: ${rows.size} wallets, ${total} Faces max (per-wallet limits: ${limits.join(", ")})`);
console.log(`wrote ${outPath}`);
console.log("Set the stage's supply cap in Studio so the stage can't sell more than planned.");
