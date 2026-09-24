// Generate Safe{Wallet} Transaction Builder batches for the launch operations.
//
//   node safe-tx.mjs <chainId> <action> [args]
//
// actions
//   accept-admin                         acceptDefaultAdminTransfer() on faces, seeder, minter, art
//   phase <Builders|Allowlist|Public> <priceEth> <supplyCap> [allowlistJson] [maxPerWallet]
//                                        configurePhase (root read from web/public/allowlist/<file>.json)
//   open <Closed|Builders|Allowlist|Public|Finished>   setPhase
//   pause | unpause                      NeonFaces.setMintPaused
//   team-mint <to> <qty>                 NeonFaces.teamMint + NeonSeeder.activateBatch of the new ids
//   reveal-request                       NeonFaces.requestReveal (then anyone calls reveal() after 5 blocks)
//   lock-seeder                          NeonSeeder.lockConfig (baskets become immutable)
//   freeze-metadata                      NeonFaces.freezeMetadata (renderer can never change again)
//   release                              NeonMinter.releaseAll (push the 40/25/20/15 split)
//
// Output: ../safe/<chainId>-<action>.json -> import it in the Safe app (Apps > Transaction Builder).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { encodeFunctionData, parseAbi, parseEther, createPublicClient, http } from "viem";

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
  "function configurePhase(uint8 p, uint128 price, uint32 maxPerWallet, uint32 supplyCap, bytes32 merkleRoot)",
  "function setPhase(uint8 p)",
  "function setMintPaused(bool paused)",
  "function teamMint(address to, uint256 quantity) returns (uint256)",
  "function activateBatch(uint256[] tokenIds)",
  "function requestReveal()",
  "function lockConfig()",
  "function freezeMetadata()",
  "function releaseAll()",
  "function totalSupply() view returns (uint256)",
]);
const PHASES = { Closed: 0, Builders: 1, Allowlist: 2, Public: 3, Finished: 4 };
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
    txs = [dep.faces, dep.seeder, dep.minter, dep.art].map((a) => tx(a, "acceptDefaultAdminTransfer"));
    break;
  case "phase": {
    const [name, priceEth, cap, listFile, maxPerWallet] = args;
    if (!(name in PHASES) || name === "Closed" || name === "Finished") throw new Error("phase: Builders|Allowlist|Public");
    let root = "0x" + "00".repeat(32);
    if (name !== "Public") {
      const list = JSON.parse(readFileSync(resolve(here, `../web/public/allowlist/${listFile ?? name.toLowerCase()}.json`), "utf8"));
      root = list.root;
    }
    txs = [tx(dep.minter, "configurePhase", [PHASES[name], parseEther(priceEth ?? "0"), Number(maxPerWallet ?? 0), Number(cap ?? 0), root])];
    break;
  }
  case "open":
    if (!(args[0] in PHASES)) throw new Error("open: " + Object.keys(PHASES).join("|"));
    txs = [tx(dep.minter, "setPhase", [PHASES[args[0]]])];
    break;
  case "pause":
  case "unpause":
    txs = [tx(dep.faces, "setMintPaused", [action === "pause"])];
    break;
  case "team-mint": {
    const [to, qtyArg] = args;
    const qty = Number(qtyArg);
    const rpc = process.env.RPC_URL ?? { 4663: "https://rpc.mainnet.chain.robinhood.com", 46630: "https://rpc.testnet.chain.robinhood.com" }[chainId];
    if (!rpc) throw new Error("set RPC_URL to read totalSupply");
    const client = createPublicClient({ transport: http(rpc) });
    const supply = Number(await client.readContract({ address: dep.faces, abi, functionName: "totalSupply" }));
    const ids = Array.from({ length: qty }, (_, i) => BigInt(supply + 1 + i));
    txs = [tx(dep.faces, "teamMint", [to, BigInt(qty)]), tx(dep.seeder, "activateBatch", [ids])];
    console.warn(`NOTE: assumes no public mint lands between now and execution (ids ${supply + 1}..${supply + qty}).`);
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
    txs = [tx(dep.minter, "releaseAll")];
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
