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
const PUBLIC_START = Date.UTC(2026, 9, 2, 18) / 1000; // Friday 2 October 2026 18:00 UTC (20:00 in Italy)
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
// a public stage with a start time and price 0 would be a free mint for everyone: the stage must be set, at 0.018
ok(drop.startTime !== 0, "the public stage is configured");
ok(drop.mintPrice === 18_000_000_000_000_000n, "public price is 0.018 ETH (the list stage, 0.013 ETH, lives in the allowlist leaves: check it in Studio)");
ok(drop.maxTotalMintableByWallet === 5, `public: 5 Faces per wallet in total (${drop.maxTotalMintableByWallet})`);
ok(drop.startTime === PUBLIC_START, `public opens Friday 2 October 18:00 UTC (${new Date(drop.startTime * 1000).toISOString()})`);
ok(drop.endTime >= drop.startTime + 90 * 86400, "public stage ends at least 90 days after it opens (minting really closes with the reveal request)");
ok(fees.length === 1, `exactly one allowed fee recipient: ${fees.join(", ") || "none"}`);
if (process.env.OPENSEA_FEE_RECIPIENT) {
  ok(fees.every((f) => getAddress(f) === getAddress(process.env.OPENSEA_FEE_RECIPIENT)), "fee recipient is OpenSea's");
} else info("set OPENSEA_FEE_RECIPIENT to check the fee recipient is OpenSea's (see the fee address on OpenSea's other drops)");
ok(signers.length === 0, `no server-signed mint signers (${signers.length})`);
ok(gated.length === 0, `no token-gated stages (${gated.length})`);
info(`payers allowed to mint for others: ${payers.length ? payers.join(", ") : "none"} (OpenSea may add its own)`);
ok(!/^0x0{64}$/.test(root), `the list stage has its allowlist (root ${root}); its CSV and terms are checked in Studio`);
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

// ---- wiring: what Deploy.s.sol and DeployTrader.s.sol set up, read back from the chain ----
const wire = parseAbi([
  "function seeder() view returns (address)",
  "function renderer() view returns (address)",
  "function payout() view returns (address)",
  "function provenanceHash() view returns (bytes32)",
  "function royaltyInfo(uint256, uint256) view returns (address, uint256)",
  "function trader() view returns (address)",
  "function faces() view returns (address)",
  "function seedVault() view returns (address)",
  "function treasury() view returns (address)",
  "function team() view returns (address)",
  "function growth() view returns (address)",
  "function pollster() view returns (address)",
  "function owner() view returns (address)",
  "function duration() view returns (uint256)",
  "function isSealed() view returns (bool)",
]);
const w = (address, functionName, args = []) => pub.readContract({ address, abi: wire, functionName, args });
const same = (a, b) => getAddress(a) === getAddress(b);
ok(same(await w(dep.faces, "seeder"), dep.seeder), "NeonFaces: seeder wired");
ok(same(await w(dep.faces, "renderer"), dep.renderer), "NeonFaces: on-chain renderer set");
ok(same(await w(dep.faces, "payout"), dep.payout), "NeonFaces: payout is NeonPayout");
const prov = JSON.parse(readFileSync(resolve(here, "../art/output/provenance.json"), "utf8")).provenanceHash;
ok((await w(dep.faces, "provenanceHash")) === prov, `NeonFaces: provenance ${prov.slice(0, 10)}…`);
ok(await w(dep.art, "isSealed"), "NeonArt: art uploaded and sealed");
const [royaltyTo, royalty] = await w(dep.faces, "royaltyInfo", [1n, 10_000n]);
ok(royalty === 500n && (!process.env.ADMIN || same(royaltyTo, process.env.ADMIN)), `royalty ${Number(royalty) / 100}% to ${royaltyTo}`);
ok(same(await w(dep.seedVault, "seeder"), dep.seeder), "NeonSeedVault: seeder wired");
ok(!!dep.trader && same(await w(dep.seedVault, "trader"), dep.trader), "NeonSeedVault: NeonTrader wired (DeployTrader.s.sol)");
ok(same(await w(dep.payout, "seedVault"), dep.seedVault), "NeonPayout: 55% to NeonSeedVault");
ok(same(await w(dep.payout, "team"), dep.teamVesting), "NeonPayout: 15% to the team VestingWallet");
const treasury = await w(dep.payout, "treasury");
const growth = await w(dep.payout, "growth");
ok(!same(treasury, growth), `NeonPayout: treasury ${treasury}, growth ${growth}`);
if (process.env.ADMIN) ok(same(treasury, process.env.ADMIN), "NeonPayout: treasury is the Safe");
info(`team vesting: beneficiary ${await w(dep.teamVesting, "owner")}, ${Number(await w(dep.teamVesting, "duration")) / 86400} days`);
ok(Number(await w(dep.teamVesting, "duration")) === 180 * 86400, "team vesting lasts 180 days");
if (dep.setVotes && process.env.ADMIN) ok(same(await w(dep.setVotes, "pollster"), process.env.ADMIN), "NeonSetVotes: the Safe asks");
if (process.env.ADMIN) {
  for (const [name, role] of [["faces", "PAUSER_ROLE"], ["faces", "METADATA_ROLE"], ["seeder", "CONFIG_ROLE"]]) {
    ok(await read(dep[name], "hasRole", [roleId(role), process.env.ADMIN]), `${name}: the Safe holds ${role}`);
  }
}
if (process.env.KEEPER) ok(await read(dep.seedVault, "hasRole", [roleId("KEEPER_ROLE"), process.env.KEEPER]), "NeonSeedVault: the keeper key holds KEEPER_ROLE");

console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
