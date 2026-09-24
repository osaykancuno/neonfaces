# Seed economics

## Default baskets (`config/baskets.plan.json`, USD targets)

| Tier | Faces | Baskets (drawn uniformly) | ≈ value per Face |
|---|---|---|---|
| Glance (80%) | 4444 | one ticker: TSLA / NVDA / AAPL / AMZN / MSFT | $1 |
| Watch (15%) | 833 | a ticker + USDG: NVDA / GOOGL / META ($4) + $1 USDG | $5 |
| Heavy Stare (5%) | 278 | SPY $8 + NVDA $5 + TSLA $4 + USDG $3 | $20 |

Full-supply pool: 4444 × 1 + 833 × 5 + 278 × 20 ≈ **$14,169** (≈ $2.55 per Face on average).
`node tools/baskets.mjs` recomputes token amounts and the exact per-token budget from live prices you enter.

## Funding rule

The seed vault receives 40% of every sale. To seed everything from proceeds alone, total mint revenue must be ≥ pool / 0.40 ≈ **$35.4k**. Below that, the treasury tops up. Free Builders mints (up to 1111 Faces ≈ $2.8k of seeds) are funded **before** the phase opens — a Face is never born empty.

## Example sale plan (tune to market)

| Phase | Faces | Price | Revenue |
|---|---|---|---|
| Builders (allowlist, free) | ≤ 1111 | 0 | 0 |
| Allowlist | ≤ 2000 | 0.012 ETH | 24 ETH |
| Public | rest (≈ 2333) | 0.02 ETH | ≈ 46.7 ETH |

Seed vault receives 40% ≈ 28.3 ETH on a sell-out, above the ≈ $14k pool at any ETH price over ~$500 — the surplus can deepen baskets for later milestones (holder votes on which tickers join the pool) instead of promising anything.

## What we never say

No "yield", no "returns", no "dividends", no price targets. The value inside a Face is whatever the Stock Tokens are worth, and the holder can withdraw it at any time.
