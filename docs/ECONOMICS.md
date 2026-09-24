# Seed economics

## Default baskets (`config/baskets.plan.json`, USD targets)

| Delivery | When | Faces | Baskets | ≈ value |
|---|---|---|---|---|
| Base | at mint | every Face (5555) | one ticker: TSLA / NVDA / AAPL / AMZN / MSFT — keep them equal in value | $1 |
| Watch top-up | after reveal | 833 | NVDA / GOOGL / META ($3) + $1 USDG | +$4 (total $5) |
| Heavy Stare top-up | after reveal | 278 | SPY $8 + NVDA $4 + TSLA $4 + USDG $3 | +$19 (total $20) |

Full-supply pool: 5555 × 1 + 833 × 4 + 278 × 19 ≈ **$14,169** (≈ $2.55 per Face on average).
`node tools/baskets.mjs` recomputes token amounts and the exact per-token budget from live prices you enter.

## Funding rule

The seed vault receives 40% of every sale. To seed everything from proceeds alone, total mint revenue must be ≥ pool / 0.40 ≈ **$35.4k**. Below that, the treasury tops up. Base seeds for the free Builders mints (up to 1111 Faces ≈ $1.1k) are in the pool **before** the phase opens — a Face is never born empty. Top-ups (≈ $8.6k) are only needed after the reveal.

## Example sale plan (tune to market)

| Phase | Faces | Price | Revenue |
|---|---|---|---|
| Builders (allowlist, free) | ≤ 1111 | 0 | 0 |
| Allowlist | ≤ 2000 | 0.012 ETH | 24 ETH |
| Public | rest (≈ 2333) | 0.02 ETH | ≈ 46.7 ETH |

Seed vault receives 40% ≈ 28.3 ETH on a sell-out, above the ≈ $14k pool at any ETH price over ~$500 — the surplus can deepen baskets for later milestones (holder votes on which tickers join the pool) instead of promising anything.

## What we never say

No "yield", no "returns", no "dividends", no price targets. The value inside a Face is whatever the Stock Tokens are worth, and the holder can withdraw it at any time.
