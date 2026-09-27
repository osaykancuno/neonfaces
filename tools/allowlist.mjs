// Turn allowlists into the CSV OpenSea Studio accepts for a presale stage, and into the files the site's
// "Is your wallet on the list?" check reads.
//
//   node allowlist.mjs <input.csv> [more.csv …] [--name list] [--limit 3]
//   node allowlist.mjs ../config/allowlists/list.csv ../config/allowlists/extra.csv
//
// Input: `address,allowance` per line (header optional, allowance defaults to 1): what tools/snapshot.mjs writes;
// a missing input file is skipped (extra.csv only exists once there are extra wallets). Several inputs are merged:
// one row per wallet, the highest allowance wins, or every wallet gets `--limit` when it is given.
// Output:
//   ../config/allowlists/opensea/<name>.csv: `address,limit` per line, no header, no duplicates, checksummed
//     (OpenSea's format: address, optional per-wallet limit, optional per-wallet price). Upload it to the presale
//     stage in OpenSea Studio; Studio builds the SeaDrop Merkle root, and the allowlist can't be edited once that
//     stage has started minting.
//   ../landing/list/<0-f>.txt, the preview's check (the wallet check lives only on the preview): the first 20 hex digits of
//     SHA-256(lowercase address), one per line, in 16 files by the hash's first digit. The page hashes the address
//     typed in, downloads one small file and looks it up: the address never leaves the browser, and the files
//     don't publish the list itself.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress, isAddress } from "viem";

const OPENSEA_MAX_PER_STAGE = 30_000; // support.opensea.io "Define your allowlists"; one presale stage at a time

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const nameArg = flag("--name");
const limitArg = flag("--limit");
const inputs = args;
if (!inputs.length) {
  console.error("usage: node allowlist.mjs <file.csv> [more.csv …] [--name list] [--limit 3]");
  process.exit(1);
}
const name = nameArg ?? basename(inputs[0]).replace(/\.csv$/i, "");
const forced = limitArg === undefined ? undefined : Number(limitArg);
if (forced !== undefined && (!Number.isInteger(forced) || forced < 1)) throw new Error(`bad --limit "${limitArg}"`);

const rows = new Map();
for (const csvPath of inputs) {
  if (!existsSync(resolve(csvPath))) {
    console.log(`${csvPath}: not there, skipped`);
    continue;
  }
  const before = rows.size;
  const lines = readFileSync(resolve(csvPath), "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    const [a, n] = line.split(",").map((s) => s?.trim());
    if (!a || !isAddress(a, { strict: false })) {
      if (a && i > 0) console.warn(`${basename(csvPath)} line ${i + 1}: skipped invalid address "${a}" (ENS names are not accepted by OpenSea)`);
      return;
    }
    const addr = getAddress(a);
    const allowance = forced ?? (n ? Number(n) : 1);
    if (!Number.isInteger(allowance) || allowance < 1) throw new Error(`${basename(csvPath)} line ${i + 1}: bad allowance "${n}"`);
    // duplicates, within a file or across files: keep the highest allowance
    rows.set(addr, Math.max(allowance, rows.get(addr) ?? 0));
  });
  console.log(`${basename(csvPath)}: ${rows.size - before} new wallets`);
}
if (rows.size === 0) throw new Error("no valid rows");
if (rows.size > OPENSEA_MAX_PER_STAGE) throw new Error(`${rows.size} wallets: OpenSea accepts at most ${OPENSEA_MAX_PER_STAGE} per presale stage`);

const out = [...rows.entries()].map(([a, n]) => `${a},${n}`).join("\n") + "\n";
const outPath = resolve(here, `../config/allowlists/opensea/${name}.csv`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, out);

// the site's check files
const shards = Array.from({ length: 16 }, () => []);
for (const addr of rows.keys()) {
  const h = createHash("sha256").update(addr.toLowerCase()).digest("hex").slice(0, 20);
  shards[parseInt(h[0], 16)].push(h);
}
for (const dir of ["../landing/list"]) {
  const d = resolve(here, dir);
  rmSync(d, { recursive: true, force: true });
  mkdirSync(d, { recursive: true });
  shards.forEach((s, i) => writeFileSync(resolve(d, `${i.toString(16)}.txt`), s.sort().join("\n") + "\n"));
}

const total = [...rows.values()].reduce((s, n) => s + n, 0);
const limits = [...new Set(rows.values())].sort((a, b) => a - b);
console.log(`${name}: ${rows.size} wallets (room for ${OPENSEA_MAX_PER_STAGE - rows.size} more), ${total} Faces max (per-wallet limits: ${limits.join(", ")})`);
console.log(`wrote ${outPath}`);
console.log("wrote the preview's check files: landing/list/ (publish them: tools/site.sh deploy preview)");
