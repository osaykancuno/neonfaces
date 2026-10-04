# Seed economics

## Baskets (`config/baskets.plan.json`)

Prices come from the Chainlink feeds on Robinhood Chain: `node tools/baskets.mjs --live` (USDG at face value). The base baskets were priced at deploy (28 September: TSLA $371.75, NVDA $224.44, AAPL $339.74, AMZN $249.94, MSFT $516.82); the top-ups and the set bonus with the closing prices of 2 October (NVDA $235.00, GOOGL $343.66, META $730.13, SPY $770.71, QQQ $752.00, GLD $380.43, SLV $54.67, cbBTC $84,573, SPCX $158.73, MSFT $517.51) → `contracts/config/baskets.4663.json`, set on-chain by the Safe. A basket some Faces already received never changes.

| Delivery | When | Faces | Baskets | Value |
|---|---|---|---|---|
| Base | at mint | every Face (5555) | $5 of one of TSLA / NVDA / AAPL / AMZN / MSFT, equal value so the draw can't be gamed | $5 |
| Watch top-up | after reveal | 833 | $4 of NVDA / GOOGL / META + $1 USDG | +$5 (total $10) |
| Heavy Stare top-up | after reveal | 278 | SPY $2, QQQ $1.50, NVDA $1, GLD (gold) $2.50, cbBTC (bitcoin) $2, SLV (silver) $1 | +$10 (total $15) |
| Set Bonus | first assembly of a set, once per set, in the transaction that moves the last piece in | ≤ 555 | SPCX, GOOGL, META, MSFT $1.25 each, into the anchor Face | $5 |

Why these numbers: a base that is visible in the wallet without weighing on the mint price; tickers everyone recognises, all with deep Uniswap pools (so holders and agents can trade them, checked with `node tools/rwa-scan.mjs`); the rarest tier holds a small multi-asset basket instead of one more ticker: about 47% equities (weighted toward the indexes, since NVDA is already inside SPY and QQQ and in the lower tiers), 36% precious metals and 17% bitcoin (oil was dropped on 2026-09-26: its pool sat 1.6% above its Chainlink price, so the vault could not buy it at a fair price); USDG in the Watch top-up so an agent has dry powder. cbBTC is bought straight from ETH (its liquidity is against WETH), everything else through USDG.

Full-supply pool ≈ **$37,495**: base ≈ $27,775 (delivered as Faces are minted), top-ups ≈ $6,945 (needed only at reveal, and only for Faces actually minted), set bonuses ≈ $2,775 (bought during the sale, one per 10 Faces minted; paid only for sets actually assembled; a partial sale deals proportionally fewer sets).

## Funding rule: the mint pays for its own seeds

There is no inventory before the sale. OpenSea keeps 10% of paid mints; `NeonPayout` sends 55% of the rest, i.e. **49.5% of what buyers pay**, to `NeonSeedVault`, which can only buy basket tokens (Uniswap v3 through NeonTrader, Chainlink-checked) straight into the seed pool. `tools/seed-keeper.mjs` runs it during the sale: it delivers the seeds still pending and keeps a small stock ahead, so most Faces are born seeded and the first ones get their basket minutes after mint.

Because tiers and sets come in fixed proportions, every Face costs the pool the same on average: ≈ $37,495 / 5555 ≈ **$6.75** (base basket now, its share of the top-ups at reveal and of the set bonuses). The 111 team Faces are free, so the 5444 paid Faces carry the whole pool: ≈ $6.89 each. So each paid Face must bring at least $6.89 / 0.495 ≈ **$13.9**, about **0.0052 ETH** at ETH $2,684. The NEONLIST's 0.004 ETH brings ≈ $5.31 (≈ $1.57 short at that ETH price, covered by the vault alone only above ETH ≈ $3,480). **The treasury and growth cover what the NEONLIST leaves short** (a written commitment): each NEONLIST Face also brings them ≈ $1.45 each, ≈ $2.90 together, about twice the gap at ETH $2,684; if ETH falls, the gap grows and they cover it from what they already hold. Re-check this line with `baskets.mjs --live` and the ETH price before changing a price. No free stage: keep free Faces to the 111 team Faces, minted at the end of the sale (fewer of them if the sale stays small, so the paid Faces never carry more than their share).

Stock Token prices only update on trading days (NeonTrader refuses prices older than 26 h): open the sale Tuesday–Thursday, so restocking never waits a weekend at the start (a sell-out on a weekend only delays the top-ups to Monday's prices).

## Sale plan

| SeaDrop stage | Who | Time (UTC; Italy +2) | Price | Per wallet | Supply |
|---|---|---|---|---|---|
| NEONLIST | chosen wallets of the communities that support the collection | Tuesday 13 October 13:00 until the last Face sells or Saturday 31 October 18:00 | 0.004 ETH | 15 in total | 5444 |
| Team | 36 to the first buyers, one more Face for each Face they bought, twice; the other 75 minted when the sale ends, then the reveal the same day | | | | 111 |

The NEONLIST is how NEONFACES mints (the founder, 4 Oct): SeaDrop's allowlist stage, built with `tools/seadrop-drop.mjs` (its terms live in the Merkle leaves; SeaDrop holds one list at a time). neonfaces.xyz offers no other stage: before the NEONLIST opens, the mint panel shows its date and terms and, once its wallets are set, tells a connected wallet whether it is on it; then it mints for wallets on it. A wallet on the NEONLIST can also send the same `mintAllowList` call from the explorer, with the values the panel shows it. SeaDrop's public stage (0.009 ETH, set on 2 October) stays configured on-chain until 31 October, but the site no longer offers it. SeaDrop counts every Face a wallet mints against one limit of 15. The sale ends with the last Face or on 31 October; minting closes only with the reveal request, so the Stare tiers, the top-ups and the sets wait for the end of the sale.

The top-ups are bought after the reveal, so if the vault falls short then, **the treasury and growth top up the seed vault** so every Watch and Heavy Stare basket and every set bonus is delivered (a written commitment). After the sale the vault keeps what it holds beyond the baskets as a reserve against price moves until the baskets are locked; then it can only go to the treasury.

## What keeps running, and what costs money

- **Runs on its own, at no cost to anyone:** art and metadata (on-chain, the Gaze included), every Face account, seed retries, Stare top-ups and set bonuses (permissionless), the split, `NeonTrader` (no owner: it relies on Chainlink feeds and Uniswap pools, run by third parties), and the keeper, scheduled for free on GitHub Actions. If the team disappeared, every Face would still render, hold its tokens and trade through its agent.
- **Costs money:** the domain and static hosting (tens of dollars a year), contract deployment (≈ 0.01 ETH, the only cost before the sale), gas for the keeper and operations (cents; ≈ 0.01 ETH lasts years), an audit once the treasury can pay for it. The treasury's 15% (plus the vault's leftover reserve once the baskets are locked) covers them many times over.
- **Recurring income:** only resale royalties: 5% suggested on-chain and in OpenSea's settings, optional for sellers because transfers are never restricted. They go to the treasury Safe. There is no fee on holders' trades and no other revenue.
- **Not automatic:** new baskets or tickers, the site, the community. People do that, paid from the treasury and royalties, and no new basket is promised. What is committed is the process: if the treasury funds new baskets, it first asks the assembled sets (`NeonSetVotes`, one vote per set, advisory) and publishes the result next to its decision.

## What we never say

No "yield", no "returns", no "dividends", no price targets. The value inside a Face is whatever the Stock Tokens are worth, and the holder can withdraw it at any time.
