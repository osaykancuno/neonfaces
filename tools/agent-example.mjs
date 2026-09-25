// A minimal NEONFACES agent: the reference loop any bot / AI agent can start from.
//
//   AGENT_PK=<the key the holder delegated> node agent-example.mjs <chainId> <tokenId> <target> "<function signature>" [args...] [--value <wei>]
//
// examples
//   node agent-example.mjs 4663 42 0xRouter "swap(address,address,uint256)" 0xTSLA 0xUSDG 1000000000000000
//   node agent-example.mjs 4663 42 0xRouter "buyWithETH(address)" 0xUSDG --value 10000000000000000
//
// What it does, in order (and what every agent should do):
//   1. find the Face account (ERC-6551) of tokenId
//   2. read agentConfig(): am I the agent? still active (not expired, Face not sold)? ETH allowance left?
//   3. check isAgentCallAllowed(target, selector) and that the account is not locked
//   4. simulate executeAsAgent, then send it — funds never leave the rules the holder set
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, toFunctionSelector, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const vIdx = argv.indexOf("--value");
const value = vIdx >= 0 ? BigInt(argv[vIdx + 1]) : 0n;
if (vIdx >= 0) argv.splice(vIdx, 2);
const [chainIdArg, tokenIdArg, target, signature, ...fnArgs] = argv;
if (!signature || !process.env.AGENT_PK) {
  console.error('usage: AGENT_PK=... node agent-example.mjs <chainId> <tokenId> <target> "<fn signature>" [args] [--value wei]');
  process.exit(1);
}
const chainId = Number(chainIdArg);
const dep = JSON.parse(readFileSync(resolve(here, `../contracts/deployments/${chainId}.json`), "utf8"));
const rpc = process.env.RPC_URL ?? { 4663: "https://rpc.mainnet.chain.robinhood.com", 46630: "https://rpc.testnet.chain.robinhood.com" }[chainId];
const chain = { id: chainId, name: "robinhood", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
const agent = privateKeyToAccount(process.env.AGENT_PK);
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ account: agent, chain, transport: http(rpc) });

const abi = parseAbi([
  "function accountOf(uint256) view returns (address)",
  "function agentConfig() view returns (address agent, address grantor, uint64 expiry, bool active, uint256 valueAllowance)",
  "function isAgentCallAllowed(address target, bytes4 selector) view returns (bool)",
  "function effectiveLockedUntil() view returns (uint64)",
  "function executeAsAgent(address target, uint256 value, bytes data) returns (bytes)",
  "error AgentNotActive()",
  "error AgentCallNotAllowed(address target, bytes4 selector)",
  "error AgentValueExceeded(uint256 requested, uint256 remaining)",
  "error AccountIsLocked(uint64 until)",
]);

// 1. the Face account
const account = await pub.readContract({ address: dep.seeder, abi, functionName: "accountOf", args: [BigInt(tokenIdArg)] });
console.log(`Face #${tokenIdArg} account: ${account}`);

// 2. who am I to this Face?
const [cfgAgent, grantor, expiry, active, allowance] = await pub.readContract({ address: account, abi, functionName: "agentConfig" });
if (cfgAgent.toLowerCase() !== agent.address.toLowerCase()) throw new Error(`not delegated: the agent is ${cfgAgent}`);
if (!active) throw new Error("delegation inactive (expired, revoked, or the Face changed hands)");
console.log(`delegated by ${grantor} until ${new Date(Number(expiry) * 1000).toISOString()}, ETH allowance ${allowance} wei`);

// 3. is this call allowed right now?
const item = parseAbiItem(`function ${signature}`);
const selector = toFunctionSelector(item);
const lockedUntil = await pub.readContract({ address: account, abi, functionName: "effectiveLockedUntil" });
if (Number(lockedUntil) * 1000 > Date.now()) throw new Error(`account locked until ${new Date(Number(lockedUntil) * 1000).toISOString()}`);
if (!(await pub.readContract({ address: account, abi, functionName: "isAgentCallAllowed", args: [target, selector] }))) {
  throw new Error(`the holder did not allow ${signature} on ${target}`);
}
if (value > allowance) throw new Error(`value ${value} exceeds the ETH allowance ${allowance}`);

// 4. act
const args = item.inputs.map((inp, i) => (/int/.test(inp.type) ? BigInt(fnArgs[i]) : fnArgs[i]));
const data = encodeFunctionData({ abi: [item], functionName: item.name, args });
const { request } = await pub.simulateContract({ address: account, abi, functionName: "executeAsAgent", args: [target, value, data], account: agent });
const hash = await wallet.writeContract(request);
const receipt = await pub.waitForTransactionReceipt({ hash });
console.log(`executed ${signature} via Face #${tokenIdArg}: ${receipt.status} ${hash}`);
