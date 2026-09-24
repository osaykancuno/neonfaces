// Trade for a Face through NeonTrader, by ticker — the simplest way for an agent to act.
//
//   AGENT_PK=<delegated key> node agent-trade.mjs <chainId> <tokenId> <FROM> <TO> <amount> [slippageBps=50]
//
// examples
//   node agent-trade.mjs 4663 42 USDG TSLA 50        # buy TSLA with 50 USDG
//   node agent-trade.mjs 4663 42 NVDA USDG 0.01      # sell 0.01 NVDA
//   node agent-trade.mjs 4663 42 ETH SPY 0.005       # buy SPY with ETH from the Face (ETH budget applies)
//
// Routing: direct pool when one side is USDG, otherwise FROM -> USDG -> TO, using the deepest pool tiers listed
// in config/trader.<chainId>.json. NeonTrader enforces the rest on-chain (output back to the Face, Chainlink
// fair price ≤ 1% + pool fees, holder's daily USD cap).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi, encodeFunctionData, parseUnits, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = dirname(fileURLToPath(import.meta.url));
const [chainIdArg, tokenIdArg, fromSym, toSym, amountArg, slipArg] = process.argv.slice(2);
if (!amountArg || !process.env.AGENT_PK) {
  console.error("usage: AGENT_PK=... node agent-trade.mjs <chainId> <tokenId> <FROM> <TO> <amount> [slippageBps]");
  process.exit(1);
}
const chainId = Number(chainIdArg);
const cfg = JSON.parse(readFileSync(resolve(here, `../config/trader.${chainId}.json`), "utf8"));
const dep = JSON.parse(readFileSync(resolve(here, `../contracts/deployments/${chainId}.json`), "utf8"));
const rpc = process.env.RPC_URL ?? { 4663: "https://rpc.mainnet.chain.robinhood.com", 46630: "https://rpc.testnet.chain.robinhood.com" }[chainId];
const chain = { id: chainId, name: "robinhood", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
const agent = privateKeyToAccount(process.env.AGENT_PK);
const pub = createPublicClient({ chain, transport: http(rpc) });
const wallet = createWalletClient({ account: agent, chain, transport: http(rpc) });

const bySym = Object.fromEntries(cfg.tokens.map((t) => [t.symbol, t]));
const sym = (s) => (s.toUpperCase() === "ETH" ? "WETH" : s.toUpperCase());
const from = bySym[sym(fromSym)];
const to = bySym[sym(toSym)];
if (!from || !to || from === to) throw new Error(`tradable: ETH, ${cfg.tokens.filter((t) => t.symbol !== "WETH").map((t) => t.symbol).join(", ")}`);
const usdg = bySym.USDG;

// path through USDG unless one side is USDG
const path = [from];
if (from !== usdg && to !== usdg) path.push(usdg);
path.push(to);
const fees = path.slice(1).map((t, i) => (path[i] === usdg ? t.fee : path[i].fee));

const abi = parseAbi([
  "function accountOf(uint256) view returns (address)",
  "function executeAsAgent(address target, uint256 value, bytes data) returns (bytes)",
  "function agentConfig() view returns (address agent, address grantor, uint64 expiry, bool active, uint256 valueAllowance)",
  "function swap(address[] path, uint24[] fees, uint256 amountIn, uint256 slippageBps) payable returns (uint256)",
  "function quote(address[] path, uint24[] fees, uint256 amountIn, uint256 slippageBps) view returns (uint256 minOut, uint256 valueUsd8)",
  "function leftToday(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "error DailyLimitExceeded(uint256 requestedUsd8, uint256 leftUsd8)",
  "error StalePrice(address token, uint256 updatedAt)",
  "error SlippageTooHigh()",
  "error AgentNotActive()",
  "error AgentCallNotAllowed(address target, bytes4 selector)",
  "error AgentValueExceeded(uint256 requested, uint256 remaining)",
  "error AccountIsLocked(uint64 until)",
]);
const read = (address, functionName, args = []) => pub.readContract({ address, abi, functionName, args });

const account = await read(dep.seeder, "accountOf", [BigInt(tokenIdArg)]);
const [, , , active] = await read(account, "agentConfig");
if (!active) throw new Error("this agent is not active on that Face (expired, revoked or the Face was sold)");

const decIn = from.symbol === "WETH" ? 18 : await read(from.address, "decimals");
const decOut = to.symbol === "WETH" ? 18 : await read(to.address, "decimals");
const amountIn = parseUnits(amountArg, decIn);
const slippage = BigInt(slipArg ?? 50);
const addrs = path.map((t) => t.address);
const [minOut, usd8] = await read(dep.trader, "quote", [addrs, fees, amountIn, slippage]);
const left = await read(dep.trader, "leftToday", [account]);
console.log(`Face #${tokenIdArg} ${account}`);
console.log(`route ${path.map((t) => t.symbol).join(" -> ")} (fees ${fees.join("/")})`);
console.log(`value $${(Number(usd8) / 1e8).toFixed(2)} · minimum out ${formatUnits(minOut, decOut)} ${to.symbol} · left today $${(Number(left) / 1e8).toFixed(2)}`);
if (usd8 > left) throw new Error("above the holder's daily trading limit");

const value = from.symbol === "WETH" ? amountIn : 0n;
const data = encodeFunctionData({ abi, functionName: "swap", args: [addrs, fees, amountIn, slippage] });
const before = to.symbol === "WETH" ? 0n : await read(to.address, "balanceOf", [account]);
const { request } = await pub.simulateContract({ address: account, abi, functionName: "executeAsAgent", args: [dep.trader, value, data], account: agent });
const hash = await wallet.writeContract(request);
const r = await pub.waitForTransactionReceipt({ hash });
const after = to.symbol === "WETH" ? 0n : await read(to.address, "balanceOf", [account]);
console.log(`${r.status}: +${formatUnits(after - before, decOut)} ${to.symbol} into the Face · ${hash}`);
