// Finalize the reveal the moment it becomes possible.
//
//   PK=<any funded key> node reveal-watch.mjs <chainId>
//
// Why: NeonFaces.requestReveal() (a Safe tx) picks an L2 block 5 blocks ahead; `reveal()` must then be
// called while that block's hash is still readable (256 blocks ≈ 25 s at 100 ms blocks). Anyone can
// call reveal(); this watcher does it as soon as the target block is mined. If the window is missed,
// the Safe simply calls requestReveal() again.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = dirname(fileURLToPath(import.meta.url));
const chainId = Number(process.argv[2] ?? 4663);
const dep = JSON.parse(readFileSync(resolve(here, `../contracts/deployments/${chainId}.json`), "utf8"));
const rpc = process.env.RPC_URL ?? { 4663: "https://rpc.mainnet.chain.robinhood.com", 46630: "https://rpc.testnet.chain.robinhood.com" }[chainId];
if (!process.env.PK) throw new Error("set PK");
const account = privateKeyToAccount(process.env.PK);
const chain = { id: chainId, name: "robinhood", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ account, chain, transport: http(rpc) });
const abi = parseAbi([
  "function revealBlock() view returns (uint256)",
  "function revealSeed() view returns (uint256)",
  "function reveal()",
  "error RevealTooEarly()",
  "error RevealBlockExpired()",
  "error RevealNotRequested()",
  "error RevealAlreadyDone()",
]);
const read = (functionName) => pub.readContract({ address: dep.faces, abi, functionName });

console.log(`watching NeonFaces ${dep.faces} on ${chainId} as ${account.address}`);
let lastTarget = 0n;
for (;;) {
  if ((await read("revealSeed")) !== 0n) {
    console.log("revealed. seed:", (await read("revealSeed")).toString());
    process.exit(0);
  }
  const target = await read("revealBlock");
  if (target !== 0n && target !== lastTarget) console.log(`reveal requested for block ${target}`);
  lastTarget = target;
  if (target !== 0n) {
    try {
      await pub.simulateContract({ address: dep.faces, abi, functionName: "reveal", account });
      const hash = await wallet.writeContract({ address: dep.faces, abi, functionName: "reveal" });
      console.log("reveal() sent:", hash);
      await pub.waitForTransactionReceipt({ hash });
    } catch (e) {
      const msg = e.shortMessage ?? e.message;
      if (/RevealBlockExpired/.test(msg)) console.log("window missed: ask the Safe to call requestReveal() again");
      else if (!/RevealTooEarly/.test(msg)) console.log(msg);
    }
  }
  await new Promise((r) => setTimeout(r, 250));
}
