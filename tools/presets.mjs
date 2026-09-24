// Generate the holder panel's ready-made agent actions from the deployed NeonTrader.
//
//   node presets.mjs <chainId>        -> ../config/agent-presets.<chainId>.json
//
// Reads config/trader.<chainId>.json (verified tokens) and contracts/deployments/<chainId>.json (trader address).
// The agent is only ever allowed NeonTrader.swap: output always returns to the Face, price checked against
// Chainlink (≤ 1% + pool fee), daily USD cap chosen by the holder in the wizard.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const chainId = Number(process.argv[2] ?? 4663);
const cfg = JSON.parse(readFileSync(resolve(here, `../config/trader.${chainId}.json`), "utf8"));
const dep = JSON.parse(readFileSync(resolve(here, `../contracts/deployments/${chainId}.json`), "utf8"));
if (!dep.trader) throw new Error(`no "trader" in deployments/${chainId}.json — run script/DeployTrader.s.sol first`);
const trader = getAddress(dep.trader);

const tradable = cfg.tokens.filter((t) => t.symbol !== "WETH");
const presets = [
  {
    id: "trade",
    title: "Trade Stock Tokens at fair prices",
    plain:
      "Your agent can buy and sell Stock Tokens, USDG and ETH for this Face on Uniswap. Everything it buys comes straight back into the Face, never more than 1% below the Chainlink price, and never more than the daily amount you choose. It can't send anything anywhere else.",
    risk: "low",
    needsEth: true,
    approvals: tradable.map((t) => ({ token: getAddress(t.address), spender: trader, label: t.symbol })),
    dailyLimit: { target: trader, signature: "setDailyLimit(uint256)", decimals: 8 },
    calls: [{ target: trader, signature: "swap(address[],uint24[],uint256,uint256)", label: "Trade on Uniswap through NeonTrader — fair price, back into the Face" }],
  },
];

const out = resolve(here, `../config/agent-presets.${chainId}.json`);
writeFileSync(out, JSON.stringify({ _generated: `from NeonTrader ${trader} on ${new Date().toISOString()}`, presets }, null, 2));
console.log(`wrote ${out} (${presets.length} preset, ${tradable.length} approvals)`);
