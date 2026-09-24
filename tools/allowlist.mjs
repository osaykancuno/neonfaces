// Build an allowlist Merkle tree for NeonMinter.
//
//   node allowlist.mjs <phase> <input.csv>
//   node allowlist.mjs builders ../config/allowlists/builders.csv
//
// CSV: `address,allowance` per line (header optional, allowance defaults to 1).
// Leaf = keccak256(bytes.concat(keccak256(abi.encode(address, uint256 allowance)))),
// exactly what NeonMinter.mint() verifies (OpenZeppelin StandardMerkleTree).
//
// Output: ../web/public/allowlist/<phase>.json  -> { root, count, entries: { [address]: { allowance, proof } } }
// The root goes on-chain with NeonMinter.configurePhase(phase, price, 0, supplyCap, root).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { getAddress, isAddress } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const [phase, csvPath] = process.argv.slice(2);
if (!phase || !csvPath) {
  console.error("usage: node allowlist.mjs <builders|allowlist> <file.csv>");
  process.exit(1);
}

const rows = new Map();
const lines = readFileSync(resolve(csvPath), "utf8").split(/\r?\n/);
lines.forEach((line, i) => {
  const [a, n] = line.split(",").map((s) => s?.trim());
  if (!a || !isAddress(a, { strict: false })) {
    if (a && i > 0) console.warn(`line ${i + 1}: skipped invalid address "${a}"`);
    return;
  }
  const addr = getAddress(a);
  const allowance = n ? Number(n) : 1;
  if (!Number.isInteger(allowance) || allowance < 1) throw new Error(`line ${i + 1}: bad allowance "${n}"`);
  // duplicates: keep the highest allowance
  rows.set(addr, Math.max(allowance, rows.get(addr) ?? 0));
});
if (rows.size === 0) throw new Error("no valid rows");

const values = [...rows.entries()].map(([a, n]) => [a, n.toString()]);
const tree = StandardMerkleTree.of(values, ["address", "uint256"]);

const entries = {};
for (const [i, v] of tree.entries()) {
  entries[v[0].toLowerCase()] = { allowance: Number(v[1]), proof: tree.getProof(i) };
}
const out = { phase, root: tree.root, count: rows.size, totalAllowance: values.reduce((s, v) => s + Number(v[1]), 0), entries };

const outPath = resolve(here, `../web/public/allowlist/${phase}.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out));
console.log(`${phase}: ${out.count} wallets, ${out.totalAllowance} Faces max`);
console.log(`root: ${tree.root}`);
console.log(`wrote ${outPath}`);
