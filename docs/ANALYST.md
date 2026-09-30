# What I see: a market read for every Face (design, after the launch)

Status: design, agreed direction on 30 Sep 2026, to build after the sale. No launch contract changes: everything
below reads the chain and runs in the web app and the MCP kit.

## The idea

Every Face already has its own wallet and can delegate one agent ([AGENTS.md](AGENTS.md)). "What I see" gives each
Face a second, read-only role: it watches what it holds and the markets behind it, and tells its holder in plain
words. **Facts, never advice.** It never says buy, sell, hold, should, could gain or expect; it never forecasts. The
holder reads, and the choice stays theirs.

It fits the collection's voice: the Faces are the watchers of a market that never closes. "They don't blink" becomes
something useful to the holder.

Reference point: Robinhood's own tools moved the same way. Cortex digests on Legend summarise price moves for a
portfolio, and Robinhood Agents (announced at HOOD Summit, 29 Sep 2026) let a customer's AI agent read the market
through Robinhood's Trading MCP. NEONFACES is not affiliated with Robinhood and does not plug into those products;
the parallel is only the approach: a clear digest of what you hold, with the decision left to you.

## What the Face reports

Everything comes from the chain: the Face account's balances and transfers, the Chainlink feeds NeonTrader trades on
(the same ones `web/src/value.js` already reads over 30 days), the Uniswap v3 pools NeonTrader routes through, and the
Face's journal (`web/src/journal.js`). No price API, no backend, no model that can invent numbers.

| Section | What it states | Source |
|---|---|---|
| Value | what the Face holds now, in USD, and what its basket was worth when it was delivered | balances, Chainlink rounds at the delivery block |
| Moves | each holding over 1, 7 and 30 days, in % and USD | Chainlink rounds |
| Swings | 30-day volatility of each holding and of the Face as a whole; largest drop from a 30-day high | daily Chainlink answers |
| Mix | how many assets, the largest share, asset classes (single stocks, index funds, metals, bitcoin, dollars) | balances + a fixed class table |
| Together | which holdings moved together over 30 days (correlation, in words: "moved together", "moved apart", "unrelated") | daily returns |
| Market status | whether each price is live or paused (weekend or holiday), and since when | feed `updatedAt` |
| Trading cost | pool fee and how much can be traded within 1% of the Chainlink price for each holding; the pool's gap to Chainlink now | QuoterV2, pool state |
| Activity | trades, strategies, agent, lock, top-ups and bonuses received, from the journal | events |

Each section ends with the time of its data. Missing or stale data is said as such, never filled in.

## How it reads

Sentences are built from templates filled with the numbers above, in the Face's own voice, for example:

- "I hold 0.0217 NVDA, worth $5.00. That is 0.1% below its value when it arrived on 1 Oct."
- "NVDA moved +3.1% in 7 days and swung more than the other assets I could hold."
- "All my value sits in one stock. A basket with more assets moves less on one company's news."
- "The stock price is paused since Friday 20:00 UTC: markets are closed. Trades wait until they reopen."

The third line is a description of concentration, not a recommendation. A wording rule list (a unit test) rejects
any template containing advice or forecast words (buy, sell, hold, should, recommend, will rise, will fall, target,
opportunity, undervalued, overvalued) and em dashes.

Every panel carries, once: "Facts from the chain, not advice. What you do with your Face is your choice." plus the
short Stock Token sentence when the Face holds Stock Tokens.

## Where it lives

1. **Face page, web app**: a "What I see" panel under the holdings, open to anyone (the chain is public), with
   the reads cached for a few minutes. Holders see their own Face's activity section first.
2. **Market watch page**: the same moves, swings and market status for every token a basket can hold, one screen.
3. **MCP kit** (`web/public/neonfaces-mcp.mjs`): two new read-only tools, `analysis` (one Face, the table above as
   JSON with timestamps) and `market` (every basket token). A holder can run it in the same AI client as other MCP
   servers they use (Claude, ChatGPT, others) and ask their own assistant questions about their Face. The tool
   descriptions say the data is factual and carries no recommendation; the kit itself never prepares a trade unless
   the holder asks through `prepare_action`, which already needs their confirmation on the site.
4. **llms.txt**: the same sections described for any assistant.

The analysis code is one module shared by the web app and the MCP kit (the kit stays a single file: the module is
bundled into it at build time).

## Why no language model in v1

A model writing the text can state a wrong number or slip into advice, needs a server and a paid key, and sends a
holder's data to a third party. Templates over chain data are exact, free, private and reviewable. Holders who want a
model's view can plug the MCP kit into their own assistant, where that choice is theirs. A model-written digest can be
reconsidered later, only with numbers passed in verbatim and the same wording rules checked on its output.

## The agent side stays as it is

"What I see" never trades and needs no permission on the account. Acting stays where it is today: the holder's own
buttons, action links confirmed on the site, or an agent the holder delegated, all through NeonTrader's on-chain
rules. A future option: strategies (Accumulate, Keep liquid, Trim) could show the same facts next to their settings.

## Plan

1. Module `web/src/analysis.js` with tests on fixed data (returns, volatility, drawdown, correlation, concentration,
   staleness) and the wording rule test.
2. Face page panel and Market watch page; phone and tablet layouts like the rest of the app.
3. MCP tools `analysis` and `market`; llms.txt.
4. Fork check on real feeds and pools; copy review against the content rules; then deploy the web app.

Order: after the sale, the reveal and First sight. Nothing here touches the launch contracts, the art or the baskets.
