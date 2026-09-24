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

The seed vault receives 40% of every sale. To seed everything from proceeds alone, total mint revenue must be ≥ pool / 0.40 ≈ **$106k**. Below that, the treasury tops up. Base seeds for the free Builders mints (up to 1111 Faces ≈ $3.3k) are in the pool **before** the phase opens — a Face is never born empty. Top-ups are only needed after the reveal.

## Example sale plan (tune to market)

| Phase | Faces | Price | Revenue |
|---|---|---|---|
| Builders (allowlist, free) | ≤ 1111 | 0 | 0 |
| Allowlist | ≤ 2000 | 0.012 ETH | 24 ETH |
| Public | rest (≈ 2333) | 0.02 ETH | ≈ 46.7 ETH |

Seed vault receives 40% ≈ 28.3 ETH on a sell-out (≈ $76k at ETH $2,691): the baskets use ≈ 56% of it; the rest is a reserve against price moves and pending seeds, and can fund later holder-voted additions — never promised in advance.

## What we never say

No "yield", no "returns", no "dividends", no price targets. The value inside a Face is whatever the Stock Tokens are worth, and the holder can withdraw it at any time.
