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
//       "address": "0x…", "standard": "erc721" | "erc1155" | "punks", "fromBlock": 0, "snapshotBlock": "latest",
//       "method": "logs" | "ownerOf",          // erc721 only, default "logs"
//       "ids": [first, last],                  // ownerOf only, optional (default: from 0 until the ids run out)
//       "weight": 1, "tokenIds": [] }          // tokenIds: optional filter (erc1155 usually needs it)
//   ],
//   "exclude": ["0x…"],                        // e.g. marketplace escrows, team wallets
//   "mintChainId": 4663                        // holders with contract code on any other chain are left out
// }
//
// Ownership is rebuilt from Transfer / TransferSingle / TransferBatch logs, so it works for any collection
// (no Enumerable needed). Log ranges shrink automatically when an RPC refuses a large query. For old, busy
// collections on Ethereum, "method": "ownerOf" reads every token's owner through Multicall3 instead (much
// faster on public RPCs; a pinned snapshotBlock then needs an archive RPC). "punks" reads the original
// CryptoPunks contract (punkIndexToAddress), which has no ERC-721 events; list the wrapped-Punk contracts as
// erc721 entries next to it.
//
// A holder that is a contract on another chain (a Safe, a vault, a staking or escrow contract) usually has no
// wallet at the same address on Robinhood Chain and could never mint: those are left out and counted in the
// report. Wallets delegated with EIP-7702 are plain accounts and stay in.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi, parseAbiItem, getAddress, zeroAddress } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const cfgPath = resolve(process.argv[2] ?? resolve(here, "../config/allowlists/collections.json"));
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const { perNft = 1, maxPerWallet = 1 } = cfg.rules ?? {};
const exclude = new Set((cfg.exclude ?? []).map((a) => a.toLowerCase()));

const T721 = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
const T1155S = parseAbiItem("event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)");
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const READS = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function punkIndexToAddress(uint256) view returns (address)",
]);
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

/** Owners of token ids read one by one through Multicall3: Map id -> owner. */
async function ownersByCall(client, address, functionName, snap, first, last, stopWhenEmpty) {
  const owner = new Map();
  const supply = stopWhenEmpty
    ? await client.readContract({ address, abi: READS, functionName: "totalSupply", blockNumber: snap }).catch(() => 0n)
    : 0n;
  const BATCH = 500;
  let empty = 0;
  for (let start = first; last === undefined || start <= last; start += BATCH) {
    const end = last === undefined ? start + BATCH - 1 : Math.min(last, start + BATCH - 1);
    const ids = Array.from({ length: end - start + 1 }, (_, i) => BigInt(start + i));
    let res;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await client.multicall({ contracts: ids.map((id) => ({ address, abi: READS, functionName, args: [id] })), multicallAddress: MULTICALL3, blockNumber: snap, allowFailure: true });
        break;
      } catch (e) {
        if (attempt === 4) throw e;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    let found = 0;
    res.forEach((r, i) => {
      if (r.status === "success" && r.result !== zeroAddress) {
        owner.set(ids[i].toString(), r.result.toLowerCase());
        found++;
      }
    });
    // ids run out: an empty batch once we have seen the reported supply, or 5000 empty ids in a row (burned or
    // never-minted ids leave gaps, and some contracts count burned tokens in totalSupply)
    empty = found === 0 ? empty + 1 : 0;
    if (stopWhenEmpty && start > first && ((found === 0 && BigInt(owner.size) >= supply) || empty >= 10)) break;
  }
  return owner;
}

/** Addresses with contract code (EIP-7702 delegated wallets excluded: they are plain accounts). */
async function contractsAmong(client, addresses) {
  const out = new Set();
  const list = [...addresses];
  for (let i = 0; i < list.length; i += 200) {
    const part = list.slice(i, i + 200);
    const codes = await Promise.all(part.map((a) => client.getCode({ address: a }).catch(() => undefined)));
    codes.forEach((c, k) => {
      if (c && c !== "0x" && !c.startsWith("0xef0100")) out.add(part[k]);
    });
  }
  return out;
}

const mintChainId = cfg.mintChainId ?? 4663;
const totals = new Map(); // holder -> weighted NFT count
const report = { generatedAt: new Date().toISOString(), rules: { perNft, maxPerWallet }, collections: [] };

for (const c of cfg.collections) {
  const client = createPublicClient({ transport: http(c.rpc, { batch: { batchSize: 100 }, retryCount: 5 }) });
  const snap = c.snapshotBlock === undefined || c.snapshotBlock === "latest" ? await client.getBlockNumber() : BigInt(c.snapshotBlock);
  const address = getAddress(c.address);
  const filter = c.tokenIds?.length ? new Set(c.tokenIds.map(String)) : null;
  const balances = new Map();
  const add = (who, n) => balances.set(who, (balances.get(who) ?? 0n) + n);

  if (c.standard === "punks") {
    const owner = await ownersByCall(client, address, "punkIndexToAddress", snap, 0, 9999, false);
    for (const [id, who] of owner) if (!filter || filter.has(id)) add(who, 1n);
  } else if ((c.standard ?? "erc721") === "erc721" && c.method === "ownerOf") {
    const [first, last] = c.ids ?? [0, undefined];
    const owner = await ownersByCall(client, address, "ownerOf", snap, first, last, !c.ids);
    for (const [id, who] of owner) if (!filter || filter.has(id)) add(who, 1n);
  } else if ((c.standard ?? "erc721") === "erc721") {
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
  const held = [...balances].filter(([who, n]) => n > 0n && who !== zeroAddress && who !== "0x000000000000000000000000000000000000dead" && !exclude.has(who));
  const contracts = c.chainId === mintChainId ? new Set() : await contractsAmong(client, held.map(([who]) => who));
  for (const [who, n] of held) {
    if (contracts.has(who)) continue;
    holders++;
    totals.set(who, (totals.get(who) ?? 0) + Number(n) * weight);
  }
  const nfts = held.reduce((t, [, n]) => t + Number(n), 0);
  report.collections.push({ name: c.name, chainId: c.chainId, address, snapshotBlock: snap.toString(), nfts, holders, contractsLeftOut: contracts.size });
  console.log(`${c.name}: ${nfts} NFTs, ${holders} holders${contracts.size ? ` (+${contracts.size} contracts left out)` : ""} at block ${snap}`);
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
console.log(`next: node allowlist.mjs ${csvPath}   (-> CSV for OpenSea Studio)`);
