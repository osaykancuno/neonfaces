// Check the live OpenSea drop configuration after OpenSea Studio publishes it (and after every change).
//
//   node verify-drop.mjs <chainId>
//   env: RPC_URL, OPENSEA_FEE_RECIPIENT (the fee address Studio uses; checked if set),
//        ADMIN (the Treasury Safe: checked to be the only admin everywhere, with no transfer pending)
//
// NeonFaces already refuses a payout other than NeonPayout and stage fees above 10% or without restricted fee
// recipients. What it can't check on-chain is listed here: which fee recipients are allowed, signers, payers,
// token-gated stages and the allowlist Merkle root. It also checks who holds power: the Safe is the admin of
// every contract and the deploy key kept no role. Anything unexpected is printed as FAIL.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi, getAddress, formatEther, keccak256, toHex } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const chainId = Number(process.argv[2] ?? 4663);
const dep = JSON.parse(readFileSync(resolve(here, `../contracts/deployments/${chainId}.json`), "utf8"));
const rpc = process.env.RPC_URL ?? { 4663: "https://rpc.mainnet.chain.robinhood.com", 46630: "https://rpc.testnet.chain.robinhood.com" }[chainId];
const pub = createPublicClient({ transport: http(rpc, { batch: true }) });
const abi = parseAbi([
  "function getPublicDrop(address) view returns ((uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))",
  "function getCreatorPayoutAddress(address) view returns (address)",
  "function getAllowListMerkleRoot(address) view returns (bytes32)",
  "function getAllowedFeeRecipients(address) view returns (address[])",
  "function getSigners(address) view returns (address[])",
  "function getPayers(address) view returns (address[])",
  "function getTokenGatedAllowedTokens(address) view returns (address[])",
  "function owner() view returns (address)",
  "function saleManager() view returns (address)",
  "function defaultAdmin() view returns (address)",
  "function maxSupply() view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function mintPaused() view returns (bool)",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function pendingDefaultAdmin() view returns (address newAdmin, uint48 schedule)",
]);
const ROLES = {
  faces: ["DEFAULT_ADMIN", "PAUSER_ROLE", "METADATA_ROLE"],
  seeder: ["DEFAULT_ADMIN", "CONFIG_ROLE"],
  seedVault: ["DEFAULT_ADMIN", "KEEPER_ROLE"],
  art: ["DEFAULT_ADMIN", "ARTIST_ROLE"],
};
const roleId = (r) => (r === "DEFAULT_ADMIN" ? "0x" + "00".repeat(32) : keccak256(toHex(r)));
const sd = (functionName) => pub.readContract({ address: dep.seaDrop, abi, functionName, args: [dep.faces] });
const nf = (functionName) => pub.readContract({ address: dep.faces, abi, functionName });

let failed = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failed++;
};
const info = (msg) => console.log(`INFO  ${msg}`);

const [drop, payout, root, fees, signers, payers, gated, owner, manager, admin, max, supply, paused] = await Promise.all([
  sd("getPublicDrop"), sd("getCreatorPayoutAddress"), sd("getAllowListMerkleRoot"), sd("getAllowedFeeRecipients"),
  sd("getSigners"), sd("getPayers"), sd("getTokenGatedAllowedTokens"),
  nf("owner"), nf("saleManager"), nf("defaultAdmin"), nf("maxSupply"), nf("totalSupply"), nf("mintPaused"),
]);

ok(getAddress(payout) === getAddress(dep.payout), `creator payout is NeonPayout (${payout})`);
ok(drop.feeBps <= 1000 && drop.restrictFeeRecipients, `public stage fee ${drop.feeBps / 100}% with restricted recipients`);
info(`public stage: ${formatEther(drop.mintPrice)} ETH, ${drop.maxTotalMintableByWallet}/wallet, ${new Date(Number(drop.startTime) * 1000).toISOString()} -> ${new Date(Number(drop.endTime) * 1000).toISOString()}`);
ok(drop.mintPrice === 0n || drop.mintPrice >= 11_000_000_000_000_000n, "public price is at least 0.011 ETH (self-funding floor ≈ 0.009 ETH plus a margin)");
ok(fees.length === 1, `exactly one allowed fee recipient: ${fees.join(", ") || "none"}`);
if (process.env.OPENSEA_FEE_RECIPIENT) {
  ok(fees.every((f) => getAddress(f) === getAddress(process.env.OPENSEA_FEE_RECIPIENT)), "fee recipient is OpenSea's");
} else info("set OPENSEA_FEE_RECIPIENT to check the fee recipient is OpenSea's (see the fee address on OpenSea's other drops)");
ok(signers.length === 0, `no server-signed mint signers (${signers.length})`);
ok(gated.length === 0, `no token-gated stages (${gated.length})`);
info(`payers allowed to mint for others: ${payers.length ? payers.join(", ") : "none"} (OpenSea may add its own)`);
info(`allowlist root ${root}: recompute it from the published CSVs and stage terms before a presale opens`);
info(`owner() on OpenSea: ${owner}${getAddress(manager) === "0x0000000000000000000000000000000000000000" ? " (the Safe)" : " (sale manager: clear it after the sale)"}; admin ${admin}`);
info(`supply ${supply} / sellable max ${max}; mint ${paused ? "PAUSED" : "open"}`);
// ---- who holds power ----
const read = (address, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
for (const [name, roles] of Object.entries(ROLES)) {
  const a = dep[name];
  const current = getAddress(await read(a, "defaultAdmin"));
  const [pending] = await read(a, "pendingDefaultAdmin");
  if (process.env.ADMIN) ok(current === getAddress(process.env.ADMIN), `${name}: admin is the Safe (${current})`);
  else info(`${name}: admin ${current} (set ADMIN to check it is the Safe)`);
  ok(getAddress(pending) === "0x0000000000000000000000000000000000000000", `${name}: no admin transfer pending`);
  if (dep.deployer && getAddress(dep.deployer) !== current) {
    const held = [];
    for (const r of roles) if (await read(a, "hasRole", [roleId(r), dep.deployer])) held.push(r);
    ok(held.length === 0, `${name}: the deploy key holds no role${held.length ? ` (still: ${held.join(", ")})` : ""}`);
  }
}

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
