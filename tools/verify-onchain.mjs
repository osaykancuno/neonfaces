// Independent verification that the collection on-chain is exactly the committed art.
//
//   RPC_URL=https://rpc.mainnet.chain.robinhood.com node verify-onchain.mjs <chainId>
//
// Checks:
//   1. provenance in art/output/provenance.json == keccak chain recomputed from art/output/onchain/chunks.json
//   2. NeonFaces.provenanceHash() == that value (committed before mint)
//   3. NeonArt is sealed, runningHash matches, every chunk's bytes on-chain == local chunk
//   4. random sample of tokens: tokenURI decodes, image is an SVG, attributes present
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, keccak256, concat, parseAbi } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const chainId = Number(process.argv[2] ?? 4663);
const dep = JSON.parse(readFileSync(resolve(here, `../contracts/deployments/${chainId}.json`), "utf8"));
const DEFAULT_RPC = { 4663: "https://rpc.mainnet.chain.robinhood.com", 46630: "https://rpc.testnet.chain.robinhood.com" };
const rpc = process.env.RPC_URL ?? DEFAULT_RPC[chainId];
if (!rpc) throw new Error("set RPC_URL");
const client = createPublicClient({ transport: http(rpc) });

const chunks = JSON.parse(readFileSync(resolve(here, "../art/output/onchain/chunks.json"), "utf8"));
const prov = JSON.parse(readFileSync(resolve(here, "../art/output/provenance.json"), "utf8"));

let h = "0x" + "00".repeat(32);
for (const c of chunks) h = keccak256(concat([h, c]));
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};
ok(h === prov.provenanceHash, `local chunks hash to provenance ${h}`);

const abi = parseAbi([
  "function provenanceHash() view returns (bytes32)",
  "function isSealed() view returns (bool)",
  "function runningHash() view returns (bytes32)",
  "function chunks(uint256) view returns (address)",
  "function chunkCount() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function tokenURI(uint256) view returns (string)",
]);
const read = (address, functionName, args = []) => client.readContract({ address, abi, functionName, args });

ok((await read(dep.faces, "provenanceHash")) === h, "NeonFaces.provenanceHash matches");
ok(await read(dep.art, "isSealed"), "NeonArt is sealed");
ok((await read(dep.art, "runningHash")) === h, "NeonArt.runningHash matches");
const n = Number(await read(dep.art, "chunkCount"));
ok(n === chunks.length, `chunk count ${n}/${chunks.length}`);

let bad = 0;
for (let i = 0; i < n; i++) {
  const ptr = await read(dep.art, "chunks", [BigInt(i)]);
  const code = await client.getCode({ address: ptr });
  // SSTORE2: code = 0x00 (STOP) + data
  if ("0x" + code.slice(4) !== chunks[i].toLowerCase()) bad++;
}
ok(bad === 0, `all ${n} SSTORE2 chunks byte-identical to local data`);

const supply = Number(await read(dep.faces, "totalSupply"));
for (const id of [1, Math.ceil(supply / 2), supply].filter((x) => x > 0)) {
  const uri = await read(dep.faces, "tokenURI", [BigInt(id)]);
  const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
  const svg = Buffer.from(json.image.split(",")[1], "base64").toString();
  ok(svg.startsWith("<svg") && json.attributes.length >= 3, `token #${id}: ${json.name}, ${json.attributes.length} attributes, svg ${svg.length} bytes`);
}
