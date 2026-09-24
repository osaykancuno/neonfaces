// Allowlist from NFT collections: who held what at a given block.
//
//   node snapshot.mjs [../config/allowlists/collections.json]
//
// config:
// {
//   "phase": "allowlist",                      // output: ../config/allowlists/<phase>.csv (+ .report.json)
//   "rules": { "perNft": 1, "maxPerWallet": 3 }, // Faces per NFT held (summed across collections), capped
//   "collections": [
//     { "name": "Example", "chainId": 4663, "rpc": "https://rpc.mainnet.chain.robinhood.com",
//       "address": "0x…", "standard": "erc721" | "erc1155", "fromBlock": 0, "snapshotBlock": "latest",
//       "weight": 1, "tokenIds": [] }          // tokenIds: optional filter (erc1155 usually needs it)
//   ],
//   "exclude": ["0x…"]                         // e.g. marketplace escrows, team wallets
// }
//
// Ownership is rebuilt from Transfer / TransferSingle / TransferBatch logs, so it works for any collection
// (no Enumerable needed). Log ranges shrink automatically when an RPC refuses a large query.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbiItem, getAddress, zeroAddress } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const cfgPath = resolve(process.argv[2] ?? resolve(here, "../config/allowlists/collections.json"));
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const { perNft = 1, maxPerWallet = 1 } = cfg.rules ?? {};
const exclude = new Set((cfg.exclude ?? []).map((a) => a.toLowerCase()));

const T721 = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
const T1155S = parseAbiItem("event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)");
const T1155B = parseAbiItem("event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)");

async function logsChunked(client, params, from, to) {
  const out = [];
  let step = 50_000n;
  for (let start = from; start <= to; ) {
    const end = start + step - 1n > to ? to : start + step - 1n;
    try {
      out.push(...(await client.getLogs({ ...params, fromBlock: start, toBlock: end })));
      start = end + 1n;
      if (step < 500_000n) step *= 2n;
    } catch (e) {
      if (step <= 100n) throw e;
      step /= 4n; // the RPC refused the range: retry smaller
    }
  }
  return out;
}

const totals = new Map(); // holder -> weighted NFT count
const report = { generatedAt: new Date().toISOString(), rules: { perNft, maxPerWallet }, collections: [] };

for (const c of cfg.collections) {
  const client = createPublicClient({ transport: http(c.rpc) });
  const snap = c.snapshotBlock === undefined || c.snapshotBlock === "latest" ? await client.getBlockNumber() : BigInt(c.snapshotBlock);
  const address = getAddress(c.address);
  const filter = c.tokenIds?.length ? new Set(c.tokenIds.map(String)) : null;
  const balances = new Map();
  const add = (who, n) => balances.set(who, (balances.get(who) ?? 0n) + n);

  if ((c.standard ?? "erc721") === "erc721") {
    const logs = await logsChunked(client, { address, event: T721 }, BigInt(c.fromBlock ?? 0), snap);
    const owner = new Map();
    for (const l of logs) {
      const id = l.args.tokenId.toString();
      if (!filter || filter.has(id)) owner.set(id, l.args.to.toLowerCase());
    }
    for (const who of owner.values()) add(who, 1n);
  } else {
    const [single, batch] = await Promise.all([
      logsChunked(client, { address, event: T1155S }, BigInt(c.fromBlock ?? 0), snap),
      logsChunked(client, { address, event: T1155B }, BigInt(c.fromBlock ?? 0), snap),
    ]);
    const move = (from, to, id, v) => {
      if (filter && !filter.has(id.toString())) return;
      if (from !== zeroAddress) add(from.toLowerCase(), -v);
      add(to.toLowerCase(), v);
    };
    const all = [...single, ...batch].sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : Number(a.blockNumber - b.blockNumber)));
    for (const l of all) {
      if (l.eventName === "TransferSingle") move(l.args.from, l.args.to, l.args.id, l.args.value);
      else l.args.ids.forEach((id, i) => move(l.args.from, l.args.to, id, l.args.values[i]));
    }
  }

  let holders = 0;
  const weight = c.weight ?? 1;
  for (const [who, n] of balances) {
    if (n <= 0n || who === zeroAddress || who === "0x000000000000000000000000000000000000dead" || exclude.has(who)) continue;
    holders++;
    totals.set(who, (totals.get(who) ?? 0) + Number(n) * weight);
  }
  report.collections.push({ name: c.name, chainId: c.chainId, address, snapshotBlock: snap.toString(), holders });
  console.log(`${c.name}: ${holders} holders at block ${snap}`);
}

const rows = [...totals.entries()]
  .map(([who, n]) => [getAddress(who), Math.max(1, Math.min(maxPerWallet, Math.floor(n * perNft)))])
  .sort((a, b) => b[1] - a[1]);
const phase = cfg.phase ?? "allowlist";
const csvPath = resolve(dirname(cfgPath), `${phase}.csv`);
writeFileSync(csvPath, "address,allowance\n" + rows.map((r) => r.join(",")).join("\n") + "\n");
report.wallets = rows.length;
report.maxFaces = rows.reduce((s, r) => s + r[1], 0);
writeFileSync(resolve(dirname(cfgPath), `${phase}.report.json`), JSON.stringify(report, null, 2));
console.log(`${rows.length} wallets, up to ${report.maxFaces} Faces -> ${csvPath}`);
console.log(`next: node allowlist.mjs ${phase} ${csvPath}`);
