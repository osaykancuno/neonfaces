// Generate Safe{Wallet} Transaction Builder batches for the launch operations.
//
//   node safe-tx.mjs <chainId> <action> [args]
//
// actions
//   accept-admin                         acceptDefaultAdminTransfer() on faces, seeder, seed vault, art
//   sale-manager <address|none>          NeonFaces.setSaleManager: the wallet that runs the OpenSea Studio drop
//                                        (`none` after the sale: the Safe is the collection owner again)
//   pause | unpause                      NeonFaces.setMintPaused (emergency brake for the OpenSea mint)
//   team-mint <to> <qty>                 NeonFaces.teamMint (account + base seed created in the same tx; <= 50 per tx)
//   reveal-request                       NeonFaces.requestReveal (then anyone calls reveal() after 5 blocks)
//   lock-seeder                          NeonSeeder.lockConfig (baskets become immutable)
//   freeze-metadata                      NeonFaces.freezeMetadata (renderer can never change again)
//   release                              NeonPayout.releaseAll (push the 40/25/20/15 split; anyone can)
//   vault-surplus <eth>                  NeonSeedVault.releaseSurplus: leftover seed ETH to the treasury (after lock-seeder)
//
// Sale stages, prices and allowlists are configured in OpenSea Studio, not here.
// Output: ../safe/<chainId>-<action>.json -> import it in the Safe app (Apps > Transaction Builder).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi, parseEther, getAddress, zeroAddress } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const [chainIdArg, action, ...args] = process.argv.slice(2);
if (!chainIdArg || !action) {
  console.error("usage: node safe-tx.mjs <chainId> <action> [args]   (see header)");
  process.exit(1);
}
const chainId = Number(chainIdArg);
const dep = JSON.parse(readFileSync(resolve(here, `../contracts/deployments/${chainId}.json`), "utf8"));

const abi = parseAbi([
  "function acceptDefaultAdminTransfer()",
  "function setSaleManager(address manager)",
  "function setMintPaused(bool paused)",
  "function teamMint(address to, uint256 quantity) returns (uint256)",
  "function requestReveal()",
  "function lockConfig()",
  "function freezeMetadata()",
  "function releaseAll()",
  "function releaseSurplus(uint256 amount)",
]);
const tx = (to, functionName, args = []) => ({
  to,
  value: "0",
  data: encodeFunctionData({ abi, functionName, args }),
  contractMethod: null,
  contractInputsValues: null,
  _description: `${functionName}(${args.map(String).join(", ")})`,
});

let txs = [];
switch (action) {
  case "accept-admin":
    txs = [dep.faces, dep.seeder, dep.seedVault, dep.art].map((a) => tx(a, "acceptDefaultAdminTransfer"));
    break;
  case "sale-manager": {
    if (!args[0]) throw new Error("sale-manager <address|none>");
    const who = args[0] === "none" ? zeroAddress : getAddress(args[0]);
    txs = [tx(dep.faces, "setSaleManager", [who])];
    break;
  }
  case "pause":
  case "unpause":
    txs = [tx(dep.faces, "setMintPaused", [action === "pause"])];
    break;
  case "team-mint": {
    const [to, qtyArg] = args;
    const qty = Number(qtyArg);
    // each Face creates its account and receives its seed in the same tx (~190k gas per Face)
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) throw new Error("team-mint <to> <qty 1..50> — split larger amounts");
    txs = [tx(dep.faces, "teamMint", [getAddress(to), BigInt(qty)])];
    break;
  }
  case "reveal-request":
    txs = [tx(dep.faces, "requestReveal")];
    break;
  case "lock-seeder":
    txs = [tx(dep.seeder, "lockConfig")];
    break;
  case "freeze-metadata":
    txs = [tx(dep.faces, "freezeMetadata")];
    break;
  case "release":
    txs = [tx(dep.payout, "releaseAll")];
    break;
  case "vault-surplus":
    if (!args[0]) throw new Error("vault-surplus <eth>");
    txs = [tx(dep.seedVault, "releaseSurplus", [parseEther(args[0])])];
    break;
  default:
    throw new Error(`unknown action ${action}`);
}

const batch = {
  version: "1.0",
  chainId: String(chainId),
  createdAt: Date.now(),
  meta: { name: `NEONFACES ${action}`, description: txs.map((t) => t._description).join(" | ") },
  transactions: txs.map(({ _description, ...t }) => t),
};
const outPath = resolve(here, `../safe/${chainId}-${action}.json`);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(batch, null, 2));
console.log(`wrote ${outPath}`);
txs.forEach((t) => console.log(`  -> ${t.to}  ${t._description}`));
