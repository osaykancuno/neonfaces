// What I see: the numbers on fixed data, and the wording rule over every sentence the digest can say.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DAY, priceAt, dailySeries, change, dailySwing, drops, correlation, together, digest, footer, wordingProblems, weekend, marketRow, classOf } from "../src/analysis.js";

const NOW = Date.UTC(2026, 9, 14, 15, 0) / 1000; // Wed 14 Oct 2026 15:00 UTC = 11:00 in New York: market open
const SAT = Date.UTC(2026, 9, 17, 15, 0) / 1000;

/** A price every 6 hours for 40 days, from a function of the day index (0 = 40 days ago). */
const pts = (f, now = NOW) => Array.from({ length: 161 }, (_, k) => [now - (160 - k) * (DAY / 4), f(k / 4)]);

test("prices at a time, daily series and changes", () => {
  const p = [[100, 1], [200, 2], [300, 3]];
  assert.equal(priceAt(p, 50), null);
  assert.equal(priceAt(p, 250), 2);
  const lin = pts((d) => 100 + d);
  assert.equal(dailySeries(lin, NOW, 30).length, 31);
  assert.ok(Math.abs(change(lin, NOW, 30) - (140 / 110 - 1)) < 1e-9);
  assert.equal(change([[NOW, 5]], NOW, 7), null);
});

test("swings, drops, correlation", () => {
  const alt = pts((d) => (Math.floor(d) % 2 ? 101 : 99));
  const s = dailySwing(dailySeries(alt, NOW));
  assert.ok(s > 0.019 && s < 0.022, `swing ${s}`);
  assert.equal(dailySwing([1, 1, 1, 1, 1, 1, 1]), null, "a market that never moved has no measured swing");
  const d = drops([100, 120, 90, 110]);
  assert.ok(Math.abs(d.worst - (90 / 120 - 1)) < 1e-9);
  assert.ok(Math.abs(d.fromHigh - (110 / 120 - 1)) < 1e-9);
  const a = [100, 102, 101, 104, 103, 107, 105, 108, 110, 109, 112];
  assert.ok(correlation(a, a.map((x) => x * 2)) > 0.99);
  assert.ok(correlation(a, a.map((x) => 300 - x)) < -0.99);
  assert.equal(together(0.8), "moved together");
  assert.equal(together(-0.5), "moved apart");
  assert.equal(together(0.1), "moved independently");
  assert.equal(correlation([1, 2, 3], [1, 2, 3]), null);
});

test("weekends in New York, asset classes", () => {
  assert.equal(weekend(NOW), false);
  assert.equal(weekend(SAT), true);
  assert.equal(weekend(Date.UTC(2026, 9, 19, 2, 0) / 1000), true); // Monday 02:00 UTC is still Sunday in New York
  assert.equal(weekend(Date.UTC(2026, 9, 19, 14, 0) / 1000), false);
  assert.equal(classOf("NVDA"), "single stocks");
  assert.equal(classOf("SPY"), "index funds");
});

const item = (sym, amount, f, { now = NOW, stale = 0 } = {}) => {
  const points = pts(f, now - stale);
  const price = points.at(-1)[1];
  return { sym, amount, price, usd: amount * price, updatedAt: points.at(-1)[0], points };
};

const SCENARIOS = {
  "one stock, open market": { now: NOW, items: [item("NVDA", 0.0275, (d) => 180 + Math.sin(d) * 4)], delivered: { t: NOW - 3 * DAY, usd: 5 } },
  "a mixed basket, Saturday": {
    now: SAT,
    items: [
      item("TSLA", 0.0112, (d) => 430 + d * 2 + Math.sin(d * 3) * 9, { now: SAT, stale: 30 * 3600 }),
      item("AAPL", 0.02, (d) => 250 + d + Math.sin(d * 3) * 3, { now: SAT, stale: 20 * 3600 }),
      item("ETH", 0.001, (d) => 4000 - d * 10 + Math.cos(d * 2) * 40, { now: SAT }),
      item("USDG", 1.5, () => 1, { now: SAT }),
    ],
    delivered: { t: SAT - 10 * DAY, usd: 15 },
    costs: { TSLA: { into: 0.0041, outOf: 0.0037, fee: 0.003 }, AAPL: { into: 0.0011, outOf: 0.0008, fee: 0.0005 }, ETH: null },
    activity: { entries: 4, latest: { t: SAT - DAY, text: "Traded 0.001 ETH for 0.0087 NVDA." }, strategy: "Buy NVDA with $2 of ETH every day.", agent: "The NEONFACES strategy agent can act for me until 2026-12-31.", lockedUntil: SAT + 5 * DAY },
  },
  "a stale feed in market hours": { now: NOW, items: [item("MSFT", 0.01, (d) => 500 + d, { stale: 6 * 3600 }), item("GOOGL", 0.02, (d) => 250 - d)], delivered: { t: NOW - DAY, usd: 10.6 } },
  "nothing priced": { now: NOW, items: [{ sym: "XYZ", amount: 3, usd: null, points: [] }], activity: { entries: 0, latest: null, strategy: null, agent: null } },
  "a short history": { now: NOW, items: [{ sym: "SPCX", amount: 0.1, price: 40, usd: 4, updatedAt: NOW - 600, points: [[NOW - 2 * DAY, 39], [NOW - 600, 40]] }] },
};

test("the digest states facts for every scenario, with the time of its data", () => {
  for (const [name, f] of Object.entries(SCENARIOS)) {
    const d = digest(f);
    assert.ok(d.length >= 1, name);
    for (const s of d) {
      assert.ok(s.lines.length, `${name}: ${s.key} is empty`);
      assert.ok(Number.isFinite(s.asOf), `${name}: ${s.key} has no time`);
    }
  }
  const mixed = digest(SCENARIOS["a mixed basket, Saturday"]);
  const keys = mixed.map((s) => s.key);
  assert.deepEqual(keys, ["value", "moves", "swings", "mix", "together", "status", "cost", "activity"]);
  const status = mixed.find((s) => s.key === "status").lines.join(" ");
  assert.match(status, /TSLA: last Chainlink price Fri 16 Oct, 09:00 UTC, more than 26 hours ago\. NeonTrader won't trade it/);
  assert.match(status, /AAPL: last Chainlink price 20 h ago\. Fresh enough for NeonTrader\. Stock Token prices pause at weekends\./);
  assert.match(status, /ETH: last Chainlink price 1 min ago\. Fresh enough for NeonTrader\.$|ETH: last Chainlink price \d+ min ago/);
  assert.match(mixed.find((s) => s.key === "cost").lines.join(" "), /ETH: no quote/);
  const single = digest(SCENARIOS["one stock, open market"]).find((s) => s.key === "mix").lines.join(" ");
  assert.match(single, /All my value sits in one asset: NVDA/);
  assert.match(digest(SCENARIOS["a stale feed in market hours"]).find((s) => s.key === "status").lines.join(" "), /MSFT: last Chainlink price 6 h ago\. Fresh enough for NeonTrader\.(?! Stock)/);
  assert.match(digest(SCENARIOS["nothing priced"])[0].lines.join(" "), /No Chainlink price for XYZ/);
});

test("wording rule: no advice, no forecast, no em dash, in any sentence", () => {
  const all = [];
  for (const f of Object.values(SCENARIOS)) for (const s of digest(f)) all.push(s.title, ...s.lines);
  all.push(footer(SCENARIOS["a mixed basket, Saturday"].items));
  for (const t of all) assert.deepEqual(wordingProblems(t), [], t);
  // and the rule itself catches what it must
  for (const bad of ["You should buy NVDA", "TSLA will rise", "a great opportunity", "Hold it", "it looks undervalued", "a price target", "we expect more", `wait ${String.fromCharCode(0x2014)} now`])
    assert.notDeepEqual(wordingProblems(bad), [], bad);
  for (const ok of ["The holder decides.", "What I carry", "holdings"]) assert.deepEqual(wordingProblems(ok), [], ok);
});

test("footer carries the Stock Token sentence only with Stock Tokens", () => {
  assert.match(footer([{ sym: "NVDA", amount: 1 }]), /economic exposure only/);
  assert.doesNotMatch(footer([{ sym: "USDG", amount: 1 }, { sym: "ETH", amount: 1 }]), /economic exposure/);
});

test("market rows", () => {
  const r = marketRow("NVDA", pts((d) => 100 + d, SAT - 30 * 3600), SAT);
  assert.equal(r.paused, true);
  assert.equal(r.kind, "single stocks");
  assert.ok(r.d7 > 0 && r.swing > 0);
  assert.equal(marketRow("ETH", [], NOW).price, null);
});
