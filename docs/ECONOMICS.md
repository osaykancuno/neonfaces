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

## Funding rule

The mint runs on OpenSea, which keeps 10% of paid mints (free mints pay no fee). The seed vault receives 40% of the rest, i.e. 36% of what buyers pay. To seed everything from proceeds alone, total mint revenue must be ≥ pool / 0.36 ≈ **$118k**. Below that, the treasury tops up. Base seeds for the team Faces and the free Builders stage (up to 1222 Faces ≈ $3.7k) are in the pool **before** they are minted — a Face is never born empty. Top-ups are only needed after the reveal.

## Example sale plan (tune to market)

| OpenSea stage | Faces | Price | Revenue |
|---|---|---|---|
| Team (not sold) | 111 | — | — |
| Builders (allowlist, free) | ≤ 1111 | 0 | 0 |
| Allowlist | ≤ 2000 | 0.012 ETH | 24 ETH |
| Public | rest (≈ 2333) | 0.02 ETH | ≈ 46.7 ETH |

On a sell-out buyers pay ≈ 70.7 ETH; OpenSea keeps ≈ 7.1 ETH; `NeonPayout` receives ≈ 63.6 ETH and the seed vault 40% of it, ≈ 25.4 ETH (≈ $68k at ETH $2,691): the baskets use ≈ 62% of it; the rest is a reserve against price moves and pending seeds, and can fund later holder-voted additions — never promised in advance.

## What keeps running, and what costs money

- **Runs on its own, at no cost to anyone:** art and metadata (on-chain), every Face account, seed retries and Stare top-ups (permissionless), the split, `NeonTrader` (no owner — it relies on Chainlink feeds and Uniswap pools, run by third parties). If the team disappeared, every Face would still render, hold its tokens and trade through its agent.
- **Costs money:** the static site and its domain (tens of dollars a year), the independent audit (once, before mainnet), gas for operations (cents). The treasury's 25% covers them many times over.
- **Recurring income:** only resale royalties — 5% suggested on-chain and in OpenSea's settings, optional for sellers because transfers are never restricted. They go to the treasury Safe. There is no fee on holders' trades and no other revenue.
- **Not automatic:** new baskets or tickers, the site, the community. People do that, paid from the treasury and royalties; nothing about it is promised.

## What we never say

No "yield", no "returns", no "dividends", no price targets. The value inside a Face is whatever the Stock Tokens are worth, and the holder can withdraw it at any time.
