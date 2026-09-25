# Seed economics

## Baskets (`config/baskets.plan.json`)

Prices come from the Chainlink feeds on Robinhood Chain: `node tools/baskets.mjs --live` (USDG at face value). Current resolution (2026-09-24): TSLA $378.34, NVDA $224.41, AAPL $336.31, AMZN $248.78, MSFT $497.99, GOOGL $341.92, META $778.25, SPY $766.70 → `contracts/config/baskets.4663.json`. **Re-run on a trading day right before deploying.**

| Delivery | When | Faces | Baskets | Value |
|---|---|---|---|---|
| Base | at mint | every Face (5555) | $3 of one of TSLA / NVDA / AAPL / AMZN / MSFT — equal value, so the draw can't be gamed | $3 |
| Watch top-up | after reveal | 833 | $9 of NVDA / GOOGL / META + $3 USDG | +$12 (total $15) |
| Heavy Stare top-up | after reveal | 278 | SPY $25 + NVDA $12 + TSLA $12 + USDG $8 | +$57 (total $60) |

Why these numbers: a base that is visible in the wallet without weighing on the mint price; tickers everyone recognises, all with deep Uniswap pools (so holders and agents can trade them); SPY as the "index" anchor of the rarest tier; some USDG in upper tiers so an agent has dry powder.

Full-supply pool ≈ **$42,507**: base ≈ $16,665 (delivered as Faces are minted — pre-fund in steps), top-ups ≈ $25,842 (needed only at reveal, and only for Faces actually minted).

## Funding rule: the mint pays for its own seeds

There is no inventory before the sale. OpenSea keeps 10% of paid mints; `NeonPayout` sends 40% of the rest, i.e. **36% of what buyers pay**, to `NeonSeedVault`, which can only buy basket tokens (Uniswap v3 through NeonTrader, Chainlink-checked) straight into the seed pool. `tools/seed-keeper.mjs` runs it during the sale: it delivers the seeds still pending and keeps a small stock ahead, so most Faces are born seeded and the first ones get their basket minutes after mint.

Because tiers come in fixed proportions, every Face costs the pool the same on average: ≈ $42,507 / 5555 ≈ **$7.65** (base basket now, its share of the top-ups at reveal). So each paid Face must bring at least $7.65 / 0.36 ≈ **$21.3**, about **0.008 ETH** at ETH $2,691, and then the seeds are covered however many Faces sell. Use **≥ 0.01 ETH** everywhere for a margin against ETH moving between mint and purchase. Free Faces are paid by the others: keep them to the 111 team Faces, minted at the end of the sale.

Stock Token prices only update on trading days (NeonTrader refuses prices older than 26 h): open the sale Tuesday–Thursday, so restocking never waits a weekend.

## Example sale plan (tune to market)

| OpenSea stage | Who | Faces | Price | Revenue |
|---|---|---|---|---|
| 1. Robinhood Chain | holders of Robinhood Chain collections | ≤ 1500 | 0.01 ETH | 15 ETH |
| 2. Partners | holders of partner collections on other chains | ≤ 2000 | 0.012 ETH | 24 ETH |
| 3. Public | everyone | rest (≈ 1944) | 0.02 ETH | ≈ 38.9 ETH |
| Team | minted after the sale, before the reveal | 111 | — | — |

On a sell-out buyers pay ≈ 77.9 ETH; OpenSea keeps ≈ 7.8 ETH; `NeonPayout` receives ≈ 70.1 ETH and the seed vault 40% of it, ≈ 28 ETH (≈ $75k at ETH $2,691): the baskets use ≈ 57% of it. The rest stays in the vault as a reserve against price moves until the baskets are locked; then it can only go to the treasury.

## What keeps running, and what costs money

- **Runs on its own, at no cost to anyone:** art and metadata (on-chain), every Face account, seed retries and Stare top-ups (permissionless), the split, `NeonTrader` (no owner — it relies on Chainlink feeds and Uniswap pools, run by third parties). If the team disappeared, every Face would still render, hold its tokens and trade through its agent.
- **Costs money:** the domain and static hosting (tens of dollars a year), contract deployment (≈ 0.03 ETH, the only cost before the sale), gas for the keeper and operations (cents), an audit once the treasury can pay for it. The treasury's 25% covers them many times over.
- **Recurring income:** only resale royalties — 5% suggested on-chain and in OpenSea's settings, optional for sellers because transfers are never restricted. They go to the treasury Safe. There is no fee on holders' trades and no other revenue.
- **Not automatic:** new baskets or tickers, the site, the community. People do that, paid from the treasury and royalties; nothing about it is promised.

## What we never say

No "yield", no "returns", no "dividends", no price targets. The value inside a Face is whatever the Stock Tokens are worth, and the holder can withdraw it at any time.
