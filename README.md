# NEONFACES — They don't blink.

5555 close-up faces on **Robinhood Chain** (chain id 4663). Every Face is an account.

- **Fully on-chain pixel art.** Each Face is a 20–40 block grid (~168 bytes, RLE) stored in contract bytecode (SSTORE2). `tokenURI` draws the SVG and writes the JSON on-chain. No IPFS, no server.
- **Minted on OpenSea.** The drop runs on OpenSea through SeaDrop; the token itself creates each Face's account and seed during that mint. The site presents the project and is where holders manage their Faces.
- **Every Face is a wallet.** An ERC-6551 Token Bound Account is created through the canonical registry *and funded* with a base basket of Stock Tokens in the mint transaction.
- **Stare tiers set at reveal**: a keyed on-chain permutation maps tokens to art; the art decides the tier (exactly 4444 Glance / 833 Watch / 278 Heavy Stare) and Watch / Heavy Stare Faces get a top-up. Nothing valuable is decided at mint, so it can't be sniped.
- **Unblinking**: an on-chain clock of how long each Face has stayed with its holder, shown in the metadata. Selling resets it.
- **Scoped agents**: holders delegate an agent in a plain-language wizard; it may only call what they allow, within an ETH budget — no signatures, expiring, void on sale. Trading goes through **NeonTrader**: Uniswap v3 on Robinhood Chain, output always back into the Face, price bounded by Chainlink, daily USD cap. See [docs/AGENTS.md](docs/AGENTS.md).
- **Lock before listing**: a holder can freeze the account until a date; the lock survives the sale, so buyers get exactly what they see.
- **Money said before, not after**: after OpenSea's 10% drop fee, SeaDrop can pay mint proceeds only to `NeonPayout` — a 40 / 25 / 20 / 15 split with no owner; team share vests over 6 months.

> Plain truth: NEONFACES does not sell shares or shareholder rights. It sells an artwork that can hold on-chain exposure. Stock Tokens give economic exposure only and are not available to US persons.

## Repository

| Path | What |
|---|---|
| `art/` | Procedural renderer + collection generator (Python). Produces the on-chain records, provenance, previews. |
| `contracts/` | Foundry project: `NeonFaces` (ERC-721, SeaDrop-compatible), `NeonPayout` (proceeds split), `NeonSeeder`, `NeonFaceAccount` (ERC-6551), `NeonArt` (SSTORE2), `NeonRenderer` (SVG/JSON), `NeonTrader` (agent trading guard). Tests, deploy + upload + rehearsal scripts. |
| `tools/` | Node ops tools: live-priced baskets, NFT-holder snapshots, OpenSea Studio allowlist CSVs, Safe batches, reveal watcher, top-ups, agent presets, trading agent, on-chain verifier, site export. |
| `web/` | The site (Vite + viem, static). Draws Faces from the on-chain bytes with a byte-identical JS port of the renderer. Links to the OpenSea drop; Face pages with the holder panel (withdraw, lock, agents). |
| `config/` | Seed basket plan, verified trading config (Uniswap + Chainlink addresses), allowlist sources. |
| `brand/` | Logo (`logo.gif`) and banner (`banner.gif`, `banner.png` for headers that don't animate), drawn from the on-chain art by `art/export_brand.py`. |
| `docs/` | Lore, architecture, agents, launch runbook, security review, economics, traits. |

## Quick start

Requirements: Foundry, Node ≥ 20, Python ≥ 3.11 with `numpy pillow pycryptodome`.

```bash
# 1. art: generate the 5555 Faces (≈9 min) and the site assets
cd art && python generate.py && python export_site.py && python export_brand.py && cd ..   # brand: icons, link preview, logo, banner

# 2. contracts: build + test (71 tests incl. mints through OpenSea's real SeaDrop bytecode, anti-sniping,
#    full-supply permutation, byte-exact SVG, agents, lock)
cd contracts && forge test && cd ..

# 3. mainnet-fork tests: real SeaDrop, real Stock Tokens, real Uniswap v3 pools, real Chainlink feeds
cd contracts && ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-path "test/*Fork*" -vv && cd ..

# 4. full local rehearsal: deploy, upload + seal the art, SeaDrop stage, 20 mints through SeaDrop, reveal
anvil --chain-id 46630 &
cd contracts && RPC=http://127.0.0.1:8545 PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 ./script/rehearsal.sh && cd ..

# 5. site
cd tools && npm install && cd ../web && npm install && npm run dev
```

The site runs in **preview mode** (art + lore only) until `web/public/deployment.json` exists (`node tools/export-web.mjs <chainId>`).

Launching for real: follow [docs/LAUNCH-RUNBOOK.md](docs/LAUNCH-RUNBOOK.md) — testnet rehearsal first.

## Verified facts this build relies on (checked on-chain, 2026-09-24/25)

- OpenSea supports Robinhood Chain (chain slug `robinhood`). OpenSea's SeaDrop `0x00005EA00Ac477B1030CE78506496e8C2dE24bf5` is deployed on mainnet and testnet; its bytecode equals Ethereum's except the chain-id immutables. Drops take a 10% fee on primary sales.

- Canonical ERC-6551 registry `0x000000006551c19487814612e58FE06813775758` is deployed on Robinhood Chain mainnet and testnet; its codehash equals Ethereum mainnet's.
- Safe v1.4.1 (SafeL2, ProxyFactory) is deployed on mainnet and testnet.
- Stock Tokens (TSLA, AAPL, NVDA, AMZN, MSFT, GOOGL, META, MSTR, SPY, QCOM) are 18-decimals ERC-20s; USDG is 6 decimals — addresses in `config/baskets.plan.json`.
- A mainnet-fork test transfers **real** TSLA/NVDA/SPY/USDG into a freshly created Face account at mint and back out by the holder: Stock Tokens are not blocked from TBAs.
- ArbSys (`0x64`) exposes `arbBlockNumber` / `arbBlockHash`; gas ≈ 0.044 gwei, L1 data fee ≈ 0. Storing the whole art set (0.94 MB) costs ≈ 0.01 ETH.
- Uniswap v2/v3/v4 are live (addresses from the official Uniswap registry, in `config/trader.4663.json`); every basket ticker has a v3 pool against USDG with $185k–$3.5M liquidity; WETH/USDG 0.01% ≈ $10.9M.
- Chainlink publishes a feed per Stock Token (8 decimals, 24 h heartbeat, 24/5 market hours); no L2 sequencer-uptime feed is published.
