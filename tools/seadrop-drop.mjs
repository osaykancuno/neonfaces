// Plan B for the sale (28 Sep): configure the OpenSea SeaDrop stages on-chain from the sale manager, without Studio,
// and give neonfaces.xyz what it needs to mint through SeaDrop directly. Nothing is sent: this writes files.
//
//   node tools/seadrop-drop.mjs 4663 [--fee-bps 1000] [--fee-recipient 0x…] [--rpc URL]
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

// the sale (docs/LAUNCH-RUNBOOK.md): the list Thu 1 Oct 18:00 UTC for 24 h, then everyone from Fri 2 Oct 18:00 UTC
const LIST_START = 1790877600;
const PUBLIC_START = 1790964000;
const PUBLIC_END = 1791655200; // Sat 10 Oct 2026 18:00 UTC, as Studio set it on 1 Oct (the sale manager can extend it)
const CAP = 5444;
const LIST = {
  mintPrice: parseEther("0.013"),
  maxTotalMintableByWallet: 3n,
  startTime: BigInt(LIST_START),
  endTime: BigInt(PUBLIC_START),
  dropStageIndex: 1n,
  maxTokenSupplyForStage: BigInt(CAP),
  feeBps: BigInt(FEE_BPS),
  restrictFeeRecipients: true,
};
const PUBLIC = {
  mintPrice: parseEther("0.018"),
  startTime: PUBLIC_START,
  endTime: PUBLIC_END,
  maxTotalMintableByWallet: 5,
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

// the list: address,limit (the CSV for Studio); every row must carry the stage's limit
const csv = fs.readFileSync(path.join(ROOT, "config/allowlists/opensea/list.csv"), "utf8").trim().split(/\r?\n/);
const addrs = [];
const seen = new Set();
for (const line of csv) {
  const [a, lim] = line.split(",");
  if (Number(lim) !== Number(LIST.maxTotalMintableByWallet)) throw new Error(`limit ${lim} for ${a}`);
  const g = getAddress(a.trim());
  if (seen.has(g)) throw new Error(`duplicate ${g}`);
  seen.add(g);
  addrs.push(g);
}

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
for (const [k, v] of Object.entries(shards)) fs.writeFileSync(path.join(out, "proofs", `${k}.json`), JSON.stringify(v));
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
console.log(`${addrs.length} wallets, ${Object.keys(shards).length} proof files in web/public/drop/proofs, every proof verified`);
console.log(`list ${LIST_START} -> ${PUBLIC_START}, public ${PUBLIC_START} -> ${PUBLIC_END}, fee ${FEE_BPS} bps to ${FEE_RECIPIENT} (${feeAllowed ? "already allowed on SeaDrop" : "added by this call"})`);
console.log(`multiConfigure calldata ${data.length / 2 - 1} bytes -> config/allowlists/opensea/drop.${chain}.json`);
