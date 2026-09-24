// Publish deployment addresses + chain info to the website.
//
//   node export-web.mjs <chainId> [rpcUrl]
//
// Writes ../web/public/deployment.json. The site reads it at runtime, so a redeploy never needs a rebuild.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const chainId = Number(process.argv[2] ?? 4663);
const CHAINS = {
  4663: { name: "Robinhood Chain", rpcUrl: "https://rpc.mainnet.chain.robinhood.com", explorer: "https://robinhoodchain.blockscout.com", opensea: "https://opensea.io/assets/robinhood" },
  46630: { name: "Robinhood Chain Testnet", rpcUrl: "https://rpc.testnet.chain.robinhood.com", explorer: "https://explorer.testnet.chain.robinhood.com", opensea: "" },
  31337: { name: "Local", rpcUrl: "http://127.0.0.1:8545", explorer: "", opensea: "" },
};
const chain = { ...(CHAINS[chainId] ?? CHAINS[31337]) };
if (process.argv[3]) chain.rpcUrl = process.argv[3];

const dep = JSON.parse(readFileSync(resolve(here, `../contracts/deployments/${chainId}.json`), "utf8"));
const out = { ...dep, chain: { id: chainId, ...chain } };
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

// allowlist files present?
const alDir = resolve(here, "../web/public/allowlist");
if (existsSync(alDir)) console.log("allowlists:", readdirSync(alDir).join(", ") || "none");
