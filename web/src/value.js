// What a Face holds, in dollars: the Chainlink feeds NeonTrader trades on, read live and over the last 30 days.
// No backend and no price API: balances come from the account's token transfers, prices from Chainlink rounds.
import { parseAbi, parseAbiItem, getAddress } from "viem";
import { state } from "./chain.js";
import { tokenList } from "./actions.js";
import { logs, when } from "./journal.js";

const FEED = parseAbi([
  "function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function getRoundData(uint80 roundId) view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)",
  "function decimals() view returns (uint8)",
]);
const TRADER = parseAbi(["function feedOf(address token) view returns (address)"]);
const T20 = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const DAY = 86_400;

const feeds = new Map();
/** Chainlink feed (and its decimals) behind a token, as listed on NeonTrader; ETH uses WETH's. */
function feedOf(token) {
  const key = token.toLowerCase();
  if (!feeds.has(key)) {
    feeds.set(
      key,
      (async () => {
        const feed = await state.pub.readContract({ address: state.dep.trader, abi: TRADER, functionName: "feedOf", args: [token] });
        if (/^0x0+$/.test(feed)) return null;
        const decimals = Number(await state.pub.readContract({ address: feed, abi: FEED, functionName: "decimals" }));
        return { feed, decimals };
      })().catch(() => null),
    );
  }
  return feeds.get(key);
}

const weth = () => tokenList(state.dep).find((t) => t.symbol === "ETH")?.address;
const priced = (t) => (t.symbol === "ETH" ? weth() : t.token);

/**
 * rows: [{ sym, token (address, or null for ETH), bal (bigint), dec }] → the same rows with `usd` (number or null)
 * and `updatedAt`, plus the total. A price keeps its last value while stock markets are closed.
 */
export async function liveValue(rows) {
  const out = await Promise.all(
    rows.map(async (r) => {
      const addr = priced(r);
      const f = addr && (await feedOf(addr));
      if (!f) return { ...r, usd: null };
      const [, answer, , updatedAt] = await state.pub.readContract({ address: f.feed, abi: FEED, functionName: "latestRoundData" });
      const usd = (Number(r.bal) / 10 ** r.dec) * (Number(answer) / 10 ** f.decimals);
      return { ...r, usd, price: Number(answer) / 10 ** f.decimals, updatedAt: Number(updatedAt) };
    }),
  );
  const total = out.reduce((s, r) => s + (r.usd ?? 0), 0);
  const oldest = Math.min(...out.filter((r) => r.updatedAt).map((r) => r.updatedAt));
  return { rows: out, total, oldest: Number.isFinite(oldest) ? oldest : null };
}

/** Chainlink rounds of one feed back to `since` (one Multicall3 call per 60 rounds): [[updatedAt, price], …] oldest first. */
async function priceHistory(f, since) {
  const [latestId] = await state.pub.readContract({ address: f.feed, abi: FEED, functionName: "latestRoundData" });
  const phase = latestId >> 64n;
  let agg = latestId & 0xffffffffffffffffn;
  const points = [];
  for (let batch = 0; batch < 20 && agg > 0n; batch++) {
    const ids = [];
    for (let k = 0; k < 60 && agg - BigInt(k) > 0n; k++) ids.push((phase << 64n) | (agg - BigInt(k)));
    const res = await state.pub.multicall({
      contracts: ids.map((id) => ({ address: f.feed, abi: FEED, functionName: "getRoundData", args: [id] })),
      multicallAddress: MULTICALL3,
      allowFailure: true,
    });
    let reached = false;
    for (const r of res) {
      if (r.status !== "success") continue;
      const [, answer, , updatedAt] = r.result;
      points.push([Number(updatedAt), Number(answer) / 10 ** f.decimals]);
      if (Number(updatedAt) < since) reached = true;
    }
    agg -= BigInt(ids.length);
    if (reached) break;
  }
  return points.sort((a, b) => a[0] - b[0]);
}

const at = (points, t) => {
  let v = points.length ? points[0][1] : null;
  for (const [u, p] of points) if (u <= t) v = p;
  return v;
};

/**
 * Daily value of the tokens inside a Face over the last `days` days (plus now): today's balances walked back
 * through the account's transfers, times the Chainlink price of each day. ETH is counted at today's amount.
 * → { t: [unix], v: [usd] } or null when nothing is priced.
 */
export async function valueHistory(account, rows, days = 30) {
  const now = Math.floor(Date.now() / 1000);
  const grid = Array.from({ length: days }, (_, i) => now - (days - 1 - i) * DAY);
  const series = await Promise.all(
    rows.map(async (r) => {
      const addr = priced(r);
      const f = addr && (await feedOf(addr));
      if (!f) return null;
      const prices = await priceHistory(f, grid[0]);
      let flows = [];
      if (r.token) {
        const [ins, outs] = await Promise.all([
          logs(getAddress(r.token), T20, { to: account }),
          logs(getAddress(r.token), T20, { from: account }),
        ]);
        flows = await Promise.all([
          ...ins.map(async (l) => [await when(l), l.args.value]),
          ...outs.map(async (l) => [await when(l), -l.args.value]),
        ]);
      }
      const balAt = (t) => {
        let b = r.bal;
        for (const [u, d] of flows) if (u > t) b -= d;
        return b < 0n ? 0n : b;
      };
      return grid.map((t) => (Number(balAt(t)) / 10 ** r.dec) * (at(prices, t) ?? 0));
    }),
  );
  const live = series.filter(Boolean);
  if (!live.length) return null;
  return { t: grid, v: grid.map((_, i) => live.reduce((s, x) => s + x[i], 0)) };
}

/** A small neon line: the value over the period, with its first and last points. */
export function sparkline({ t, v }) {
  const W = 320, H = 72, P = 4;
  const lo = Math.min(...v), hi = Math.max(...v);
  const span = hi - lo || 1;
  const x = (i) => P + (i / (v.length - 1)) * (W - 2 * P);
  const y = (val) => H - P - ((val - lo) / span) * (H - 2 * P);
  const d = v.map((val, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(val).toFixed(1)}`).join("");
  const day = (s) => new Date(s * 1000).toISOString().slice(5, 10);
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="Value of the tokens inside over the last ${v.length} days, from $${v[0].toFixed(2)} to $${v[v.length - 1].toFixed(2)}">
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <circle cx="${x(v.length - 1).toFixed(1)}" cy="${y(v[v.length - 1]).toFixed(1)}" r="3" fill="currentColor"/>
  </svg><div class="spark-axis"><span>${day(t[0])}</span><span>today</span></div>`;
}
