# Seed economics

## Baskets (`config/baskets.plan.json`)

Prices come from the Chainlink feeds on Robinhood Chain: `node tools/baskets.mjs --live` (USDG at face value). Current resolution (2026-09-25): TSLA $373.64, NVDA $225.60, AAPL $339.74, AMZN $249.94, MSFT $516.82, GOOGL $343.70, META $748.67, SPY $772.33, QQQ $745.36, GLD $392.87, SLV $58.28, USO $148.65, cbBTC $83,754, SPCX $147.89 → `contracts/config/baskets.4663.json`. **Re-run on a trading day right before deploying.**

| Delivery | When | Faces | Baskets | Value |
|---|---|---|---|---|
| Base | at mint | every Face (5555) | $3 of one of TSLA / NVDA / AAPL / AMZN / MSFT — equal value, so the draw can't be gamed | $3 |
| Watch top-up | after reveal | 833 | $9 of NVDA / GOOGL / META + $3 USDG | +$12 (total $15) |
| Heavy Stare top-up | after reveal | 278 | SPY $12, QQQ $8, NVDA $6, GLD (gold) $10, cbBTC (bitcoin) $10, SLV (silver) $6, USO (oil) $5 | +$57 (total $60) |
| Set bonus | first assembly of a set, once per set | ≤ 555 | SPCX, GOOGL, META, MSFT $2.50 each, into the anchor Face | $10 |

Why these numbers: a base that is visible in the wallet without weighing on the mint price; tickers everyone recognises, all with deep Uniswap pools (so holders and agents can trade them, checked with `node tools/rwa-scan.mjs`); the rarest tier holds a small multi-asset basket instead of one more ticker: about 46% equities (weighted toward the indexes, since NVDA is already inside SPY and QQQ and in the lower tiers), 28% precious metals, 18% bitcoin and 9% oil (the smallest leg: USO holds futures and loses value when it rolls them, a cost that adds up in a Face kept for years); USDG in the Watch top-up so an agent has dry powder. cbBTC is bought straight from ETH (its liquidity is against WETH), everything else through USDG.

Full-supply pool ≈ **$48,057**: base ≈ $16,665 (delivered as Faces are minted), top-ups ≈ $25,842 (needed only at reveal, and only for Faces actually minted), set bonuses ≈ $5,550 (only for sets actually assembled; a partial sale deals proportionally fewer sets).

## Funding rule: the mint pays for its own seeds

There is no inventory before the sale. OpenSea keeps 10% of paid mints; `NeonPayout` sends 40% of the rest, i.e. **36% of what buyers pay**, to `NeonSeedVault`, which can only buy basket tokens (Uniswap v3 through NeonTrader, Chainlink-checked) straight into the seed pool. `tools/seed-keeper.mjs` runs it during the sale: it delivers the seeds still pending and keeps a small stock ahead, so most Faces are born seeded and the first ones get their basket minutes after mint.

Because tiers and sets come in fixed proportions, every Face costs the pool the same on average: ≈ $48,057 / 5555 ≈ **$8.65** (base basket now, its share of the top-ups at reveal and of the set bonuses). So each paid Face must bring at least $8.65 / 0.36 ≈ **$24.0**, about **0.009 ETH** at ETH $2,691, and then the seeds are covered however many Faces sell. Use **≥ 0.01 ETH** everywhere for a margin against ETH moving between mint and purchase. Free Faces are paid by the others: keep them to the 111 team Faces, minted at the end of the sale.

Stock Token prices only update on trading days (NeonTrader refuses prices older than 26 h): open the sale Tuesday–Thursday, so restocking never waits a weekend.

## Example sale plan (tune to market)

| OpenSea stage | Who | Faces | Price | Revenue |
|---|---|---|---|---|
| 1. Robinhood Chain | holders of Robinhood Chain collections | ≤ 1500 | 0.01 ETH | 15 ETH |
| 2. Partners | holders of partner collections on other chains | ≤ 2000 | 0.012 ETH | 24 ETH |
| 3. Public | everyone | rest (≈ 1944) | 0.02 ETH | ≈ 38.9 ETH |
| Team | minted after the sale, before the reveal | 111 | — | — |

On a sell-out buyers pay ≈ 77.9 ETH; OpenSea keeps ≈ 7.8 ETH; `NeonPayout` receives ≈ 70.1 ETH and the seed vault 40% of it, ≈ 28 ETH (≈ $75k at ETH $2,691): the baskets use ≈ 64% of it. The rest stays in the vault as a reserve against price moves until the baskets are locked; then it can only go to the treasury.

## What keeps running, and what costs money

- **Runs on its own, at no cost to anyone:** art and metadata (on-chain, the Gaze included), every Face account, seed retries, Stare top-ups and set bonuses (permissionless), the split, `NeonTrader` (no owner — it relies on Chainlink feeds and Uniswap pools, run by third parties), and the keeper, scheduled for free on GitHub Actions. If the team disappeared, every Face would still render, hold its tokens and trade through its agent.
- **Costs money:** the domain and static hosting (tens of dollars a year), contract deployment (≈ 0.03 ETH, the only cost before the sale), gas for the keeper and operations (cents; ≈ 0.01 ETH lasts years), an audit once the treasury can pay for it. The treasury's 25% covers them many times over.
- **Recurring income:** only resale royalties — 5% suggested on-chain and in OpenSea's settings, optional for sellers because transfers are never restricted. They go to the treasury Safe. There is no fee on holders' trades and no other revenue.
- **Not automatic:** new baskets or tickers, the site, the community. People do that, paid from the treasury and royalties; nothing about it is promised.

## What we never say

No "yield", no "returns", no "dividends", no price targets. The value inside a Face is whatever the Stock Tokens are worth, and the holder can withdraw it at any time.
