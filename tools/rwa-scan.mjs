// Which tokenized assets could join the baskets and the agents' trading list: for each candidate, the
// Chainlink feed (fresh?), the Uniswap v3 pools against USDG (and WETH) and the USD depth of the deepest one.
//
//   node rwa-scan.mjs [../config/rwa-candidates.4663.json]
//
// A token can go into NeonTrader (and so into a basket) only with a fresh market-price feed and a pool deep
// enough that the seed vault's buys and the agents' trades clear within NeonTrader's 2% bound.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, http, parseAbi, formatUnits, getAddress } from "viem";

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(resolve(process.argv[2] ?? resolve(here, "../config/rwa-candidates.4663.json")), "utf8"));
const trader = JSON.parse(readFileSync(resolve(here, "../config/trader.4663.json"), "utf8"));
const client = createPublicClient({ transport: http(process.env.RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com", { batch: true }) });
const FACTORY = trader.uniswap.v3Factory;
const USDG = trader.tokens.find((t) => t.symbol === "USDG").address;
const WETH = trader.weth;
const abi = parseAbi([
  "function getPool(address, address, uint24) view returns (address)",
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function liquidity() view returns (uint128)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function decimals() view returns (uint8)",
]);
const read = (address, functionName, args = []) => client.readContract({ address: getAddress(address.toLowerCase()), abi, functionName, args });
const ethUsd = await (async () => {
  const f = trader.tokens.find((t) => t.symbol === "WETH").feed;
  const [, a] = await read(f, "latestRoundData");
  return Number(a) / 1e8;
})();

const rows = [];
for (const c of cfg.candidates) {
  const [symbol, dec] = await Promise.all([read(c.address, "symbol").catch(() => "?"), read(c.address, "decimals").catch(() => 18)]);
  const [, answer, , updatedAt] = await read(c.feed, "latestRoundData");
  const fdec = await read(c.feed, "decimals");
  const price = Number(answer) / 10 ** Number(fdec);
  const ageH = (Date.now() / 1000 - Number(updatedAt)) / 3600;
  let best = { usd: 0 };
  for (const [quote, qsym, qusd, qdec] of [[USDG, "USDG", 1, 6], [WETH, "WETH", ethUsd, 18]]) {
    for (const fee of [100, 500, 3000, 10000]) {
      const pool = await read(FACTORY, "getPool", [c.address, quote, fee]);
      if (/^0x0{40}$/i.test(pool)) continue;
      const [bt, bq] = await Promise.all([read(c.address, "balanceOf", [pool]), read(quote, "balanceOf", [pool])]);
      const usd = Number(formatUnits(bt, Number(dec))) * price + Number(formatUnits(bq, qdec)) * qusd;
      if (usd > best.usd) best = { usd, pool, fee, quote: qsym };
    }
  }
  rows.push({ symbol, kind: c.kind, price, ageH, ...best, decimals: Number(dec) });
}
rows.sort((a, b) => b.usd - a.usd);
console.log("symbol  kind              price       feed age   deepest pool (TVL, tier, pair)");
for (const r of rows) {
  console.log(
    `${r.symbol.padEnd(7)} ${String(r.kind).padEnd(17)} ${("$" + r.price.toFixed(2)).padStart(10)}  ${(r.ageH.toFixed(1) + " h").padStart(8)}   ` +
      (r.usd ? `$${Math.round(r.usd).toLocaleString("en-US").padStart(10)}  ${(r.fee / 10000).toFixed(2)}%  vs ${r.quote}  ${r.pool}` : "no pool"),
  );
}
