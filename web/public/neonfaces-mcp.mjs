#!/usr/bin/env node
// NEONFACES: talk to your Face. A Model Context Protocol server for AI assistants (Claude Desktop, and any
// MCP client). One file, no dependencies, Node 18+. It only READS the chain; for anything that changes a Face
// it returns a link to the Face page, where the holder reads the action in plain words and confirms it in
// their own wallet. It never sees or asks for keys.
// Tools: face, analysis (What I see: the Face's facts in its own words), market, check (a link, an address, a
// transaction or a signature request, before you click or sign), prices, faces_of, prepare_action.
//
// Claude Desktop > Settings > Developer > Edit config, add:
//   "mcpServers": { "neonfaces": { "command": "node", "args": ["C:/path/to/neonfaces-mcp.mjs"] } }
// env (optional): NEONFACES_SITE (default https://neonfaces.xyz/), RPC_URL (default: the site's RPC)
import { createInterface } from "node:readline";

const SITE = (process.env.NEONFACES_SITE || "https://neonfaces.xyz/").replace(/\/?$/, "/");
let dep;
async function deployment() {
  dep ??= await fetch(`${SITE}deployment.json`).then((r) => {
    if (!r.ok) throw new Error(`NEONFACES isn't deployed yet (${SITE}deployment.json not found)`);
    return r.json();
  });
  return dep;
}
async function rpcUrls() {
  if (process.env.RPC_URL) return [process.env.RPC_URL];
  const c = (await deployment()).chain;
  // the site's Alchemy key answers only the site itself, and dRPC's free tier refuses batches
  return [c.rpcUrl, ...(c.rpcFallbacks ?? [])].filter((u) => !/alchemy|drpc/i.test(u));
}

// ---------------------------------------------------------------- minimal JSON-RPC + ABI helpers
let rid = 0;
async function post(body) {
  let last;
  for (const u of await rpcUrls()) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        if (r.status === 429) {
          last = new Error(`${new URL(u).host} is busy (429)`);
          await new Promise((ok) => setTimeout(ok, 800 * (attempt + 1))); // public nodes rate-limit bursts: wait, then retry
          continue;
        }
        if (!r.ok) throw new Error(`${new URL(u).host} answered ${r.status}`);
        return await r.json();
      } catch (e) {
        last = e;
        break;
      }
    }
  }
  throw last ?? new Error("no RPC answered");
}
async function rpc(method, params) {
  const r = await post({ jsonrpc: "2.0", id: ++rid, method, params });
  if (r.error) throw new Error(r.error.message);
  return r.result;
}
/** Many eth_calls in JSON-RPC batches of 20 (the official node refuses bigger bursts): hex results in order, null where one failed. */
async function calls(list) {
  const out = [];
  for (let i = 0; i < list.length; i += 20) {
    const chunk = list.slice(i, i + 20);
    const res = await post(chunk.map(([to, data], k) => ({ jsonrpc: "2.0", id: i + k, method: "eth_call", params: [{ to, data }, "latest"] })));
    const byId = new Map((Array.isArray(res) ? res : [res]).map((r) => [r.id, r]));
    chunk.forEach((_, k) => out.push(byId.get(i + k)?.result ?? null));
  }
  return out;
}
const word = (v) => BigInt(v).toString(16).padStart(64, "0");
const addr = (a) => a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const call = (to, data) => rpc("eth_call", [{ to, data }, "latest"]);
const words = (hex) => (hex.slice(2).match(/.{64}/g) || []).map((w) => BigInt("0x" + w));
const asAddr = (w) => "0x" + w.toString(16).padStart(40, "0");
function asString(hex) {
  const b = Buffer.from(hex.slice(2), "hex");
  const off = Number(b.readBigUInt64BE(24));
  const len = Number(b.readBigUInt64BE(off + 24));
  return b.subarray(off + 32, off + 32 + len).toString("utf8");
}
const SEL = {
  tokenURI: "0xc87b56dd", ownerOf: "0x6352211e", balanceOf: "0x70a08231", price: "0xaea91078", agentConfig: "0x5e6b04f3",
  strategyOf: "0x120b1912", leftToday: "0xac26de0c", dailyLimit: "0xf3f51415", lockedUntil: "0x338fc0ad", decimals: "0x313ce567",
  totalSupply: "0x18160ddd", setOf: "0x8ad023eb", isAssembled: "0x214f41ee",
  feedOf: "0x4b45e8a6", latestRoundData: "0xfeaf968c", getRoundData: "0x9a6fc8f5", quoteExactInput: "0xcdca1753",
  name: "0x06fdde03", symbol: "0x95d89b41", accountOf: "0x8f4e4321",
};

const usd = (v8) => `$${(Number(v8) / 1e8).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
const fmt = (v, d) => (Number(v) / 10 ** d).toLocaleString("en-US", { maximumFractionDigits: 6 });
const tokens = async () => (await deployment()).tradeTokens?.map((t) => ({ ...t, symbol: t.symbol === "WETH" ? "ETH" : t.symbol })) ?? [];
const decCache = new Map();
async function decimalsOf(t) {
  if (t.symbol === "ETH") return 18;
  if (!decCache.has(t.address)) decCache.set(t.address, Number(words(await call(t.address, SEL.decimals))[0]));
  return decCache.get(t.address);
}
async function priceOf(t) {
  try {
    return words(await call((await deployment()).trader, SEL.price + addr(t.address)))[0];
  } catch {
    return null; // stale (market closed) or unknown
  }
}

function describeStrategy(ts, w) {
  const [kind, token, funding, bps, every, usd8] = w;
  const sym = (a) => ts.find((t) => t.address.toLowerCase() === asAddr(a).toLowerCase())?.symbol ?? "?";
  const e = Number(every);
  const [n, unit] = e % 604_800 === 0 ? [e / 604_800, "week"] : e % 86_400 === 0 ? [e / 86_400, "day"] : [Math.round(e / 3600), "hour"];
  const per = n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
  if (kind === 1n) return `accumulate: buy ${sym(token)} with ${usd(usd8)} of ${sym(funding)} ${per}`;
  if (kind === 2n) return `keep at least ${Number(bps) / 100}% in ${sym(token)}, checked ${per}`;
  if (kind === 3n) return `trim ${sym(token)} above ${Number(bps) / 100}% of the Face into ${sym(funding)}, checked ${per}`;
  return "none";
}

// ==== BEGIN bundled What I see (generated by scripts/bundle-mcp.mjs from src/analysis.js and src/guard.js: edit those) ====
const ANALYSIS = (() => {
// What I see (docs/ANALYST.md): the numbers behind a Face's digest and the sentences it says, from chain data only.
// Pure functions, no imports: the web app feeds them Chainlink rounds and balances, and the tests feed them fixed data.
// Facts, never advice: every sentence passes wordingProblems() (a unit test runs it over every template).

const DAY = 86_400;

/** Asset classes for the Mix section. Everything not listed is a single stock. */
const CLASS = { USDG: "dollars", ETH: "ether", WETH: "ether", CBBTC: "bitcoin", SPY: "index funds", QQQ: "index funds", GLD: "metals", SLV: "metals" };
const classOf = (sym) => CLASS[String(sym).toUpperCase()] ?? "single stocks";
const isStock = (sym) => !["dollars", "ether", "bitcoin"].includes(classOf(sym));

// ---------------------------------------------------------------- numbers

/** Price at time t from Chainlink points [[updatedAt, price], …] sorted oldest first (null before the first one). */
function priceAt(points, t) {
  let v = null;
  for (const [u, p] of points) {
    if (u > t) break;
    v = p;
  }
  return v;
}

/** One price per day at the same time of day as `now`, oldest first: days + 1 points (the last is now). */
function dailySeries(points, now, days = 30) {
  return Array.from({ length: days + 1 }, (_, i) => priceAt(points, now - (days - i) * DAY));
}

/** Change from `days` ago to now, as a fraction (0.031 = +3.1%), or null if either price is missing. */
function change(points, now, days) {
  const a = priceAt(points, now - days * DAY);
  const b = priceAt(points, now);
  return a && b != null ? b / a - 1 : null;
}

/** Day-to-day returns of a series; days without a new price (a closed market) are left out when `skipFlat`. */
function returns(series, skipFlat = true) {
  const out = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1];
    const b = series[i];
    if (a == null || b == null || a === 0) {
      out.push(null);
      continue;
    }
    out.push(skipFlat && a === b ? null : b / a - 1);
  }
  return out;
}

const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;

/** Typical daily move: the standard deviation of the daily returns that happened (a fraction), null under 5 days. */
function dailySwing(series) {
  const r = returns(series).filter((x) => x != null);
  if (r.length < 5) return null;
  const m = mean(r);
  return Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1));
}

/** Largest fall from a high to a later low inside the series, and how far below the series' high it is now. */
function drops(series) {
  const s = series.filter((x) => x != null);
  if (s.length < 2) return null;
  let peak = s[0];
  let worst = 0;
  for (const v of s) {
    peak = Math.max(peak, v);
    worst = Math.min(worst, v / peak - 1);
  }
  const high = Math.max(...s);
  return { worst, fromHigh: s[s.length - 1] / high - 1 };
}

/** Correlation of two series' daily returns over the days where both moved; null under 8 shared days. */
function correlation(a, b) {
  const ra = returns(a);
  const rb = returns(b);
  const x = [];
  const y = [];
  for (let i = 0; i < ra.length; i++) if (ra[i] != null && rb[i] != null) (x.push(ra[i]), y.push(rb[i]));
  if (x.length < 8) return null;
  const mx = mean(x);
  const my = mean(y);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < x.length; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
  }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

function together(r) {
  if (r == null) return null;
  if (r >= 0.6) return "moved together";
  if (r >= 0.3) return "moved loosely together";
  if (r <= -0.3) return "moved apart";
  return "moved independently";
}

/** Value of fixed amounts over the series' days: the Face as a whole, at what it carries today. */
function basketSeries(items) {
  const n = Math.max(...items.map((i) => i.series.length));
  return Array.from({ length: n }, (_, d) => {
    let v = 0;
    for (const i of items) {
      const p = i.series[d];
      if (p == null) return null;
      v += i.amount * p;
    }
    return v;
  });
}

/** NeonTrader refuses a price older than this (NeonTrader.MAX_PRICE_AGE: the feeds' 24 h heartbeat plus a margin). */
const MAX_PRICE_AGE = 26 * 3600;

/** Saturday or Sunday in New York, when Stock Token prices stop moving. */
function weekend(t) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date(t * 1000));
  return day === "Sat" || day === "Sun";
}

// ---------------------------------------------------------------- words

const pct = (f, sign = true) => `${sign && f > 0 ? "+" : ""}${(f * 100).toFixed(Math.abs(f) < 0.1 ? 1 : 0)}%`;
const pct1 = (f) => `${(f * 100).toFixed(1)}%`;
const pct2 = (f) => `${(f * 100).toFixed(2)}%`;
const DOLLAR = (sym) => classOf(sym) === "dollars"; // USDG tracks the dollar: no moves, swings or pairs to speak of
const usd = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amt = (n) => n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
const ago = (sec) => (sec < 5400 ? `${Math.max(1, Math.round(sec / 60))} min` : sec < 2 * DAY ? `${Math.round(sec / 3600)} h` : `${Math.round(sec / DAY)} days`);
const utc = (t) => {
  const d = new Date(t * 1000);
  return `${d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })} ${d.toISOString().slice(8, 10)} ${d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}, ${d.toISOString().slice(11, 16)} UTC`;
};
const list = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Words that would turn a fact into advice or a forecast. Em dashes are refused too (house style). */
const ADVICE = [
  /\bbuy\w*/i, /\bsell\w*/i, /\bholds?\b/i, /\bshould\b/i, /\bought\b/i, /\brecommend\w*/i, /\bwill (rise|fall|go|grow|drop|gain)/i,
  /\bgoing to\b/i, /\btargets?\b/i, /\bopportunit\w*/i, /\bundervalued\b/i, /\bovervalued\b/i, /\bexpect\w*/i, /\bforecast\w*/i,
  /\bpredict\w*/i, /\bcould (gain|rise|grow|earn)/i, /\bguarante\w*/i, /\bprofit\w*/i, /\bcheap\b/i, /\bbargain\b/i, /\bmoon\w*/i, new RegExp(String.fromCharCode(0x2014)), // the em dash, written as a code: house style keeps it out of every file
];
function wordingProblems(text) {
  const own = String(text).replace(/“[^”]*”/g, ""); // quotes of what the holder or the chain wrote are theirs, not ours
  return ADVICE.filter((r) => r.test(own)).map((r) => String(r));
}

/**
 * The digest of one Face. f = {
 *   now, id,
 *   items: [{ sym, amount, price, usd, updatedAt, points }]   what it carries, priced (points = Chainlink history),
 *   delivered: { t, usd } | null                             its base basket's value when it arrived,
 *   costs: { [sym]: { into, outOf, fee } }                    fractions for a $10 trade against USDG (null if unknown),
 *   activity: { entries, latest: { t, text } | null, strategy: text | null, agent: text | null, lockedUntil },
 * }
 * → [{ key, title, lines: [text], asOf }]: each section ends with the time of its data; missing data is said as such.
 */
function digest(f) {
  const { now } = f;
  const live = f.items.filter((i) => i.usd != null && i.usd >= 0.005);
  const unpriced = f.items.filter((i) => i.usd == null && i.amount > 0);
  const total = live.reduce((s, i) => s + i.usd, 0);
  const out = [];
  const oldest = (xs) => Math.min(...xs.map((i) => i.updatedAt).filter(Boolean));

  // Value
  {
    const lines = [];
    if (!live.length) lines.push("I carry nothing with a Chainlink price right now.");
    for (const i of live) lines.push(`I carry ${amt(i.amount)} ${i.sym}, worth ${usd(i.usd)} at ${usd(i.price)} each.`);
    if (live.length > 1) lines.push(`Together: ${usd(total)}.`);
    if (f.delivered?.usd) {
      const d = total / f.delivered.usd - 1;
      lines.push(
        `My basket was worth ${usd(f.delivered.usd)} when it arrived on ${utc(f.delivered.t).slice(0, 10)}. Now ${usd(total)}${Math.abs(d) < 0.0005 ? ", the same" : `, ${pct(d)}`}${f.traded ? ", counting what I carry after my trades" : ""}.`,
      );
    }
    if (unpriced.length) lines.push(`No Chainlink price for ${list(unpriced.map((i) => i.sym))}: not counted.`);
    out.push({ key: "value", title: "Value", lines, asOf: live.length ? oldest(live) : now });
  }

  // Moves
  {
    const lines = [];
    for (const i of live.filter((i) => !DOLLAR(i.sym))) {
      const c = [1, 7, 30].map((d) => [d, change(i.points, now, d)]).filter(([, c]) => c != null);
      if (!c.length) {
        lines.push(`${i.sym}: not enough price history yet.`);
        continue;
      }
      const usd30 = c.at(-1)[1] * i.usd / (1 + c.at(-1)[1]);
      lines.push(`${i.sym}: ${c.map(([d, x]) => `${pct(x)} in ${d === 1 ? "1 day" : `${d} days`}`).join(", ")} (${usd30 >= 0 ? "+" : "-"}${usd(Math.abs(usd30))} on my amount over ${c.at(-1)[0]} days).`);
    }
    if (lines.length) out.push({ key: "moves", title: "Moves", lines, asOf: oldest(live) });
  }

  // Swings
  {
    const lines = [];
    const sw = live.map((i) => ({ i, series: dailySeries(i.points, now) }));
    const rated = sw.filter((x) => !DOLLAR(x.i.sym)).map((x) => ({ ...x, swing: dailySwing(x.series), drop: drops(x.series) })).filter((x) => x.swing != null);
    for (const x of rated) {
      lines.push(
        `${x.i.sym} moved ${pct1(x.swing)} on a typical day over 30 days${x.drop && x.drop.fromHigh < -0.0005 ? `, and sits ${pct1(-x.drop.fromHigh)} below its 30-day high` : ", and sits at its 30-day high"}.`,
      );
    }
    if (rated.length > 1) {
      const top = rated.reduce((a, b) => (b.swing > a.swing ? b : a));
      lines.push(`${top.i.sym} swung the most of what I carry.`);
    }
    if (live.length > 1) {
      const whole = basketSeries(sw.map((x) => ({ amount: x.i.amount, series: x.series })));
      const s = dailySwing(whole);
      const d = drops(whole);
      if (s != null) lines.push(`As a whole I moved ${pct1(s)} on a typical day; my largest fall from a high in 30 days was ${pct1(-(d?.worst ?? 0))}.`);
    }
    if (!rated.length && live.some((i) => !DOLLAR(i.sym))) lines.push("Not enough days of prices yet to measure swings.");
    if (lines.length) out.push({ key: "swings", title: "Swings", lines, asOf: now });
  }

  // Mix
  if (live.length) {
    const lines = [];
    const big = live.reduce((a, b) => (b.usd > a.usd ? b : a));
    const share = big.usd / total;
    const classes = [...new Set(live.map((i) => classOf(i.sym)))];
    lines.push(live.length === 1 ? `All my value sits in one asset: ${big.sym}.` : `${live.length} assets. The largest, ${big.sym}, is ${pct1(share)} of my value.`);
    if (live.length > 1) lines.push(`By kind: ${list(classes.map((c) => `${c} ${pct1(live.filter((i) => classOf(i.sym) === c).reduce((s, i) => s + i.usd, 0) / total)}`))}.`);
    if (live.length === 1 && classOf(big.sym) === "single stocks") lines.push("One company's news moves all of it; a mix of assets usually moves less on any single name.");
    out.push({ key: "mix", title: "Mix", lines, asOf: oldest(live) });
  }

  // Together
  if (live.filter((i) => !DOLLAR(i.sym)).length > 1) {
    const lines = [];
    const series = live.filter((i) => !DOLLAR(i.sym)).map((i) => ({ sym: i.sym, s: dailySeries(i.points, now) }));
    for (let a = 0; a < series.length; a++)
      for (let b = a + 1; b < series.length; b++) {
        const r = correlation(series[a].s, series[b].s);
        const w = together(r);
        if (w) lines.push(`${series[a].sym} and ${series[b].sym} ${w} over 30 days (${r.toFixed(2)}).`);
      }
    if (!lines.length) lines.push("Not enough shared days of prices yet to compare them.");
    out.push({ key: "together", title: "Together", lines: lines.slice(0, 6), asOf: now });
  }

  // Market status: how old each Chainlink price is, and whether NeonTrader would trade on it
  if (live.length) {
    const lines = [];
    for (const i of live) {
      const age = now - i.updatedAt;
      const pause = isStock(i.sym) && weekend(now) ? " Stock Token prices pause at weekends." : "";
      lines.push(
        age > MAX_PRICE_AGE
          ? `${i.sym}: last Chainlink price ${utc(i.updatedAt)}, more than 26 hours ago. NeonTrader won't trade it until a fresh one arrives.${pause}`
          : `${i.sym}: last Chainlink price ${ago(age)} ago. Fresh enough for NeonTrader.${age > 6 * 3600 ? pause : ""}`,
      );
    }
    lines.push("Chainlink writes a new price when it moves enough, and at least once a day.");
    out.push({ key: "status", title: "Market status", lines, asOf: now });
  }

  // Trading cost
  if (f.costs && live.some((i) => i.sym !== "USDG")) {
    const lines = [];
    for (const i of live) {
      if (i.sym === "USDG") continue;
      const c = f.costs[i.sym];
      if (!c) {
        lines.push(`${i.sym}: no quote from the pool right now.`);
        continue;
      }
      const side = (x) => (Math.abs(x) < 0.00005 ? "the Chainlink price" : x > 0 ? `${pct2(x)} less than Chainlink` : `${pct2(-x)} more than Chainlink`);
      lines.push(`${i.sym}: a $10 trade against USDG, pool fees of ${pct2(c.fee)} included, gets ${side(c.outOf)} going out and ${side(c.into)} coming in.`);
    }
    lines.push("NeonTrader refuses any trade more than 2% away from Chainlink.");
    out.push({ key: "cost", title: "Trading cost", lines, asOf: now });
  }

  // Activity
  if (f.activity) {
    const a = f.activity;
    const lines = [];
    // entries = null when the journal couldn't be read (the MCP kit has no log index): say nothing rather than "nothing"
    if (a.entries != null) lines.push(a.entries ? `${a.entries} ${a.entries === 1 ? "entry" : "entries"} in my journal${a.latest ? `; the latest, ${utc(a.latest.t).slice(0, 10)}: “${a.latest.text}”` : "."}` : "Nothing in my journal yet.");
    lines.push(a.strategy ? `The strategy my holder set: “${a.strategy}”` : "No strategy set.");
    lines.push(a.agent ?? "No agent can act for me.");
    if (a.lockedUntil && a.lockedUntil > now) lines.push(`Locked until ${utc(a.lockedUntil)}: nothing leaves me before then.`);
    out.push({ key: "activity", title: "Activity", lines, asOf: now });
  }
  return out;
}

/** The line every panel carries once, plus the Stock Token sentence when the Face carries Stock Tokens. */
function footer(items) {
  const stocks = items.some((i) => i.amount > 0 && isStock(i.sym));
  return (
    "Facts from the chain, not advice. What you do with your Face is your choice." +
    (stocks ? " Stock Tokens give economic exposure only, not legal ownership of shares; availability depends on where you live and on the issuer's terms." : "")
  );
}

/** The market watch: every token a basket can carry, the same facts in one row each. */
function marketRow(sym, points, now) {
  const last = points.at(-1);
  if (!last) return { sym, price: null };
  const series = dailySeries(points, now);
  const d = drops(series);
  return {
    sym,
    kind: classOf(sym),
    price: last[1],
    updatedAt: last[0],
    d1: change(points, now, 1),
    d7: change(points, now, 7),
    d30: change(points, now, 30),
    swing: dailySwing(series),
    fromHigh: d?.fromHigh ?? null,
    paused: now - last[0] > MAX_PRICE_AGE,
  };
}

return { DAY, classOf, isStock, priceAt, dailySeries, change, returns, dailySwing, drops, correlation, together, basketSeries, MAX_PRICE_AGE, weekend, usd, utc, wordingProblems, digest, footer, marketRow };
})();
const GUARD = (() => {
// What I see, the scam guard (docs/ANALYST.md): a link, an address, a transaction or a signature request, told in plain
// words before the holder clicks or signs. Pure functions, no imports, no network: the page adds what only the chain
// can say (is it a contract, what does it call itself). Everything runs in the browser; nothing pasted leaves it.
// A clean check is not a guarantee: every answer says so.

const OFFICIAL_SITE = "neonfaces.xyz";
const OFFICIAL_X = "osaykancuno";
const OFFICIAL_COLLECTION = "neonfaces"; // opensea.io/collection/neonfaces
const UNLIMITED = 2n ** 255n;

/** Well-known contracts that are not ours but that the official flows use. */
const WELL_KNOWN = {
  "0x1e0049783f008a0085193e00003d00cd54003c71": "OpenSea's conduit (it moves NFTs for OpenSea listings)",
  "0x0000000000000068f116a894984e2db1123eb395": "OpenSea's Seaport 1.6 (the marketplace contract)",
  "0x000000000022d473030f116ddee9f6b43ac78ba3": "Uniswap's Permit2",
};

/** Addresses the guard recognises, from deployment.json: [{ address (lowercase), name, ours, kind }]. */
function knownFrom(dep) {
  const k = [];
  const add = (a, name, kind = "contract", ours = true) => a && k.push({ address: a.toLowerCase(), name, kind, ours });
  add(dep.faces, "NEONFACES, the collection", "collection");
  add(dep.seeder, "NeonSeeder (Face accounts, baskets and sets)");
  add(dep.trader, "NeonTrader (trades inside a Face at Chainlink prices)", "trader");
  add(dep.seaDrop, "OpenSea's SeaDrop, where NEONFACES are minted", "seadrop", false);
  add(dep.seedVault, "NeonSeedVault (the basket pool)");
  add(dep.payout, "NeonPayout (the mint's split)");
  add(dep.registry, "the ERC-6551 registry (Face accounts)", "contract", false);
  add(dep.accountImplementation, "the Face account code");
  add(dep.art, "NeonArt (the on-chain art)");
  add(dep.renderer, "the NEONFACES renderer");
  add(dep.teamVesting, "the team's vesting contract");
  add(dep.setVotes, "NeonSetVotes (the sets' polls)");
  add(dep.strategyAgent, "the NEONFACES strategy agent", "agent");
  for (const t of dep.tradeTokens ?? []) add(t.address, `the listed ${t.symbol === "WETH" ? "WETH" : t.symbol} token`, "token", false);
  for (const [a, name] of Object.entries(WELL_KNOWN)) k.push({ address: a, name, kind: "service", ours: false });
  return k;
}
const lookup = (known, a) => known.find((x) => x.address === String(a).toLowerCase());
const tokenSymbols = (known) => new Map(known.filter((x) => x.kind === "token").map((x) => [x.name.replace("the listed ", "").replace(" token", "").toUpperCase(), x.address]));

const short = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const name = (known, a) => lookup(known, a)?.name ?? short(a);
const CLEAN_NOTE = "A clean check is not a guarantee: a new scam can look clean.";
const TRICKS = "Nobody from NEONFACES DMs first. There is no airdrop, no claim and no stealth mint. Never share your seed phrase.";

// ---------------------------------------------------------------- links

const SKELETON = [[/0/g, "o"], [/1|!|\|/g, "l"], [/3/g, "e"], [/5|\$/g, "s"], [/rn/g, "m"], [/vv/g, "w"], [/[-_.]/g, ""]];
const skeleton = (s) => SKELETON.reduce((x, [r, b]) => x.replace(r, b), s.toLowerCase());
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** True when a name imitates "neonfaces": contains it after undoing swapped letters, or is one or two letters away. */
function imitates(s, target = "neonfaces") {
  const k = skeleton(s);
  if (!k) return false;
  if (k.includes(target.slice(0, -1))) return true; // neonface, neonfaces-mint, neon-faces…
  return k.length >= 6 && distance(k, target) <= 2;
}
const BAIT = /claim|airdrop|free-?mint|stealth|reward|giveaway|bonus|verify|validate|sync|restore|migrat|revoke-?all|wallet-?connect|rectify|unlock/i;

/** → { level: "ok" | "info" | "warn" | "danger", title, lines } */
function checkLink(input, known = []) {
  if (/^(javascript|data|vbscript|file|blob):/i.test(input.trim()))
    return { level: "danger", title: "Not a web link", lines: [`It starts with "${input.trim().split(":")[0]}:". Links like this can run code on the page: don't open it.`, TRICKS] };
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = decodeURIComponent(url.pathname + url.search).toLowerCase();
  const lines = [];
  const bait = BAIT.test(path) || BAIT.test(host);
  if (url.protocol !== "https:" && url.protocol !== "http:") return { level: "danger", title: "Not a web link", lines: [`It starts with "${url.protocol}". Links like this can run code or open apps: don't open it.`, TRICKS] };
  if (host.startsWith("xn--") || host.includes(".xn--") || /[^\x00-\x7f]/.test(url.hostname))
    return { level: "danger", title: "Lookalike letters", lines: [`The address "${host}" is written with letters from another alphabet that look like ours. It is not neonfaces.xyz: don't connect a wallet or sign anything there.`, TRICKS] };

  if (host === OFFICIAL_SITE) {
    lines.push("This is neonfaces.xyz, the official site.");
    if (url.protocol !== "https:") lines.push("Open it with https:// to be sure nothing sits in between.");
    if (/[?&]do=/.test(url.search)) lines.push("It prepares an action on a Face: the page shows it in plain words and nothing happens until the holder confirms in their own wallet.");
    return { level: "ok", title: "Official", lines: [...lines, CLEAN_NOTE] };
  }
  if (host.endsWith(`.${OFFICIAL_SITE}`)) return { level: "warn", title: "Not one of our addresses", lines: [`${host} is not an address we use. The site is only neonfaces.xyz.`, TRICKS] };

  if (host === "x.com" || host === "twitter.com") {
    const user = url.pathname.split("/")[1]?.toLowerCase() ?? "";
    if (user === OFFICIAL_X) return { level: "ok", title: "Official account", lines: ["x.com/osaykancuno is the official NEONFACES account.", CLEAN_NOTE] };
    if (imitates(user) || imitates(user, OFFICIAL_X)) return { level: "danger", title: "Impostor account", lines: [`@${user} imitates us. Our only account is x.com/osaykancuno.`, TRICKS] };
    return { level: "info", title: "Not our account", lines: [`@${user || "?"} is not the NEONFACES account (x.com/osaykancuno).`, CLEAN_NOTE] };
  }

  if (host === "opensea.io") {
    const col = path.match(/\/collection\/([^/?#]+)/)?.[1];
    if (col === OFFICIAL_COLLECTION) return { level: "ok", title: "The official collection", lines: ["opensea.io/collection/neonfaces is the official NEONFACES collection.", CLEAN_NOTE] };
    if (col) return { level: imitates(col) ? "danger" : "info", title: imitates(col) ? "Fake collection" : "Another collection", lines: [`"${col}" is not the NEONFACES collection. Ours is opensea.io/collection/neonfaces, contract ${known.find((k) => k.kind === "collection")?.address ?? "0x67384d95…1C1B"}.`, imitates(col) ? TRICKS : CLEAN_NOTE] };
    const contract = path.match(/0x[0-9a-f]{40}/)?.[0];
    if (contract) {
      const k = lookup(known, contract);
      if (k?.kind === "collection") return { level: "ok", title: "A real NEONFACES", lines: [`The contract in the link is the NEONFACES collection.`, CLEAN_NOTE] };
      return { level: "warn", title: "Not a NEONFACES", lines: [`The contract in this link, ${short(contract)}, is not the NEONFACES collection, whatever the page calls it.`, TRICKS] };
    }
    return { level: "info", title: "OpenSea", lines: ["opensea.io is the marketplace where NEONFACES trade. Check that a Face's contract is 0x67384d95…1C1B before you act on it.", CLEAN_NOTE] };
  }

  if (host === "robinhoodchain.blockscout.com") return { level: "info", title: "The block explorer", lines: ["Robinhood Chain's block explorer (not ours). Reading there is safe; connect a wallet only to call a contract you checked here first.", CLEAN_NOTE] };

  const label = host.split(".").slice(0, -1).join(".");
  if (imitates(label) || imitates(host.replace(/\./g, "")))
    return { level: "danger", title: "Imitation of neonfaces.xyz", lines: [`${host} is not neonfaces.xyz: it imitates our name. Don't connect a wallet, sign or type anything there.`, TRICKS] };
  if (bait) lines.push("The link talks about claims, airdrops, rewards or wallet fixes: the usual bait of wallet drainers.");
  return {
    level: bait ? "danger" : "info",
    title: bait ? "Bait" : "Not ours",
    lines: [`${host} is not on our official list (neonfaces.xyz, opensea.io/collection/neonfaces, x.com/osaykancuno).`, ...lines, "To mint or manage a Face, nothing else is needed.", bait ? TRICKS : CLEAN_NOTE],
  };
}

// ---------------------------------------------------------------- addresses

/** What an address is, from the known list alone. The page adds getCode, name() and symbol() through extra(). */
function checkAddress(a, known = []) {
  const k = lookup(known, a);
  if (k) return { level: "ok", title: k.ours ? "Official NEONFACES" : "Known", lines: [`${a} is ${k.name}.`, CLEAN_NOTE] };
  const lo = a.toLowerCase();
  const twin = known.find((x) => x.address.slice(2, 6) === lo.slice(2, 6) && x.address.slice(-4) === lo.slice(-4));
  if (twin)
    return {
      level: "danger",
      title: "Lookalike address",
      lines: [`It starts and ends like ${twin.name} (${twin.address}) but it is a different address. Scammers create lookalikes and slip them into your history so you copy the wrong one. Don't send anything to it.`],
    };
  return { level: "info", title: "Unknown address", lines: [`${short(a)} is not one of the addresses NEONFACES uses.`, CLEAN_NOTE] };
}

/** Facts read from the chain about an unknown address: { code: bool, name, symbol } → extra lines and a level. */
function addressFacts(facts, known = []) {
  const lines = [];
  let level = "info";
  if (!facts.code) lines.push("It is a wallet (no contract code).");
  else {
    lines.push(`It is a contract${facts.name ? ` called "${facts.name}"${facts.symbol ? ` (${facts.symbol})` : ""}` : ""}.`);
    if (facts.name && (imitates(facts.name) || imitates(facts.symbol ?? ""))) {
      level = "danger";
      lines.push("It calls itself NEONFACES but it is not our contract (0x67384d95…1C1B): a fake collection or a fake token.");
    }
    const real = facts.symbol && tokenSymbols(known).get(facts.symbol.toUpperCase());
    if (real) {
      level = "danger";
      lines.push(`It uses the ticker ${facts.symbol}, but the listed ${facts.symbol} is ${real}. A lookalike token: don't trade it or open any link it shows.`);
    }
    if (/https?:|www\.|\.com|\.xyz|claim|visit|reward/i.test(`${facts.name} ${facts.symbol}`)) {
      level = "danger";
      lines.push("Its name carries a link or a claim: bait sent to wallets. Never open the link or interact with it.");
    }
  }
  return { level, lines };
}

// ---------------------------------------------------------------- transactions and signatures

const words = (hex) => (hex.match(/.{64}/g) ?? []).map((w) => BigInt(`0x${w}`));
const asAddr = (w) => `0x${w.toString(16).padStart(40, "0")}`;
const amountText = (v, unit = "") => (v >= UNLIMITED ? `any amount${unit ? ` of ${unit}` : ""}` : `${v.toString()} base units${unit ? ` of ${unit}` : ""}`);
const ETH = (wei) => `${(Number(wei) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 6 })} ETH`;

/** Plain words for a call: data (0x…) sent to `to` with `value` wei, from the holder's wallet or a Face account. */
function decodeCall({ to, data = "0x", value = 0n }, known = [], depth = 0) {
  const lines = [];
  let level = "info";
  const raise = (l) => (level = { info: 0, ok: 0, warn: 1, danger: 2 }[l] > { info: 0, ok: 0, warn: 1, danger: 2 }[level] ? l : level);
  const target = to ? lookup(known, to) : null;
  const tName = to ? name(known, to) : "an unknown contract";
  const hex = String(data).toLowerCase().replace(/^0x/, "");
  value = BigInt(value || 0);
  if (!hex) {
    if (value > 0n) lines.push(`It sends ${ETH(value)} to ${tName}. Once sent, nobody can bring it back.`);
    else lines.push("It calls nothing and sends nothing.");
    return { level, lines };
  }
  const sel = hex.slice(0, 8);
  const w = words(hex.slice(8));
  const spenderOk = (a) => {
    const k = lookup(known, a);
    return k && (k.kind === "trader" || k.kind === "service");
  };
  switch (sel) {
    case "095ea7b3":
    case "39509351": {
      const spender = asAddr(w[0]);
      lines.push(`It lets ${name(known, spender)} take ${amountText(w[1], target?.name.replace("the listed ", "") ?? `the token at ${short(to ?? "0x")}`)} from this wallet, whenever it wants, until you revoke it.`);
      if (w[1] === 0n) lines.length = 0, lines.push(`It sets the allowance of ${name(known, spender)} to zero: a revoke. Safe.`);
      else if (!spenderOk(spender)) {
        raise(w[1] >= UNLIMITED ? "danger" : "warn");
        lines.push("The spender is not NeonTrader or a known service. This is how most wallets are emptied: don't sign it unless you know exactly who that is.");
      }
      break;
    }
    case "a22cb465": {
      const op = asAddr(w[0]);
      const on = w[1] !== 0n;
      const what = target?.kind === "collection" ? "every NEONFACES in this wallet, with everything inside them" : `every NFT this wallet owns in the collection ${tName}`;
      if (!on) lines.push(`It removes ${name(known, op)}'s permission over ${what}. Safe.`);
      else {
        lines.push(`It lets ${name(known, op)} move ${what}, now and later, without asking again.`);
        if (lookup(known, op)?.kind === "service") lines.push("That is OpenSea's own contract: listing on OpenSea asks for this once per collection.");
        else (raise("danger"), lines.push("The operator is not a marketplace we know. This single signature is enough to take all of them: don't sign it."));
      }
      break;
    }
    case "a9059cbb":
      lines.push(`It sends ${amountText(w[1], target?.name.replace("the listed ", "") ?? "a token")} to ${name(known, asAddr(w[0]))}. Once sent, nobody can bring it back.`);
      raise("warn");
      break;
    case "23b872dd":
    case "42842e0e":
    case "b88d4fde": {
      const nft = target?.kind === "collection";
      lines.push(`It moves ${nft ? `NEONFACES #${w[2]}` : `item or amount ${w[2]}`} from ${name(known, asAddr(w[0]))} to ${name(known, asAddr(w[1]))}.${nft ? " The Face takes everything inside it along." : ""} Once sent, nobody can bring it back.`);
      raise("warn");
      break;
    }
    case "161ac21f": {
      const nft = asAddr(w[0]);
      if (target?.kind === "seadrop" && lookup(known, nft)?.kind === "collection") {
        lines.push(`It mints ${w[3]} NEONFACES through OpenSea's SeaDrop, paying ${ETH(value)}: the official mint.`);
        level = "ok";
      } else {
        lines.push(`It mints from ${name(known, nft)}${target ? "" : ` through ${tName}`}: not the NEONFACES collection.`);
        raise("danger");
      }
      break;
    }
    case "98e9bbb6":
      lines.push(target?.kind === "trader" ? "A trade inside a Face through NeonTrader: the output always comes back into the Face, at most 2% from Chainlink." : `A call named like NeonTrader's trade, sent to ${tName}, which is not NeonTrader.`);
      if (target?.kind !== "trader") raise("danger");
      break;
    case "5c946896":
      lines.push(`It locks the Face account until ${new Date(Number(w[0]) * 1000).toISOString().slice(0, 10)}: nothing can leave it before then, not even for the holder.`);
      break;
    case "171908d5":
      lines.push(`It appoints ${name(known, asAddr(w[0]))} as the Face's agent until ${new Date(Number(w[1]) * 1000).toISOString().slice(0, 10)}, with an ETH budget of ${ETH(w[3])}. It can call only the actions you ticked; read them on the Face page before signing.`);
      if (lookup(known, asAddr(w[0]))?.kind !== "agent") (raise("warn"), lines.push("That agent is not the NEONFACES strategy agent."));
      break;
    case "87517c45":
      lines.push(`It lets ${name(known, asAddr(w[1]))} spend ${w[2] >= 2n ** 159n ? "any amount" : `${w[2]} base units`} of ${name(known, asAddr(w[0]))} through Permit2, until ${new Date(Number(w[3]) * 1000).toISOString().slice(0, 10)}.`);
      if (!spenderOk(asAddr(w[1]))) raise("danger");
      break;
    case "51945447":
    case "a7425cdb": {
      lines.push("A Face account runs what follows:");
      if (depth > 1) break;
      const inner = [];
      if (sel === "51945447") {
        const off = Number(w[2]) * 2;
        const len = Number(BigInt(`0x${hex.slice(8 + off, 8 + off + 64)}`)) * 2;
        inner.push({ to: asAddr(w[0]), value: w[1], data: `0x${hex.slice(8 + off + 64, 8 + off + 64 + len)}` });
      } else {
        const body = hex.slice(8);
        const at = (o) => BigInt(`0x${body.slice(o * 2, o * 2 + 64)}`);
        const arr = Number(at(0)) * 2;
        const n = Number(at(arr / 2));
        for (let i = 0; i < Math.min(n, 12); i++) {
          const el = arr + 64 + Number(at(arr / 2 + 32 + i * 32)) * 2;
          const t = asAddr(at(el / 2));
          const v = at(el / 2 + 32);
          const doff = el + Number(at(el / 2 + 64)) * 2;
          const dlen = Number(at(doff / 2)) * 2;
          inner.push({ to: t, value: v, data: `0x${body.slice(doff + 64, doff + 64 + dlen)}` });
        }
      }
      for (const c of inner) {
        const r = decodeCall(c, known, depth + 1);
        raise(r.level);
        lines.push(...r.lines.map((l) => `· ${l}`));
      }
      break;
    }
    default:
      lines.push(`A call to ${tName} that this check can't read (function ${`0x${sel}`}). Don't sign what nobody can tell you in plain words.`);
      raise(target?.ours ? "info" : "warn");
  }
  if (value > 0n && sel !== "161ac21f") lines.push(`It also sends ${ETH(value)}.`);
  return { level, lines };
}

/** Plain words for an EIP-712 signature request (eth_signTypedData_v4). */
function decodeTypedData(td, known = []) {
  const m = td.message ?? {};
  const pt = td.primaryType;
  const vc = td.domain?.verifyingContract;
  const lines = [];
  let level = "warn";
  const until = (s) => (s ? ` until ${new Date(Number(s) * 1000).toISOString().slice(0, 10)}` : "");
  const big = (v) => (BigInt(v ?? 0) >= 2n ** 159n ? "any amount" : `${BigInt(v ?? 0)} base units`);
  const free = (a) => lookup(known, a)?.kind === "trader" || lookup(known, a)?.kind === "service";
  if (pt === "Permit") {
    lines.push(`A signature, not a transaction, but it does the same as an approval: it lets ${name(known, m.spender)} take ${big(m.value)} of ${name(known, vc ?? "0x")} from your wallet${until(m.deadline)}, with no other confirmation.`);
    level = free(m.spender) ? "warn" : "danger";
  } else if (pt === "PermitSingle" || pt === "PermitBatch") {
    const d = [m.details ?? []].flat();
    lines.push(`A Permit2 signature: it lets ${name(known, m.spender)} spend ${d.map((x) => `${big(x.amount)} of ${name(known, x.token)}`).join(", ")}${until(m.sigDeadline)}.`);
    level = free(m.spender) ? "warn" : "danger";
  } else if (/^Permit(Witness)?(Batch)?TransferFrom$/.test(pt)) {
    const p = [m.permitted ?? []].flat();
    lines.push(`A Permit2 signature that lets ${name(known, m.spender)} move ${p.map((x) => `${big(x.amount)} of ${name(known, x.token)}`).join(", ")} out of your wallet right away.`);
    level = "danger";
  } else if (pt === "OrderComponents") {
    const items = (xs) => xs.map((x) => (["0", "1"].includes(String(x.itemType)) ? `${String(x.itemType) === "0" ? ETH(BigInt(x.startAmount)) : `${BigInt(x.startAmount)} base units of ${name(known, x.token)}`}` : `${[4, 5].includes(Number(x.itemType)) ? "ANY item" : `item #${x.identifierOrCriteria}`} of ${name(known, x.token)}`));
    const give = items(m.offer ?? []);
    const get = (m.consideration ?? []).filter((c) => String(c.recipient).toLowerCase() === String(m.offerer).toLowerCase());
    const getText = items(get);
    lines.push(`An OpenSea (Seaport) order: you give ${give.join(", ") || "nothing"} and receive ${getText.join(", ") || "NOTHING"}${until(m.endTime)}.`);
    const nftOut = (m.offer ?? []).some((x) => Number(x.itemType) >= 2);
    const paid = get.reduce((s, c) => s + (["0", "1"].includes(String(c.itemType)) ? BigInt(c.startAmount) : 0n), 0n);
    if (nftOut && paid < 10n ** 15n) {
      level = "danger";
      lines.push("Listing NFTs for almost nothing is the most common way to lose them: someone fills the order at once. Don't sign it.");
    } else lines.push("Check every item and the price above before signing.");
    if ((m.offer ?? []).some((x) => [4, 5].includes(Number(x.itemType)))) (level = "danger"), lines.push("\"ANY item\" means any NFT of that collection in your wallet.");
  } else {
    lines.push(`A signature of type "${pt ?? "?"}" for ${vc ? name(known, vc) : "an app"}. This check can't read it in full: sign only if you trust the site that asks and understand what it grants.`);
  }
  return { level, lines };
}

const SEED = /^([a-z]+\s+){11}([a-z]+\s+){0,12}[a-z]+$/;

/** The whole check: what the input looks like, then the right reader. → { kind, level, title, lines } (or async-able facts via `needs`). */
function check(raw, known = []) {
  const input = String(raw ?? "").trim();
  if (!input) return null;
  const n = input.split(/\s+/).length;
  if (SEED.test(input.toLowerCase()) && [12, 15, 18, 21, 24].includes(n))
    return { kind: "seed", level: "danger", title: "That looks like a seed phrase", lines: ["Never type it anywhere: whoever has it owns the wallet. This page sent it nowhere and cleared the box. If a site or a person asked for it, it is a scam.", TRICKS] };
  if (/^0x[0-9a-f]{40}$/i.test(input)) return { kind: "address", address: input, needs: "address", ...checkAddress(input, known) };
  if (/^0x[0-9a-f]{64}$/i.test(input))
    return { kind: "hash", level: "danger", title: "A blind signature", lines: ["Signing a bare 32-byte hash can authorize anything, and no wallet can show what. Unless you know exactly what produced it, don't sign it.", TRICKS] };
  if (/^0x[0-9a-f]{8,}$/i.test(input)) {
    const r = decodeCall({ data: input }, known);
    return { kind: "call", title: titleOf(r.level), ...r, lines: [...r.lines, "Paste the whole request (with its \"to\") for a precise answer."] };
  }
  if (/^[[{]/.test(input)) {
    let j;
    try {
      j = JSON.parse(input);
    } catch {
      return { kind: "json", level: "info", title: "Not readable", lines: ["It looks like data but isn't valid JSON. Paste the request exactly as the wallet or the site shows it."] };
    }
    if (Array.isArray(j)) j = j.find((x) => x && typeof x === "object") ?? (typeof j[1] === "string" ? safeJSON(j[1]) : null) ?? {};
    if (j.params) j = [j.params].flat().map((x) => (typeof x === "string" ? safeJSON(x) ?? x : x)).find((x) => x && typeof x === "object") ?? {};
    if (j.types && j.primaryType) {
      const r = decodeTypedData(j, known);
      return { kind: "typed", title: titleOf(r.level), ...r, lines: [...r.lines, r.level === "danger" ? TRICKS : CLEAN_NOTE] };
    }
    if (j.data || j.input || j.to) {
      const r = decodeCall({ to: j.to, data: j.data ?? j.input ?? "0x", value: j.value ?? 0 }, known);
      return { kind: "call", title: titleOf(r.level), ...r, lines: [...r.lines, r.level === "danger" ? TRICKS : CLEAN_NOTE] };
    }
    return { kind: "json", level: "info", title: "Not a request this check knows", lines: ["Paste a transaction (with \"to\" and \"data\") or a typed signature request (with \"types\" and \"primaryType\")."] };
  }
  if (!/\s/.test(input) && /\.[a-z]{2,}/i.test(input)) {
    const r = checkLink(input, known);
    if (r) return { kind: "link", ...r };
  }
  if (/wants you to sign in with your ethereum account/i.test(input)) {
    const domain = input.split(/\s/)[0].toLowerCase();
    const ours = domain === OFFICIAL_SITE;
    return { kind: "message", level: ours ? "ok" : imitates(domain) ? "danger" : "info", title: "A sign-in message", lines: [`It signs you in to ${domain}. Signing in moves nothing by itself.`, ours ? CLEAN_NOTE : imitates(domain) ? `${domain} imitates neonfaces.xyz.` : "Make sure that is the site you meant to use."] };
  }
  return { kind: "message", level: "info", title: "A text message", lines: ["Signing a readable text message moves nothing by itself. Read it to the end: if it mentions approvals, transfers or a long code, stop.", CLEAN_NOTE] };
}
function safeJSON(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
const titleOf = (level) => ({ ok: "Looks right", info: "What it does", warn: "Read before signing", danger: "Don't sign this" })[level];

return { OFFICIAL_SITE, knownFrom, imitates, checkLink, checkAddress, addressFacts, decodeCall, decodeTypedData, check };
})();
// ==== END bundled What I see ====

// ---------------------------------------------------------------- tools
async function face({ tokenId }) {
  const d = await deployment();
  const id = BigInt(tokenId);
  const owner = asAddr(words(await call(d.faces, SEL.ownerOf + word(id)))[0]);
  const uri = asString(await call(d.faces, SEL.tokenURI + word(id)));
  const meta = JSON.parse(Buffer.from(uri.slice(uri.indexOf(",") + 1), "base64").toString("utf8"));
  const account = meta.account;
  const ts = await tokens();
  const rows = [];
  let total = 0n;
  let stale = false;
  for (const t of ts) {
    const bal = t.symbol === "ETH" ? BigInt(await rpc("eth_getBalance", [account, "latest"])) : words(await call(t.address, SEL.balanceOf + addr(account)))[0];
    if (!bal) continue;
    const dec = await decimalsOf(t);
    const px = await priceOf(t);
    if (px === null) stale = true;
    const v = px === null ? null : (bal * px) / 10n ** BigInt(dec);
    if (v !== null) total += v;
    rows.push(`${fmt(bal, dec)} ${t.symbol}${v === null ? " (price unavailable: market closed)" : ` ≈ ${usd(v)}`}`);
  }
  const [agent, , expiry, active, allowance] = words(await call(account, SEL.agentConfig).catch(() => "0x"));
  const lockedUntil = words(await call(account, SEL.lockedUntil).catch(() => "0x"))[0] ?? 0n;
  const out = [`${meta.name} · holder ${owner} · account ${account}`, `Page: ${SITE}face/${tokenId}`];
  out.push(`Inside: ${rows.length ? rows.join("; ") : "nothing"}${rows.length ? ` · total ≈ ${usd(total)}${stale ? " (some prices unavailable)" : ""}` : ""}`);
  out.push(`Traits: ${meta.attributes.map((a) => `${a.trait_type}: ${a.display_type === "date" ? new Date(a.value * 1000).toISOString().slice(0, 10) : a.value}`).join(" · ")}`);
  if (d.trader) {
    const s = words(await call(d.trader, SEL.strategyOf + addr(account)));
    const [left, cap] = await Promise.all([call(d.trader, SEL.leftToday + addr(account)), call(d.trader, SEL.dailyLimit + addr(account))]).then((r) => r.map((x) => words(x)[0]));
    out.push(`Strategy: ${describeStrategy(ts, s)} · daily trading limit ${usd(cap)}, ${usd(left)} left today`);
  }
  if (active) {
    const isOurs = d.strategyAgent && asAddr(agent).toLowerCase() === d.strategyAgent.toLowerCase();
    out.push(`Agent: ${isOurs ? "the NEONFACES strategy agent" : asAddr(agent)} until ${new Date(Number(expiry) * 1000).toISOString().slice(0, 10)}, ETH budget ${fmt(allowance, 18)}`);
  } else out.push("Agent: none");
  if (lockedUntil * 1000n > BigInt(Date.now())) out.push(`Locked until ${new Date(Number(lockedUntil) * 1000).toISOString().slice(0, 10)}: nothing can leave the account.`);
  const set = words(await call(d.seeder, SEL.setOf + word(id)).catch(() => "0x"));
  if (set[0]) {
    const assembled = words(await call(d.seeder, SEL.isAssembled + word(id)))[0] === 1n;
    out.push(`Set #${set[0]}: this is the ${["left eye", "right eye", "left mouth", "right mouth"][Number(set[1])]}; pieces ${set.slice(2, 6).map((m) => `#${m}`).join(", ")}${assembled ? " · assembled in this Face" : ""}`);
  }
  return out.join("\n");
}

async function prices() {
  const out = [];
  for (const t of await tokens()) {
    const px = await priceOf(t);
    out.push(`${t.symbol}: ${px === null ? "unavailable (market closed or stale)" : usd(px)}`);
  }
  return `Chainlink prices used by NeonTrader (trades refuse prices older than 26 h, so stock trading pauses at weekends):\n${out.join("\n")}`;
}

async function facesOf({ owner }) {
  const d = await deployment();
  const total = Number(words(await call(d.faces, SEL.totalSupply))[0]);
  const want = Number(words(await call(d.faces, SEL.balanceOf + addr(owner)))[0]);
  if (!want) return `No Face found for ${owner}.`;
  const ids = [];
  for (let from = 1; from <= total && ids.length < want; from += 200) {
    const batch = Array.from({ length: Math.min(200, total - from + 1) }, (_, i) => from + i);
    const res = await calls(batch.map((id) => [d.faces, SEL.ownerOf + word(id)]));
    res.forEach((h, i) => h && h.length >= 66 && asAddr(words(h)[0]).toLowerCase() === owner.toLowerCase() && ids.push(`#${batch[i]}`));
  }
  return `Faces held by ${owner}: ${ids.join(", ")}`;
}

// ---------------------------------------------------------------- What I see (docs/ANALYST.md)
// The same modules as the site (bundled below), fed from the chain: Chainlink rounds, Uniswap's quoter, the account.

const QUOTER = { 4663: "0x33e885ed0ec9bf04ecfb19341582aadcb4c8a9e7" }; // Uniswap QuoterV2 (lowercase: the config's mixed case fails a checksum)
const DAY = 86_400;
const feeds = new Map();
/** The Chainlink feed NeonTrader trades a token on ({ feed, dec }, or null); ETH uses WETH's. */
async function feedOf(t) {
  const d = await deployment();
  const a = t.symbol === "ETH" ? d.tradeTokens.find((x) => x.symbol === "WETH").address : t.address;
  if (!feeds.has(a))
    feeds.set(
      a,
      (async () => {
        const feed = asAddr(words(await call(d.trader, SEL.feedOf + addr(a)))[0]);
        if (/^0x0+$/.test(feed)) return null;
        return { feed, dec: Number(words(await call(feed, SEL.decimals))[0]) };
      })().catch(() => null),
    );
  return feeds.get(a);
}
const roundOf = (hex, dec) => {
  const w = words(hex);
  return [Number(w[3]), Number(w[1]) / 10 ** dec]; // [updatedAt, price]
};
/** Chainlink rounds back to `since`, oldest first, 60 per batch. */
async function history(f, since) {
  const [latestId] = words(await call(f.feed, SEL.latestRoundData));
  const phase = latestId >> 64n;
  let agg = latestId & 0xffffffffffffffffn;
  const pts = [];
  for (let b = 0; b < 20 && agg > 0n; b++) {
    const ids = [];
    for (let k = 0; k < 60 && agg - BigInt(k) > 0n; k++) ids.push((phase << 64n) | (agg - BigInt(k)));
    const res = await calls(ids.map((id) => [f.feed, SEL.getRoundData + word(id)]));
    let reached = false;
    for (const h of res) {
      if (!h || h.length < 2 + 64 * 5) continue;
      const p = roundOf(h, f.dec);
      if (!p[0]) continue;
      pts.push(p);
      if (p[0] < since) reached = true;
    }
    agg -= BigInt(ids.length);
    if (reached) break;
  }
  return pts.sort((a, b) => a[0] - b[0]);
}
/** v3 route through the hubs, the same rule as the site (every token against USDG, or its hub; WETH against USDG). */
function routeOf(d, fromSym, toSym) {
  const bySym = Object.fromEntries(d.tradeTokens.map((t) => [t.symbol, t]));
  const node = (s) => bySym[s === "ETH" ? "WETH" : s];
  const hub = (t) => (t.symbol === "USDG" ? null : bySym[t.hub ?? "USDG"]);
  const chain = (t) => (hub(t) ? [t, ...chain(hub(t))] : [t]);
  const a = chain(node(fromSym));
  const b = chain(node(toSym));
  let nodes;
  for (let i = 0; i < a.length && !nodes; i++) {
    const j = b.findIndex((t) => t.symbol === a[i].symbol);
    if (j >= 0) nodes = [...a.slice(0, i + 1), ...b.slice(0, j).reverse()];
  }
  return { path: nodes.map((t) => t.address), fees: nodes.slice(1).map((y, k) => (hub(nodes[k])?.symbol === y.symbol ? nodes[k].fee : y.fee)) };
}
async function quote(r, amountIn) {
  const quoter = QUOTER[(await deployment()).chain.id];
  const packed = r.path.map((a, i) => (i ? Number(r.fees[i - 1]).toString(16).padStart(6, "0") : "") + a.toLowerCase().slice(2)).join("");
  const len = packed.length / 2;
  const data = SEL.quoteExactInput + word(64) + word(amountIn) + word(len) + packed.padEnd(Math.ceil(len / 32) * 64, "0");
  return words(await call(quoter, data))[0];
}
/** A $10 trade against USDG, in and out, compared with Chainlink: { into, outOf, fee } (fractions) or null. */
async function tradeCost(d, item, usdg) {
  if (!QUOTER[d.chain.id] || !item.price) return null;
  const decT = item.dec;
  const decU = await decimalsOf({ symbol: "USDG", address: d.tradeTokens.find((t) => t.symbol === "USDG").address });
  const out = routeOf(d, item.sym, "USDG");
  const inn = routeOf(d, "USDG", item.sym);
  const amtT = BigInt(Math.round((10 / item.price) * 10 ** Math.min(decT, 15))) * 10n ** BigInt(Math.max(0, decT - 15));
  const amtU = BigInt(Math.round((10 / usdg) * 10 ** decU));
  const [gotU, gotT] = await Promise.all([quote(out, amtT), quote(inn, amtU)]);
  return { outOf: 1 - ((Number(gotU) / 10 ** decU) * usdg) / 10, into: 1 - ((Number(gotT) / 10 ** decT) * item.price) / 10, fee: out.fees.reduce((s, f) => s + Number(f), 0) / 1e6 };
}
/** What a Face carries, priced, with 30 days of Chainlink history per token. */
async function carried(account, now) {
  const items = [];
  for (const t of await tokens()) {
    const bal = t.symbol === "ETH" ? BigInt(await rpc("eth_getBalance", [account, "latest"])) : words(await call(t.address, SEL.balanceOf + addr(account)))[0];
    if (!bal) continue;
    const dec = await decimalsOf(t);
    const amount = Number(bal) / 10 ** dec;
    const f = await feedOf(t);
    const last = f ? roundOf(await call(f.feed, SEL.latestRoundData), f.dec) : null;
    const points = f ? await history(f, now - 31 * DAY) : [];
    items.push({ sym: t.symbol, dec, amount, price: last?.[1] ?? null, usd: last ? amount * last[1] : null, updatedAt: last?.[0] ?? null, points });
  }
  return items;
}

async function analysis({ tokenId }) {
  const d = await deployment();
  const id = BigInt(tokenId);
  await call(d.faces, SEL.ownerOf + word(id)).catch(() => {
    throw new Error(`NEONFACES #${tokenId} isn't minted yet (or the chain didn't answer).`);
  });
  const account = asAddr(words(await call(d.seeder, SEL.accountOf + word(id)))[0]);
  const now = Math.floor(Date.now() / 1000);
  const items = await carried(account, now);
  const usdg = items.find((i) => i.sym === "USDG")?.price ?? 1;
  const costs = {};
  for (const i of items) if (i.usd != null && i.usd >= 0.005 && i.sym !== "USDG") costs[i.sym] = await tradeCost(d, i, usdg).catch(() => null);
  const ts = await tokens();
  const strat = d.trader ? words(await call(d.trader, SEL.strategyOf + addr(account)).catch(() => "0x")) : [];
  const [agent, , expiry, active, allowance] = words(await call(account, SEL.agentConfig).catch(() => "0x"));
  const lockedUntil = Number(words(await call(account, SEL.lockedUntil).catch(() => "0x"))[0] ?? 0n);
  const ours = active && d.strategyAgent && asAddr(agent).toLowerCase() === d.strategyAgent.toLowerCase();
  const sections = ANALYSIS.digest({
    now,
    id: Number(tokenId),
    items,
    delivered: null, // needs the seeder's events, which public nodes don't serve over the whole history: the site shows it
    costs,
    activity: {
      entries: null,
      latest: null,
      strategy: strat.length && strat[0] ? describeStrategy(ts, strat) : null,
      agent: active ? `${ours ? "The NEONFACES strategy agent" : `Agent ${asAddr(agent)}`} can act for me until ${ANALYSIS.utc(Number(expiry))}, with ${fmt(allowance, 18)} ETH to spend. My holder can stop it any time.` : null,
      lockedUntil,
    },
  });
  const clean = (l) => !ANALYSIS.wordingProblems(l).length;
  return [
    `What NEONFACES #${tokenId} sees (account ${account}), read from the chain on ${ANALYSIS.utc(now)}. Facts, not advice: pass them on as they are, never as a recommendation or a forecast.`,
    ...sections.map((x) => `## ${x.title} (data of ${ANALYSIS.utc(x.asOf)})\n${x.lines.filter(clean).map((l) => `- ${l}`).join("\n")}`),
    ANALYSIS.footer(items),
    `The Face's page adds its journal, what its basket was worth on arrival and its safety checks (approvals, tokens sent to it): ${SITE}face/${tokenId}`,
  ].join("\n\n");
}

async function market() {
  const now = Math.floor(Date.now() / 1000);
  const pct = (x) => (x == null ? "n/a" : `${x > 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
  const rows = [];
  for (const t of await tokens()) {
    const f = await feedOf(t);
    if (!f) {
      rows.push(`${t.symbol}: no Chainlink feed`);
      continue;
    }
    const points = await history(f, now - 31 * DAY);
    const last = roundOf(await call(f.feed, SEL.latestRoundData), f.dec);
    if (!points.length || points.at(-1)[0] < last[0]) points.push(last);
    const r = ANALYSIS.marketRow(t.symbol, points, now);
    const dollar = r.kind === "dollars";
    rows.push(
      `${t.symbol} (${r.kind}): $${r.price.toLocaleString("en-US", { maximumFractionDigits: r.price < 10 ? 4 : 2 })}` +
        (dollar ? "" : ` · 1 day ${pct(r.d1)} · 7 days ${pct(r.d7)} · 30 days ${pct(r.d30)} · typical day ${r.swing == null ? "n/a" : `${(r.swing * 100).toFixed(1)}%`}`) +
        ` · last price ${ANALYSIS.utc(r.updatedAt)}${r.paused ? " (older than 26 h: NeonTrader won't trade it until a fresh one)" : ""}`,
    );
  }
  return `Every token a NEONFACES basket can carry, from the Chainlink feeds NeonTrader trades on, read ${ANALYSIS.utc(now)}. "Typical day" is how much the price moved on an ordinary day over 30 days. Facts, not advice.\n${rows.join("\n")}\nStock Tokens give economic exposure only, not legal ownership of shares; availability depends on where you live and on the issuer's terms.`;
}

async function check({ input }) {
  const known = GUARD.knownFrom(await deployment());
  const r = GUARD.check(input, known);
  if (!r) return "Nothing to check: paste a link, an address, a transaction or a signature request.";
  let { level, title, lines } = r;
  if (r.needs === "address" && level === "info") {
    const code = await rpc("eth_getCode", [r.address, "latest"]);
    const facts = { code: !!code && code !== "0x" };
    if (facts.code) {
      facts.name = await call(r.address, SEL.name).then(asString).catch(() => "");
      facts.symbol = await call(r.address, SEL.symbol).then(asString).catch(() => "");
    }
    const more = GUARD.addressFacts(facts, known);
    if (more.level === "danger") (level = "danger"), (title = "Not ours, and it pretends to be");
    lines = [lines[0], ...more.lines, ...lines.slice(1)];
  }
  return `${title} [${level}]\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

const ACTIONS = ["trade", "withdraw", "lock", "strategy", "stop-agent"];
async function prepare(a) {
  const d = await deployment();
  const ts = (await tokens()).map((t) => t.symbol);
  if (!ACTIONS.includes(a.action)) throw new Error(`action must be one of ${ACTIONS.join(", ")}`);
  const q = new URLSearchParams({ do: a.action });
  const need = (k) => {
    if (a[k] === undefined || a[k] === "") throw new Error(`"${k}" is required for ${a.action}`);
    return String(a[k]);
  };
  const tok = (k) => {
    const v = need(k).toUpperCase();
    if (!ts.includes(v)) throw new Error(`${v} is not tradable. Tradable: ${ts.join(", ")}`);
    return v;
  };
  if (a.action === "trade") (q.set("from", tok("from")), q.set("to", tok("to")), q.set("amount", need("amount")));
  if (a.action === "withdraw") {
    q.set("token", a.token && String(a.token).toLowerCase() !== "all" ? tok("token") : "all");
    if (a.amount) q.set("amount", String(a.amount));
  }
  if (a.action === "lock") q.set("days", need("days"));
  if (a.action === "strategy") {
    if (!d.strategyAgent) throw new Error("The strategy agent isn't published yet.");
    q.set("kind", need("kind"));
    if (a.kind === "accumulate") (q.set("token", tok("token")), q.set("funding", tok("funding")), q.set("usd", need("usd")), q.set("every", a.every || "7d"));
    else q.set("percent", need("percent"));
    if (a.kind === "trim") q.set("token", tok("token"));
    for (const k of ["days", "cap", "eth"]) if (a[k] !== undefined) q.set(k, String(a[k]));
  }
  const link = `${SITE}face/${a.tokenId}?${q}`;
  return `Open this link, connect the wallet that holds Face #${a.tokenId}, read the summary and confirm (nothing happens otherwise):\n${link}\nWithdrawals only go to the holder's own wallet; trades go through NeonTrader (Chainlink-checked, back into the Face); strategies are run by the NEONFACES strategy agent within the daily limit, and can be stopped at any time.`;
}

const TOOLS = [
  { name: "face", description: "Everything about one NEONFACES Face: holder, what its wallet holds (with USD values), traits (tier, set, Gaze, Unblinking), agent, strategy, lock.", inputSchema: { type: "object", properties: { tokenId: { type: "integer", minimum: 1, maximum: 5555 } }, required: ["tokenId"] }, run: face },
  {
    name: "analysis",
    description:
      "What I see: one Face's facts in its own words, from the chain: what it carries and its value, moves over 1/7/30 days, typical daily swing and distance from its 30-day high, mix, which holdings moved together, how fresh each Chainlink price is, the cost of a $10 trade against USDG, strategy, agent and lock. Facts only, never advice: relay them as they are.",
    inputSchema: { type: "object", properties: { tokenId: { type: "integer", minimum: 1, maximum: 5555 } }, required: ["tokenId"] },
    run: analysis,
  },
  { name: "market", description: "Market watch: every token a NEONFACES basket can carry, with price, 1/7/30-day moves, typical daily swing and the age of its Chainlink price. Facts, not advice.", inputSchema: { type: "object", properties: {} }, run: market },
  {
    name: "check",
    description:
      "The scam guard: paste a link, an address, a transaction (JSON with to/data/value, or calldata) or a signature request (EIP-712 JSON) and get, in plain words, whether it is NEONFACES' own and what it would allow (lookalike sites, fake collections or tokens, approvals, Permit/Permit2, Seaport orders, the official mint). Use it before the holder clicks or signs anything. Never put a seed phrase or a private key into it, or anywhere.",
    inputSchema: { type: "object", properties: { input: { type: "string" } }, required: ["input"] },
    run: check,
  },
  { name: "prices", description: "Current Chainlink prices of the tokens a Face can hold and trade.", inputSchema: { type: "object", properties: {} }, run: prices },
  { name: "faces_of", description: "Which Faces a wallet address holds.", inputSchema: { type: "object", properties: { owner: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }, required: ["owner"] }, run: facesOf },
  {
    name: "prepare_action",
    description:
      "Prepare an action on a Face for its holder to confirm on the NEONFACES site (returns a link; nothing is sent). trade: from,to,amount (in `from` units; ETH allowed). withdraw: token (symbol or 'all'), optional amount; always to the holder's own wallet. lock: days (1-365). strategy: kind accumulate (token, funding USDG|ETH, usd per move, every 1d|7d|30d) | keep-liquid (percent in USDG) | trim (token, percent); optional days, cap (USD per day), eth (ETH budget). stop-agent.",
    inputSchema: {
      type: "object",
      properties: {
        tokenId: { type: "integer", minimum: 1, maximum: 5555 },
        action: { type: "string", enum: ACTIONS },
        from: { type: "string" }, to: { type: "string" }, amount: { type: "string" }, token: { type: "string" },
        days: { type: "integer" }, kind: { type: "string", enum: ["accumulate", "keep-liquid", "trim"] }, funding: { type: "string" },
        usd: { type: "number" }, every: { type: "string", enum: ["1d", "7d", "30d"] }, percent: { type: "number" }, cap: { type: "number" }, eth: { type: "string" },
      },
      required: ["tokenId", "action"],
    },
    run: prepare,
  },
];

const INSTRUCTIONS = `NEONFACES are 5555 on-chain pixel faces on Robinhood Chain; every Face is a wallet (ERC-6551) holding Stock Tokens, USDG or ETH.
Use "face" to read a Face, "analysis" for what it sees (facts from the chain, in its own words), "market" for every basket token, and "check" before the holder clicks a link or signs anything. Never promise returns or give investment advice: describe what is inside and what the holder can do; pass on "analysis" facts as they are, never as a recommendation or a forecast.
You cannot move anything: "prepare_action" returns a link the holder opens and confirms in their own wallet. Never ask for keys or seed phrases.
Rules the contracts enforce: trades go through NeonTrader (Chainlink price, at most 1% worse plus pool fee, output back into the Face, daily USD limit, no trades on stale prices at weekends); an agent can only do what the holder allowed, expires, and stops when the Face is sold; a lock blocks everything leaving the wallet.
Stock Tokens give economic exposure only, not legal ownership; whether they are available depends on where the holder lives and on the issuer's terms.`;

// ---------------------------------------------------------------- MCP over stdio (newline-delimited JSON-RPC)
const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
createInterface({ input: process.stdin }).on("line", async (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return;
  }
  if (m.id === undefined) return; // notifications
  const reply = (result) => send({ jsonrpc: "2.0", id: m.id, result });
  try {
    if (m.method === "initialize") {
      return reply({ protocolVersion: m.params?.protocolVersion ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "neonfaces", version: "1.1.0" }, instructions: INSTRUCTIONS });
    }
    if (m.method === "ping") return reply({});
    if (m.method === "tools/list") return reply({ tools: TOOLS.map(({ run, ...t }) => t) });
    if (m.method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === m.params?.name);
      if (!tool) throw new Error(`unknown tool ${m.params?.name}`);
      try {
        return reply({ content: [{ type: "text", text: await tool.run(m.params.arguments ?? {}) }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
    }
    send({ jsonrpc: "2.0", id: m.id, error: { code: -32601, message: `method not found: ${m.method}` } });
  } catch (e) {
    send({ jsonrpc: "2.0", id: m.id, error: { code: -32603, message: e.message } });
  }
});
