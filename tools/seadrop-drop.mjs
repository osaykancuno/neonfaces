// The sale on neonfaces.xyz, through OpenSea's SeaDrop: build the one transaction the sale manager sends to NeonFaces
// and the parameters the site reads. Nothing is sent: this writes files.
//
//   node tools/seadrop-drop.mjs 4663 [--fee-bps 1000] [--fee-recipient 0x…] [--rpc URL]
//
// The NEONLIST (10 Oct, the founder): SeaDrop's public stage, 0.004 ETH a Face, up to 15 per wallet in total, from
// Tue 13 Oct 13:00 UTC to Sat 31 Oct 18:00 UTC. Every wallet mints through mintPublic, with no Merkle proof; SeaDrop
// enforces the window, the price and the per-wallet limit. The earlier allowlist stage ended on 2 Oct: its root stays
// on SeaDrop untouched (multiConfigure skips a zero root) and its leaves expired with it.
//
// -> config/allowlists/opensea/drop.4663.json (git-ignored folder): the public drop, the fee recipient and the
//    multiConfigure calldata the sale manager sends to NeonFaces (tools/configure-drop.mjs)
// -> web/public/drop/params.json: what the site's mint panel reads (the panel then follows the chain's own values)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseEther, getAddress, createPublicClient, http, parseAbi } from "viem";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const chain = process.argv[2] ?? "4663";
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const dep = JSON.parse(fs.readFileSync(path.join(ROOT, `contracts/deployments/${chain}.json`), "utf8"));
const FEE_BPS = Number(arg("--fee-bps", "1000")); // OpenSea's 10% (ECONOMICS.md assumes it)
const FEE_RECIPIENT = getAddress(arg("--fee-recipient", "0x0000a26b00c1F0DF003000390027140000fAa719"));

// the NEONLIST: 0.004 ETH with the top-ups of ECONOMICS.md (Watch +$5, Heavy Stare +$10, set $5), ≈ $6.89 of baskets per
// paid Face against ≈ $5.31 reaching the vault at ETH $2,684: the treasury and growth cover the gap (ECONOMICS.md)
const START = Date.UTC(2026, 9, 13, 13) / 1000; // Tue 13 Oct 2026 13:00 UTC
const END = Date.UTC(2026, 9, 31, 18) / 1000; // Sat 31 Oct 2026 18:00 UTC
const PUBLIC = {
  mintPrice: parseEther("0.004"),
  startTime: START,
  endTime: END,
  maxTotalMintableByWallet: 15,
  feeBps: FEE_BPS,
  restrictFeeRecipients: true,
};

const str = (o) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
const params = { seaDrop: dep.seaDrop, faces: dep.faces, feeRecipient: FEE_RECIPIENT, public: str(PUBLIC) };
const out = path.join(ROOT, "web/public/drop");
fs.rmSync(out, { recursive: true, force: true }); // the old list's proofs go with it
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "params.json"), JSON.stringify(params, null, 2) + "\n");

// what the sale manager sends to NeonFaces: one multiConfigure (the same call Studio makes) that sets the public stage
// only. SeaDrop refuses to allow a fee recipient twice (DuplicateFeeRecipient): read it live and add it only if missing.
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
    allowListData: { merkleRoot: z, publicKeyURIs: [], allowListURI: "" },
    creatorPayoutAddress: "0x0000000000000000000000000000000000000000", provenanceHash: z,
    allowedFeeRecipients: feeAllowed ? [] : [FEE_RECIPIENT], disallowedFeeRecipients: [], allowedPayers: [], disallowedPayers: [],
    tokenGatedAllowedNftTokens: [], tokenGatedDropStages: [], disallowedTokenGatedAllowedNftTokens: [],
    signers: [], signedMintValidationParams: [], disallowedSigners: [],
  }],
});
const plan = { ...params, to: dep.faces, from: "sale manager", data };
fs.writeFileSync(path.join(ROOT, `config/allowlists/opensea/drop.${chain}.json`), JSON.stringify(plan, null, 2) + "\n");
const utc = (t) => new Date(t * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
console.log(`NEONLIST (public stage): 0.004 ETH, up to 15 per wallet in total, ${utc(START)} -> ${utc(END)}`);
console.log(`fee ${FEE_BPS} bps to ${FEE_RECIPIENT} (${feeAllowed ? "already allowed on SeaDrop" : "added by this call"})`);
console.log(`web/public/drop/params.json written; multiConfigure calldata ${data.length / 2 - 1} bytes -> config/allowlists/opensea/drop.${chain}.json`);
