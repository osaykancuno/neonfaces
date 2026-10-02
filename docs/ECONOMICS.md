# Seed economics

## Baskets (`config/baskets.plan.json`)

Prices come from the Chainlink feeds on Robinhood Chain: `node tools/baskets.mjs --live` (USDG at face value). Current resolution (2026-09-25): TSLA $371.75, NVDA $224.44, AAPL $339.74, AMZN $249.94, MSFT $516.82, GOOGL $343.70, META $752.56, SPY $772.33, QQQ $745.36, GLD $392.87, SLV $58.28, cbBTC $83,754, SPCX $147.89 → `contracts/config/baskets.4663.json`. **Re-run on a trading day right before deploying.**

| Delivery | When | Faces | Baskets | Value |
|---|---|---|---|---|
| Base | at mint | every Face (5555) | $5 of one of TSLA / NVDA / AAPL / AMZN / MSFT, equal value so the draw can't be gamed | $5 |
| Watch top-up | after reveal | 833 | $10 of NVDA / GOOGL / META + $4 USDG | +$14 (total $19) |
| Heavy Stare top-up | after reveal | 278 | SPY $15, QQQ $11, NVDA $7, GLD (gold) $18, cbBTC (bitcoin) $12, SLV (silver) $7 | +$70 (total $75) |
| Set Bonus | first assembly of a set, once per set, in the transaction that moves the last piece in | ≤ 555 | SPCX, GOOGL, META, MSFT $3 each, into the anchor Face | $12 |

Why these numbers: a base that is visible in the wallet without weighing on the mint price; tickers everyone recognises, all with deep Uniswap pools (so holders and agents can trade them, checked with `node tools/rwa-scan.mjs`); the rarest tier holds a small multi-asset basket instead of one more ticker: about 47% equities (weighted toward the indexes, since NVDA is already inside SPY and QQQ and in the lower tiers), 36% precious metals and 17% bitcoin (oil was dropped on 2026-09-26: its pool sat 1.6% above its Chainlink price, so the vault could not buy it at a fair price); USDG in the Watch top-up so an agent has dry powder. cbBTC is bought straight from ETH (its liquidity is against WETH), everything else through USDG.

Full-supply pool ≈ **$65,557**: base ≈ $27,775 (delivered as Faces are minted), top-ups ≈ $31,122 (needed only at reveal, and only for Faces actually minted), set bonuses ≈ $6,660 (bought during the sale, one per 10 Faces minted; paid only for sets actually assembled; a partial sale deals proportionally fewer sets).

## Funding rule: the mint pays for its own seeds

There is no inventory before the sale. OpenSea keeps 10% of paid mints; `NeonPayout` sends 55% of the rest, i.e. **49.5% of what buyers pay**, to `NeonSeedVault`, which can only buy basket tokens (Uniswap v3 through NeonTrader, Chainlink-checked) straight into the seed pool. `tools/seed-keeper.mjs` runs it during the sale: it delivers the seeds still pending and keeps a small stock ahead, so most Faces are born seeded and the first ones get their basket minutes after mint.

Because tiers and sets come in fixed proportions, every Face costs the pool the same on average: ≈ $65,557 / 5555 ≈ **$11.80** (base basket now, its share of the top-ups at reveal and of the set bonuses). The 111 team Faces are free, so the 5444 paid Faces carry the whole pool: ≈ $12.04 each. So each paid Face must bring at least $12.04 / 0.495 ≈ **$24.3**, about **0.009 ETH** at ETH $2,687, and then the seeds are covered however many Faces sell. The lowest price of the sale (0.013 ETH, the list's) keeps ≈ 44% of margin: the seeds stay covered unless ETH falls below ≈ $1,870 between mint and purchase. Re-check this line with `baskets.mjs --live` and the ETH price before the deploy, and lower the top-ups if ETH has fallen. No free stage: keep free Faces to the 111 team Faces, minted at the end of the sale.

Stock Token prices only update on trading days (NeonTrader refuses prices older than 26 h): open the sale Tuesday–Thursday, so restocking never waits a weekend at the start (a sell-out on a weekend only delays the top-ups to Monday's prices).

## Sale plan (Thursday 2026-10-01, 18:00 UTC)

| OpenSea stage | Who | Time (UTC; Italy +2) | Price | Per wallet | Supply |
|---|---|---|---|---|---|
| 1. The list | 27,902 wallets from the snapshot of NFT holders (one NFT of a listed collection is enough) | Thursday 1 October 18:00 to Friday 2 October 18:00 | 0.013 ETH | 3 | 5444 |
| 2. Public | everyone | Friday 2 October 18:00, until the last Face sells or Saturday 31 October 18:00 | 0.013 ETH (lowered from 0.018 on 2 October) | 15 in total (Faces minted on the list count; raised from 5 on 2 October) | 5444 |
| Team | minted when the last Face sells, then the reveal the same day | | | | 111 |

Decided 2026-09-26: 24 hours reserved to the list, then the public at a higher price. The list is built from the 25 September snapshot (`config/allowlists/list.json`, git-ignored: which collections qualify is not published); OpenSea takes at most 30,000 wallets per presale stage and one presale stage at a time. A wallet sees whether it is on the list by connecting on OpenSea's drop page (the site's own check was removed on 30 Sep). 14:00 UTC is 16:00 in Italy and 10:00 in New York: stock markets are open, so the feeds are fresh and restocking never waits. SeaDrop counts every Face a wallet mints, across stages, against the stage's limit. The public stage has no end time: minting closes only with the reveal request, so the Stare tiers, the top-ups and the sets wait for the sell-out.

Every Face sells at 0.013 ETH since 2 October, so a sell-out means ≈ 70.8 ETH from buyers; OpenSea keeps ≈ 7.1 ETH; `NeonPayout` receives ≈ 63.7 ETH: seed vault 55% ≈ 35.0 ETH (≈ $94.1k at ETH $2,687), treasury 15% ≈ 9.55 ETH, team 15% ≈ 9.55 ETH (vested over 6 months), growth 15% ≈ 9.55 ETH. The baskets use ≈ 70% of the vault. The rest stays there as a reserve against price moves until the baskets are locked; then it can only go to the treasury. If only 2000 sold, the vault would hold ≈ 12.9 ETH (≈ $34.6k) against ≈ $24.9k of baskets for those 2000 Faces and the team's 111; at 0.013 the seeds are covered from ≈ 240 paid Faces upward: the floor rule above is what keeps a partial sale covered.

## What keeps running, and what costs money

- **Runs on its own, at no cost to anyone:** art and metadata (on-chain, the Gaze included), every Face account, seed retries, Stare top-ups and set bonuses (permissionless), the split, `NeonTrader` (no owner: it relies on Chainlink feeds and Uniswap pools, run by third parties), and the keeper, scheduled for free on GitHub Actions. If the team disappeared, every Face would still render, hold its tokens and trade through its agent.
- **Costs money:** the domain and static hosting (tens of dollars a year), contract deployment (≈ 0.01 ETH, the only cost before the sale), gas for the keeper and operations (cents; ≈ 0.01 ETH lasts years), an audit once the treasury can pay for it. The treasury's 15% (plus the vault's leftover reserve once the baskets are locked) covers them many times over.
- **Recurring income:** only resale royalties: 5% suggested on-chain and in OpenSea's settings, optional for sellers because transfers are never restricted. They go to the treasury Safe. There is no fee on holders' trades and no other revenue.
- **Not automatic:** new baskets or tickers, the site, the community. People do that, paid from the treasury and royalties, and no new basket is promised. What is committed is the process: if the treasury funds new baskets, it first asks the assembled sets (`NeonSetVotes`, one vote per set, advisory) and publishes the result next to its decision.

## What we never say

No "yield", no "returns", no "dividends", no price targets. The value inside a Face is whatever the Stock Tokens are worth, and the holder can withdraw it at any time.
