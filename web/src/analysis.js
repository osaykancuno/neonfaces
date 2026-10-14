// What I see (docs/ANALYST.md): the numbers behind a Face's digest and the sentences it says, from chain data only.
// Pure functions, no imports: the web app feeds them Chainlink rounds and balances, and the tests feed them fixed data.
// Facts, never advice: every sentence passes wordingProblems() (a unit test runs it over every template).

export const DAY = 86_400;

/** Asset classes for the Mix section. Everything not listed is a single stock. */
const CLASS = { USDG: "dollars", ETH: "ether", WETH: "ether", CBBTC: "bitcoin", SPY: "index funds", QQQ: "index funds", GLD: "metals", SLV: "metals" };
export const classOf = (sym) => CLASS[String(sym).toUpperCase()] ?? "single stocks";
export const isStock = (sym) => !["dollars", "ether", "bitcoin"].includes(classOf(sym));

// ---------------------------------------------------------------- numbers

/** Price at time t from Chainlink points [[updatedAt, price], …] sorted oldest first (null before the first one). */
export function priceAt(points, t) {
  let v = null;
  for (const [u, p] of points) {
    if (u > t) break;
    v = p;
  }
  return v;
}

/** One price per day at the same time of day as `now`, oldest first: days + 1 points (the last is now). */
export function dailySeries(points, now, days = 30) {
  return Array.from({ length: days + 1 }, (_, i) => priceAt(points, now - (days - i) * DAY));
}

/** Change from `days` ago to now, as a fraction (0.031 = +3.1%), or null if either price is missing. */
export function change(points, now, days) {
  const a = priceAt(points, now - days * DAY);
  const b = priceAt(points, now);
  return a && b != null ? b / a - 1 : null;
}

/** Day-to-day returns of a series; days without a new price (a closed market) are left out when `skipFlat`. */
export function returns(series, skipFlat = true) {
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
export function dailySwing(series) {
  const r = returns(series).filter((x) => x != null);
  if (r.length < 5) return null;
  const m = mean(r);
  return Math.sqrt(r.reduce((s, v) => s + (v - m) ** 2, 0) / (r.length - 1));
}

/** Largest fall from a high to a later low inside the series, and how far below the series' high it is now. */
export function drops(series) {
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
export function correlation(a, b) {
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

export function together(r) {
  if (r == null) return null;
  if (r >= 0.6) return "moved together";
  if (r >= 0.3) return "moved loosely together";
  if (r <= -0.3) return "moved apart";
  return "moved independently";
}

/** Value of fixed amounts over the series' days: the Face as a whole, at what it carries today. */
export function basketSeries(items) {
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
export const MAX_PRICE_AGE = 26 * 3600;

/** Saturday or Sunday in New York, when Stock Token prices stop moving. */
export function weekend(t) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short" }).format(new Date(t * 1000));
  return day === "Sat" || day === "Sun";
}

// ---------------------------------------------------------------- words

const pct = (f, sign = true) => `${sign && f > 0 ? "+" : ""}${(f * 100).toFixed(Math.abs(f) < 0.1 ? 1 : 0)}%`;
const pct1 = (f) => `${(f * 100).toFixed(1)}%`;
const pct2 = (f) => `${(f * 100).toFixed(2)}%`;
const DOLLAR = (sym) => classOf(sym) === "dollars"; // USDG tracks the dollar: no moves, swings or pairs to speak of
export const usd = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const amt = (n) => n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
const ago = (sec) => (sec < 5400 ? `${Math.max(1, Math.round(sec / 60))} min` : sec < 2 * DAY ? `${Math.round(sec / 3600)} h` : `${Math.round(sec / DAY)} days`);
export const utc = (t) => {
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
export function wordingProblems(text) {
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
export function digest(f) {
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
export function footer(items) {
  const stocks = items.some((i) => i.amount > 0 && isStock(i.sym));
  return (
    "Facts from the chain, not advice. What you do with your Face is your choice." +
    (stocks ? " Stock Tokens give economic exposure only, not legal ownership of shares; availability depends on where you live and on the issuer's terms." : "")
  );
}

/** The market watch: every token a basket can carry, the same facts in one row each. */
export function marketRow(sym, points, now) {
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
