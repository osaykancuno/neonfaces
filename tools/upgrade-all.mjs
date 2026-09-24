// After the reveal: deliver every pending Watch / Heavy Stare top-up (permissionless, idempotent).
//
//   PK=<any funded key> node upgrade-all.mjs <chainId> [batchSize=80]
//
// Scans all minted Faces, keeps those with tier >= 2 and no top-up yet, calls NeonSeeder.upgradeBatch.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = dirname(fileURLToPath(import.meta.url));
const chainId = Number(process.argv[2] ?? 4663);
const batchSize = Number(process.argv[3] ?? 80);
const dep = JSON.parse(readFileSync(resolve(here, `../contracts/deployments/${chainId}.json`), "utf8"));
const rpc = process.env.RPC_URL ?? { 4663: "https://rpc.mainnet.chain.robinhood.com", 46630: "https://rpc.testnet.chain.robinhood.com" }[chainId];
if (!process.env.PK) throw new Error("set PK");
const chain = { id: chainId, name: "robinhood", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
const pub = createPublicClient({ chain, transport: http(rpc, { batch: true }) });
const wallet = createWalletClient({ account: privateKeyToAccount(process.env.PK), chain, transport: http(rpc) });

const abi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function revealSeed() view returns (uint256)",
  "function tierOf(uint256) view returns (uint8)",
  "function seedOf(uint256) view returns ((address account, uint8 tier, uint32 basketId, uint32 upgradeBasketId, bool activated, bool funded, bool upgraded, (address token, uint256 amount)[] legs, (address token, uint256 amount)[] upgradeLegs))",
  "function upgradeBatch(uint256[] tokenIds) returns (uint256)",
  "error InsufficientPool(address token, uint256 needed, uint256 available)",
  "error NoBasketForTier()",
]);

if ((await pub.readContract({ address: dep.faces, abi, functionName: "revealSeed" })) === 0n) {
  console.log("not revealed yet");
  process.exit(1);
}
const supply = Number(await pub.readContract({ address: dep.faces, abi, functionName: "totalSupply" }));
const pending = [];
for (let id = 1; id <= supply; id++) {
  const s = await pub.readContract({ address: dep.seeder, abi, functionName: "seedOf", args: [BigInt(id)] });
  if (s.tier >= 2 && !s.upgraded) pending.push(BigInt(id));
}
console.log(`${pending.length} Faces waiting for their Stare top-up`);

for (let i = 0; i < pending.length; i += batchSize) {
  const ids = pending.slice(i, i + batchSize);
  const { request, result } = await pub.simulateContract({ address: dep.seeder, abi, functionName: "upgradeBatch", args: [ids], account: wallet.account });
  const hash = await wallet.writeContract(request);
  await pub.waitForTransactionReceipt({ hash });
  console.log(`upgraded ${result} (ids ${ids[0]}..${ids[ids.length - 1]}) ${hash}`);
}
