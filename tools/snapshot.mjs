// Allowlist from NFT collections: who held what at a given block.
//
//   node snapshot.mjs [../config/allowlists/collections.json] [--rules-only]
//   (--rules-only re-applies "rules" and "weight" to the counts saved in holders.json by earlier scans: no RPC calls)
//
// config:
// {
//   "phase": "allowlist",                      // output: ../config/allowlists/<phase>.csv (+ .report.json)
//   "rules": { "perNft": 1, "maxPerWallet": 3,   // Faces per NFT held (summed across collections), capped
//              "minNfts": 1,                    // wallets holding fewer NFTs (all collections together) are left out
//              "notIn": ["robinhood.csv"],      // wallets already on an earlier stage's list are left out here,
//              "notInLimit": 1 },               // or kept with at most this many Faces (SeaDrop counts across stages)
//   "collections": [
//     { "name": "Example", "chainId": 4663, "rpc": "https://rpc.mainnet.chain.robinhood.com",
//       "address": "0x…", "standard": "erc721" | "erc1155" | "punks", "fromBlock": 0, "snapshotBlock": "latest",
//       "method": "logs" | "ownerOf",          // erc721 only, default "logs"
//       "ids": [first, last],                  // ownerOf only, optional (default: from 0 until the ids run out)
//       "weight": 1, "tokenIds": [] }          // tokenIds: optional filter (erc1155 usually needs it)
//   ],
//   "exclude": ["0x…"],                        // e.g. marketplace escrows, team wallets
//   "accountImplementations": ["0x…"],         // token-bound account contracts whose clones count for owner()
//   "mintChainId": 4663                        // the chain the Faces are minted on (a Safe there can mint)
// }
//
// Ownership is rebuilt from Transfer / TransferSingle / TransferBatch logs, so it works for any collection
// (no Enumerable needed). Log ranges shrink automatically when an RPC refuses a large query. For old, busy
// collections on Ethereum, "method": "ownerOf" reads every token's owner through Multicall3 instead (much
// faster on public RPCs; a pinned snapshotBlock then needs an archive RPC). "punks" reads the original
// CryptoPunks contract (punkIndexToAddress), which has no ERC-721 events; list the wrapped-Punk contracts as
// erc721 entries next to it.
//
// Each wallet appears once, with its NFTs summed across every collection of the config. Contract holders are sorted
// out: an ERC-6551 token-bound account (a StonkBroker's own wallet, for one) counts for the wallet that owns its
// NFT; a Safe stays on the mint chain (it can mint there) and is left out on other chains (the same address on
// Robinhood Chain is usually no wallet at all); vaults, pools, escrows and staking contracts are left out and
// listed in the report. Wallets delegated with EIP-7702 are plain accounts and stay in.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi, parseAbiItem, getAddress, zeroAddress } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const rulesOnly = args.includes("--rules-only");
const cfgPath = resolve(args.find((a) => !a.startsWith("--")) ?? resolve(here, "../config/allowlists/collections.json"));
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
const { perNft = 1, maxPerWallet = 1, minNfts = 1, notIn = [], notInLimit = 0 } = cfg.rules ?? {};
const exclude = new Set((cfg.exclude ?? []).map((a) => a.toLowerCase()));
const accountImpls = new Set((cfg.accountImplementations ?? []).map((a) => a.toLowerCase()));

const T721 = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)");
const T1155S = parseAbiItem("event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)");
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const READS = parseAbi([
  "function ownerOf(uint256) view returns (address)",
  "function totalSupply() view returns (uint256)",
  "function punkIndexToAddress(uint256) view returns (address)",
  "function token() view returns (uint256 chainId, address tokenContract, uint256 tokenId)", // ERC-6551 account
  "function getThreshold() view returns (uint256)", // Safe
  "function getOwners() view returns (address[])", // Safe
  "function owner() view returns (address)", // listed account implementations
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

/** One Multicall3 eth_call, retried until the node answers. With allowFailure, viem reports an RPC error (a rate
 *  limit, a timeout) as a failure of every call in the request, like a revert: taken as an answer, a whole batch of
 *  tokens would silently vanish. One request per batch (batchSize 0); a failure only counts as an answer when the
 *  contract itself reverted or returned nothing, anything else is asked again. */
const answered = (e) => !!e?.walk?.((x) => ["ContractFunctionRevertedError", "ContractFunctionZeroDataError", "AbiDecodingZeroDataError"].includes(x.name));
async function multicall(client, contracts, snap) {
  for (let attempt = 0; ; attempt++) {
    let res, err;
    try {
      res = await client.multicall({ contracts, multicallAddress: MULTICALL3, blockNumber: snap, allowFailure: true, batchSize: 0 });
      err = res.find((r) => r.status === "failure" && !answered(r.error))?.error;
    } catch (e) {
      err = e;
    }
    if (!err) return res;
    if (attempt === 10) throw err;
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); // public RPC rate limits reset within a minute
  }
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
    const res = await multicall(client, ids.map((id) => ({ address, abi: READS, functionName, args: [id] })), snap);
    let found = 0;
    res.forEach((r, i) => {
      if (r.status === "success" && r.result !== zeroAddress) {
        owner.set(ids[i].toString(), r.result.toLowerCase());
        found++;
      }
    });
    // ids run out: an empty batch once we have seen the reported supply, or 5000 empty ids in a row (retired or
    // never-minted ids leave gaps, and some contracts count retired tokens in totalSupply)
    empty = found === 0 ? empty + 1 : 0;
    if (stopWhenEmpty && start > first && ((found === 0 && BigInt(owner.size) >= supply) || empty >= 10)) break;
  }
  return owner;
}

/** Addresses with contract code (EIP-7702 delegated wallets excluded: they are plain accounts). A failed read is
 *  retried, never taken for "no code" (that would let a vault through as a wallet). */
async function contractsAmong(client, addresses) {
  const out = new Map(); // address -> code
  const list = [...addresses];
  for (let i = 0; i < list.length; i += 20) {
    const part = list.slice(i, i + 20);
    const codes = await Promise.all(
      part.map(async (a) => {
        for (let attempt = 0; ; attempt++) {
          try {
            return await client.getCode({ address: a });
          } catch (e) {
            if (attempt === 10) throw e;
            await new Promise((r) => setTimeout(r, 5000 * (attempt + 1))); // public RPC rate limits reset within a minute
          }
        }
      }),
    );
    codes.forEach((c, k) => {
      if (c && c !== "0x" && !c.startsWith("0xef0100")) out.set(part[k], c.toLowerCase());
    });
  }
  return out;
}

async function multicallAll(client, contracts, snap) {
  const out = [];
  for (let i = 0; i < contracts.length; i += 300) out.push(...(await multicall(client, contracts.slice(i, i + 300), snap)));
  return out;
}

/** EIP-1167 clone -> the implementation it points to (lowercase), or null. */
const cloneOf = (code) => (/^0x363d3d373d3d3d363d73[0-9a-f]{40}5af43d82803e903d91602b57fd5bf3/.test(code) ? "0x" + code.slice(22, 62) : null);

/** Contract holders, sorted out: an ERC-6551 token-bound account (`token()`), or a clone of an account
 *  implementation listed in `accountImplementations` (`owner()` = owner of its NFT; e.g. StonkBroker6551Account,
 *  whose clones don't carry the standard 6551 footer), counts for the wallet that owns its NFT, followed up to 4
 *  levels; on the mint chain a Safe stays (it can mint); anything else (vaults, pools, escrows, staking) is left
 *  out. Returns Map contract -> wallet (or null = left out). */
async function resolveContracts(client, single, chainId, codes, snap, onMintChain) {
  const to = new Map();
  const codeOf = new Map(codes);
  let open = [...codes.keys()];
  const seen = new Set(open);
  for (let depth = 0; open.length && depth < 4; depth++) {
    const [tok, thr, own] = await Promise.all([
      multicallAll(client, open.map((a) => ({ address: a, abi: READS, functionName: "token" })), snap),
      onMintChain ? multicallAll(client, open.map((a) => ({ address: a, abi: READS, functionName: "getThreshold" })), snap) : [],
      onMintChain ? multicallAll(client, open.map((a) => ({ address: a, abi: READS, functionName: "getOwners" })), snap) : [],
    ]);
    // a Safe answers both, with at least one owner and a threshold between 1 and the number of owners
    const isSafe = (i) =>
      thr[i]?.status === "success" && own[i]?.status === "success" && own[i].result.length > 0 && thr[i].result >= 1n && thr[i].result <= BigInt(own[i].result.length);
    const bound = [], clones = [];
    open.forEach((a, i) => {
      const t = tok[i];
      if (t.status === "success" && BigInt(t.result[0]) === BigInt(chainId)) bound.push([a, t.result[1], t.result[2]]);
      else if (accountImpls.has(cloneOf(codeOf.get(a)))) clones.push(a);
      else to.set(a, onMintChain && isSafe(i) ? a : null);
    });
    const [owners, cloneOwners] = await Promise.all([
      multicallAll(client, bound.map(([, nft, id]) => ({ address: nft, abi: READS, functionName: "ownerOf", args: [id] })), snap),
      multicallAll(client, clones.map((a) => ({ address: a, abi: READS, functionName: "owner" })), snap),
    ]);
    const owner = new Map(); // account -> its NFT's owner
    const ok = (r) => (r.status === "success" && r.result !== zeroAddress ? r.result.toLowerCase() : null);
    bound.forEach(([a], i) => owner.set(a, ok(owners[i])));
    clones.forEach((a, i) => owner.set(a, ok(cloneOwners[i])));
    const nested = await contractsAmong(single, [...new Set([...owner.values()].filter(Boolean))]);
    for (const [a, c] of nested) codeOf.set(a, c);
    open = [];
    for (const [a, o] of owner) {
      to.set(a, o && !nested.has(o) ? o : null);
      if (o && nested.has(o)) {
        to.set(a, { via: o });
        if (!seen.has(o)) (seen.add(o), open.push(o));
      }
    }
  }
  const final = (a, n = 0) => {
    const v = to.get(a);
    return v && typeof v === "object" ? (n < 8 ? final(v.via, n + 1) : null) : v ?? null;
  };
  return new Map([...codes.keys()].map((a) => [a, final(a)]));
}

const mintChainId = cfg.mintChainId ?? 4663;
const totals = new Map(); // holder -> weighted NFT count
const leftOutNfts = new Map(); // contract -> NFTs it holds (vaults, pools, escrows)
const report = { generatedAt: new Date().toISOString(), rules: { perNft, maxPerWallet, minNfts, notIn, notInLimit }, collections: [] };
const phase = cfg.phase ?? "allowlist";
// raw counts per collection, shared by every config in this folder: --rules-only (or moving a collection from one
// list to another) needs no rescan of the collections already read
const cachePath = resolve(dirname(cfgPath), "holders.json");
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, "utf8")) : { collections: {} };
const keyOf = (c) => `${c.chainId}:${c.address.toLowerCase()}`;

for (const c of rulesOnly ? [] : cfg.collections) {
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

  const held = [...balances].filter(([who, n]) => n > 0n && who !== zeroAddress && who !== "0x000000000000000000000000000000000000dead" && !exclude.has(who));
  const single = createPublicClient({ transport: http(c.rpc, { retryCount: 3 }) }); // one call per request: batches trip rate limits
  const contracts = await contractsAmong(single, held.map(([who]) => who));
  const walletOf = contracts.size ? await resolveContracts(client, single, c.chainId, contracts, snap, c.chainId === mintChainId) : new Map();
  const counted = new Map(); // wallet -> NFTs in this collection (a token-bound account's NFTs go to its owner)
  const excluded = new Map(); // contract -> NFTs it holds
  let bound = 0;
  for (const [who, n] of held) {
    const wallet = contracts.has(who) ? walletOf.get(who) : who;
    if (!wallet || exclude.has(wallet)) {
      excluded.set(who, (excluded.get(who) ?? 0) + Number(n));
      continue;
    }
    if (wallet !== who) bound++;
    counted.set(wallet, (counted.get(wallet) ?? 0) + Number(n));
  }
  const nfts = held.reduce((t, [, n]) => t + Number(n), 0);
  const info = { name: c.name, chainId: c.chainId, address, scannedAt: new Date().toISOString(), snapshotBlock: snap.toString(), nfts, holders: counted.size, tokenBoundAccountsMerged: bound, contractsLeftOut: excluded.size };
  cache.collections[keyOf(c)] = { ...info, counts: Object.fromEntries(counted), leftOut: Object.fromEntries(excluded) };
  writeFileSync(cachePath, JSON.stringify(cache)); // after each collection: an interrupted run keeps what it read
  console.log(`${c.name}: ${nfts} NFTs, ${counted.size} holders at block ${snap}` + (bound ? `, ${bound} token-bound accounts counted for their owners` : "") + (excluded.size ? `, ${excluded.size} contracts left out` : ""));
}

// every wallet once, its NFTs summed (weighted) across the collections of this config
for (const c of cfg.collections) {
  const entry = cache.collections[keyOf(c)];
  if (!entry) throw new Error(`${c.name} was never scanned: run without --rules-only`);
  const { counts, leftOut, ...info } = entry;
  report.collections.push(info);
  for (const [who, n] of Object.entries(counts)) if (!exclude.has(who)) totals.set(who, (totals.get(who) ?? 0) + n * (c.weight ?? 1));
  for (const [who, n] of Object.entries(leftOut)) leftOutNfts.set(who, (leftOutNfts.get(who) ?? 0) + n);
}

// wallets already on an earlier stage's list (rules.notIn): left out here, or kept with at most `notInLimit` Faces.
// SeaDrop counts every Face a wallet minted, across stages, against the per-wallet limit: with notInLimit 1, a
// wallet that already minted its Face on the earlier stage can't mint here, one that didn't still can.
const earlier = new Set();
for (const f of notIn) {
  for (const line of readFileSync(resolve(dirname(cfgPath), f), "utf8").split(/\r?\n/).slice(1)) {
    const a = line.split(",")[0]?.trim().toLowerCase();
    if (a) earlier.add(a);
  }
}
let belowMin = 0, onEarlier = 0;
const rows = [...totals.entries()]
  .filter(([who, n]) => (n < minNfts ? (belowMin++, false) : earlier.has(who) ? (onEarlier++, notInLimit > 0) : true))
  .map(([who, n]) => {
    const allowance = Math.max(1, Math.min(maxPerWallet, Math.floor(n * perNft)));
    return [getAddress(who), earlier.has(who) ? Math.min(allowance, notInLimit) : allowance];
  })
  .sort((a, b) => b[1] - a[1]);
const csvPath = resolve(dirname(cfgPath), `${phase}.csv`);
writeFileSync(csvPath, "address,allowance\n" + rows.map((r) => r.join(",")).join("\n") + "\n");
report.holders = totals.size;
report.belowMinNfts = belowMin;
report.onEarlierStage = onEarlier;
report.wallets = rows.length;
report.maxFaces = rows.reduce((s, r) => s + r[1], 0);
const leftOutSorted = [...leftOutNfts].sort((a, b) => b[1] - a[1]);
report.leftOutContracts = leftOutSorted.length;
report.leftOutNfts = leftOutSorted.reduce((t, [, n]) => t + n, 0);
report.leftOut = leftOutSorted.slice(0, 50).map(([a, n]) => ({ address: getAddress(a), nfts: n })); // the biggest; holders.json has all
writeFileSync(resolve(dirname(cfgPath), `${phase}.report.json`), JSON.stringify(report, null, 2));
console.log(`${totals.size} distinct wallets` + (belowMin ? `, ${belowMin} below ${minNfts} NFTs` : "") + (onEarlier ? `, ${onEarlier} already on ${notIn.join(", ")}` + (notInLimit ? ` (kept, limit ${notInLimit})` : " (left out)") : ""));
console.log(`${rows.length} wallets, up to ${report.maxFaces} Faces -> ${csvPath}`);
console.log(`next: node allowlist.mjs ${csvPath}   (-> CSV for OpenSea Studio)`);
