// Plan B for the sale (28 Sep): configure the OpenSea SeaDrop stages on-chain from the sale manager, without Studio,
// and give neonfaces.xyz what it needs to mint through SeaDrop directly. Nothing is sent: this writes files.
//
//   node tools/seadrop-drop.mjs 4663 --list-start <ISO UTC> [--list <csv>] [--fee-bps 1000]
//                                   [--fee-recipient 0x…] [--rpc URL]
//
// The NEONLIST (3 Oct, the founder): chosen wallets mint at 0.004 ETH, up to 15 Faces each in total (every stage counts),
// from --list-start to the public stage's end (always the same end), while the public stage stays open to everyone at 0.009. The CSV (default
// config/allowlists/opensea/list-communities.csv, git-ignored) has one wallet per line: `address` or `address,15`.
//
// -> config/allowlists/opensea/drop.4663.json (git-ignored folder): the list stage's MintParams, the public drop, the
//    Merkle root, the fee recipient, and the multiConfigure calldata the sale manager sends to NeonFaces
// -> web/public/drop/params.json and web/public/drop/proofs/<2 hex>.json: proofs keyed by the first 20 hex digits of
//    SHA-256(lowercase address), as the preview's wallet check does, so the files never list an address
//
// The leaf is SeaDrop 1.0's: keccak256(abi.encode(minter, MintParams)), hashed in sorted pairs (solady
// MerkleProofLib), so the stage terms (price, limit, times, fee) live in the leaves and can't be forged.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { encodeAbiParameters, keccak256, encodeFunctionData, parseEther, getAddress, createPublicClient, http, parseAbi } from "viem";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chain = process.argv[2] ?? "4663";
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, `contracts/deployments/${chain}.json`), "utf8"));
const FEE_BPS = Number(arg("--fee-bps", "1000")); // OpenSea's 10% (ECONOMICS.md assumes it)
const FEE_RECIPIENT = getAddress(arg("--fee-recipient", "0x0000a26b00c1F0DF003000390027140000fAa719"));

// the public stage (docs/LAUNCH-RUNBOOK.md): everyone from Fri 2 Oct 13:00 UTC to the last Face or Sat 31 Oct 18:00 UTC
const PUBLIC_START = 1790946000; // Fri 2 Oct 13:00 UTC (the founder, 2 Oct: five hours earlier)
const PUBLIC_END = 1793469600; // Sat 31 Oct 2026 18:00 UTC (the founder, 2 Oct: the public stage stays open to the end of the month)
const CAP = 5444;
// the list's window is inside every leaf: changing it means a new root, new proofs and a new configure transaction
const isoArg = (k) => {
  const v = arg(k);
  const t = Date.parse(v ?? "");
  if (!v || !/(Z|[+-]\d\d:\d\d)$/.test(v) || Number.isNaN(t)) throw new Error(`${k} <ISO time with Z, e.g. 2026-10-06T18:00Z>`);
  return Math.floor(t / 1000);
};
const LIST_START = isoArg("--list-start");
const LIST_END = PUBLIC_END; // the founder, 3 Oct: the NEONLIST always ends with the public stage (if PUBLIC_END moves, rebuild the list too)
if (!(LIST_END > LIST_START)) throw new Error("the NEONLIST must start before the public stage ends");
// the list (the founder, 3 Oct): 0.004 ETH with the top-ups of ECONOMICS.md (Watch +$5, Heavy Stare +$10, set $5), ≈ $6.89 of
// baskets per paid Face against ≈ $5.31 reaching the vault at ETH $2,684: the treasury and growth cover the gap (ECONOMICS.md)
const LIST = {
  mintPrice: parseEther("0.004"),
  maxTotalMintableByWallet: 15n,
  startTime: BigInt(LIST_START),
  endTime: BigInt(LIST_END),
  dropStageIndex: 2n,
  maxTokenSupplyForStage: BigInt(CAP),
  feeBps: BigInt(FEE_BPS),
  restrictFeeRecipients: true,
};
// 2 Oct (the founder): up to 15 Faces per wallet in total (list mints included); 0.009 ETH from the afternoon of 2 Oct,
// the basket floor at ETH ≈ $2,750 (≈ 2% of margin: the treasury tops up the vault if ETH falls before the reveal)
const PUBLIC = {
  mintPrice: parseEther("0.009"),
  startTime: PUBLIC_START,
  endTime: PUBLIC_END,
  maxTotalMintableByWallet: 15,
  feeBps: FEE_BPS,
  restrictFeeRecipients: true,
};

const MINT_PARAMS = {
  type: "tuple",
  components: [
    { name: "mintPrice", type: "uint256" },
    { name: "maxTotalMintableByWallet", type: "uint256" },
    { name: "startTime", type: "uint256" },
    { name: "endTime", type: "uint256" },
    { name: "dropStageIndex", type: "uint256" },
    { name: "maxTokenSupplyForStage", type: "uint256" },
    { name: "feeBps", type: "uint256" },
    { name: "restrictFeeRecipients", type: "bool" },
  ],
};
const leafOf = (a) => keccak256(encodeAbiParameters([{ type: "address" }, MINT_PARAMS], [a, LIST]));
const pair = (x, y) => keccak256((x < y ? x + y.slice(2) : y + x.slice(2)));

// the list: one wallet per line, `address` or `address,15` (a header line or blank lines are skipped)
const listFile = path.resolve(ROOT, arg("--list", "config/allowlists/opensea/list-communities.csv"));
const csv = fs.readFileSync(listFile, "utf8").trim().split(/\r?\n/);
const addrs = [];
const seen = new Set();
for (const line of csv) {
  const [a, lim] = line.split(",").map((x) => x?.trim());
  if (!a || /^address$/i.test(a)) continue;
  if (lim && Number(lim) !== Number(LIST.maxTotalMintableByWallet)) throw new Error(`limit ${lim} for ${a}: every wallet gets ${LIST.maxTotalMintableByWallet}`);
  const g = getAddress(a);
  if (seen.has(g)) throw new Error(`duplicate ${g}`);
  seen.add(g);
  addrs.push(g);
}
if (!addrs.length) throw new Error(`no wallets in ${listFile}`);

// the tree
const leaves = addrs.map(leafOf);
const layers = [leaves];
while (layers.at(-1).length > 1) {
  const cur = layers.at(-1);
  const next = [];
  for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? pair(cur[i], cur[i + 1]) : cur[i]);
  layers.push(next);
}
const root = layers.at(-1)[0];
const proofOf = (i) => {
  const p = [];
  for (let l = 0; l < layers.length - 1; l++) {
    const sib = i ^ 1;
    if (sib < layers[l].length) p.push(layers[l][sib]);
    i >>= 1;
  }
  return p;
};
const verify = (leaf, proof) => proof.reduce((h, s) => pair(h, s), leaf) === root;

// proofs, sharded by the SHA-256 of the address (the preview's scheme)
const shards = {};
let bad = 0;
addrs.forEach((a, i) => {
  const proof = proofOf(i);
  if (!verify(leaves[i], proof)) bad++;
  const h = crypto.createHash("sha256").update(a.toLowerCase()).digest("hex");
  (shards[h.slice(0, 2)] ??= {})[h.slice(0, 20)] = proof;
});
if (bad) throw new Error(`${bad} proofs don't verify`);

const out = path.join(ROOT, "web/public/drop");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, "proofs"), { recursive: true });
// all 256 shards, empty ones included: a short list leaves most of them empty, and a missing file would come back as
// the site's index page (SPA fallback) instead of "not on the list"
for (let i = 0; i < 256; i++) {
  const k = i.toString(16).padStart(2, "0");
  fs.writeFileSync(path.join(out, "proofs", `${k}.json`), JSON.stringify(shards[k] ?? {}));
}
const str = (o) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const params = { seaDrop: dep.seaDrop, faces: dep.faces, feeRecipient: FEE_RECIPIENT, list: str(LIST), public: str(PUBLIC), root };
fs.writeFileSync(path.join(out, "params.json"), JSON.stringify(params, null, 2) + "\n");

// what the sale manager sends to NeonFaces: one multiConfigure (the same call Studio makes). SeaDrop refuses to allow a
// fee recipient twice (DuplicateFeeRecipient), and Studio already allowed OpenSea's: read it live and add it only if missing.
const RPC = arg("--rpc", { 4663: "https://rpc.mainnet.chain.robinhood.com", 46630: "https://rpc.testnet.chain.robinhood.com" }[chain]);
const feeAllowed = await createPublicClient({ transport: http(RPC) }).readContract({
  address: dep.seaDrop,
  abi: parseAbi(["function getFeeRecipientIsAllowed(address,address) view returns (bool)"]),
  functionName: "getFeeRecipientIsAllowed",
  args: [dep.faces, FEE_RECIPIENT],
});
const abi = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts/out/NeonFaces.sol/NeonFaces.json"), "utf8")).abi;
const z = "0x0000000000000000000000000000000000000000000000000000000000000000";
const data = encodeFunctionData({
  abi,
  functionName: "multiConfigure",
  args: [{
    maxSupply: 0n, baseURI: "", contractURI: "", seaDropImpl: dep.seaDrop,
    publicDrop: PUBLIC, dropURI: "",
    allowListData: { merkleRoot: root, publicKeyURIs: [], allowListURI: "" },
    creatorPayoutAddress: dep.payout, provenanceHash: z,
    allowedFeeRecipients: feeAllowed ? [] : [FEE_RECIPIENT], disallowedFeeRecipients: [], allowedPayers: [], disallowedPayers: [],
    tokenGatedAllowedNftTokens: [], tokenGatedDropStages: [], disallowedTokenGatedAllowedNftTokens: [],
    signers: [], signedMintValidationParams: [], disallowedSigners: [],
  }],
});
const plan = { ...params, wallets: addrs.length, shards: Object.keys(shards).length, to: dep.faces, from: "sale manager", data };
fs.writeFileSync(path.join(ROOT, `config/allowlists/opensea/drop.${chain}.json`), JSON.stringify(plan, null, 2) + "\n");
console.log(`root ${root}`);
console.log(`${addrs.length} wallets, 256 proof files in web/public/drop/proofs (${Object.keys(shards).length} with wallets), every proof verified`);
console.log(`list ${LIST_START} -> ${LIST_END}, public ${PUBLIC_START} -> ${PUBLIC_END}, fee ${FEE_BPS} bps to ${FEE_RECIPIENT} (${feeAllowed ? "already allowed on SeaDrop" : "added by this call"})`);
console.log(`multiConfigure calldata ${data.length / 2 - 1} bytes -> config/allowlists/opensea/drop.${chain}.json`);
