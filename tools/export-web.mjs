// Publish deployment addresses + chain info to the website.
//
//   node export-web.mjs <chainId> [rpcUrl]
//   OPENSEA_URL=https://opensea.io/collection/<slug> node export-web.mjs 4663
//
// Writes ../web/public/deployment.json. The site reads it at runtime, so a redeploy never needs a rebuild.
// OPENSEA_URL is the collection page OpenSea creates for the drop (the site's "Mint on OpenSea" button);
// without it the button says the link is coming. STRATEGY_AGENT is the address of the strategy agent's key.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const chainId = Number(process.argv[2] ?? 4663);
const CHAINS = {
  4663: { name: "Robinhood Chain", rpcUrl: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com", opensea: "https://opensea.io/item/robinhood" },
  46630: { name: "Robinhood Chain Testnet", rpcUrl: "https://rpc.testnet.chain.robinhood.com", explorer: "https://explorer.testnet.chain.robinhood.com", opensea: "" },
  31337: { name: "Local", rpcUrl: "http://127.0.0.1:8545", explorer: "", opensea: "" },
};
const chain = { ...(CHAINS[chainId] ?? CHAINS[31337]) };
if (process.argv[3]) chain.rpcUrl = process.argv[3];

const dep = JSON.parse(readFileSync(resolve(here, `../contracts/deployments/${chainId}.json`), "utf8"));
const out = { ...dep, chain: { id: chainId, ...chain } };
// tokens the Face page can trade and route (symbol, address, deepest pool fee vs USDG), from the verified config
const traderCfg = resolve(here, `../config/trader.${chainId}.json`);
if (existsSync(traderCfg)) {
  const t = JSON.parse(readFileSync(traderCfg, "utf8"));
  out.tradeTokens = t.tokens.map(({ symbol, address, fee }) => ({ symbol, address, fee }));
}
// the NEONFACES strategy agent (tools/agent-runner.mjs): holders can delegate to it from the Face page
if (process.env.STRATEGY_AGENT) out.strategyAgent = process.env.STRATEGY_AGENT;
else console.warn("STRATEGY_AGENT not set: the Face page won't offer the ready-made strategies");
if (process.env.OPENSEA_URL) {
  if (!/^https:\/\/opensea\.io\/collection\/[\w-]+/.test(process.env.OPENSEA_URL)) throw new Error("OPENSEA_URL: https://opensea.io/collection/<slug>");
  out.opensea = { collection: process.env.OPENSEA_URL };
} else console.warn("OPENSEA_URL not set: the site's mint button will say the link is coming");
const outPath = resolve(here, "../web/public/deployment.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(`wrote ${outPath}`);

// ready-made agent actions for the holder panel (config/agent-presets.<chainId>.json, verified addresses only)
const presetsSrc = resolve(here, `../config/agent-presets.${chainId}.json`);
const presetsDst = resolve(here, "../web/public/agent-presets.json");
if (existsSync(presetsSrc)) {
  const { presets = [] } = JSON.parse(readFileSync(presetsSrc, "utf8"));
  writeFileSync(presetsDst, JSON.stringify({ presets }, null, 2));
  console.log(`agent presets: ${presets.length}`);
} else if (!process.env.KEEP_PRESETS) {
  writeFileSync(presetsDst, JSON.stringify({ presets: [] }));
  console.log("agent presets: none (holders only see the Advanced option)");
}

