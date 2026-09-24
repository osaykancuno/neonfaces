# NEONFACES — They don't blink.

5555 close-up faces on **Robinhood Chain** (chain id 4663). Every Face is an account.

- **Fully on-chain pixel art.** Each Face is a 20–40 block grid (~168 bytes, RLE) stored in contract bytecode (SSTORE2). `tokenURI` draws the SVG and writes the JSON on-chain. No IPFS, no server.
- **Every Face is a wallet.** An ERC-6551 Token Bound Account is created through the canonical registry *and funded* with a base basket of Stock Tokens in the mint transaction.
- **Stare tiers set at reveal**: a keyed on-chain permutation maps tokens to art; the art decides the tier (exactly 4444 Glance / 833 Watch / 278 Heavy Stare) and Watch / Heavy Stare Faces get a top-up. Nothing valuable is decided at mint, so it can't be sniped.
- **Unblinking**: an on-chain clock of how long each Face has stayed with its holder, shown in the metadata. Selling resets it.
- **Scoped agents**: holders delegate an agent that may only call the (contract, function) pairs they allow, within an ETH budget — no signatures, expiring, void on sale. See [docs/AGENTS.md](docs/AGENTS.md).
- **Lock before listing**: a holder can freeze the account until a date; the lock survives the sale, so buyers get exactly what they see.
- **Money said before, not after**: 40 / 25 / 20 / 15 split hard-coded in the minter; team share vests over 6 months.

> Plain truth: NEONFACES does not sell shares or shareholder rights. It sells an artwork that can hold on-chain exposure. Stock Tokens give economic exposure only and are not available to US persons.

## Repository

| Path | What |
|---|---|
| `art/` | Procedural renderer + collection generator (Python). Produces the on-chain records, provenance, previews. |
| `contracts/` | Foundry project: `NeonFaces` (ERC-721), `NeonMinter`, `NeonSeeder`, `NeonFaceAccount` (ERC-6551), `NeonArt` (SSTORE2), `NeonRenderer` (SVG/JSON). Tests, deploy + upload + rehearsal scripts. |
| `tools/` | Node ops tools: baskets, allowlists (Merkle), Safe batches, reveal watcher, top-ups, reference agent, on-chain verifier, site export. |
| `web/` | The site (Vite + viem, static). Draws Faces from the on-chain bytes with a byte-identical JS port of the renderer. Mint, Face pages. |
| `config/` | Seed basket plan (verified Stock Token addresses), allowlist CSVs. |
| `docs/` | Lore, architecture, agents, launch runbook, security review, economics, traits. |

## Quick start

Requirements: Foundry, Node ≥ 20, Python ≥ 3.11 with `numpy pillow pycryptodome`.

```bash
# 1. art: generate the 5555 Faces (≈9 min) and the site assets
cd art && python generate.py && python export_site.py && cd ..

# 2. contracts: build + test (60 tests incl. anti-sniping, full-supply permutation, byte-exact SVG, agents, lock)
cd contracts && forge test && cd ..

# 3. optional: fork test against REAL Stock Tokens on Robinhood Chain mainnet
cd contracts && ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-contract ForkTest -vv && cd ..

# 4. full local rehearsal: deploy, upload + seal the art, phases, 20 mints, reveal
anvil --chain-id 46630 &
cd contracts && RPC=http://127.0.0.1:8545 PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 ./script/rehearsal.sh && cd ..

# 5. site
cd tools && npm install && cd ../web && npm install && npm run dev
```

The site runs in **preview mode** (art + lore, mint disabled) until `web/public/deployment.json` exists (`node tools/export-web.mjs <chainId>`).

Launching for real: follow [docs/LAUNCH-RUNBOOK.md](docs/LAUNCH-RUNBOOK.md) — testnet rehearsal first.

## Verified facts this build relies on (checked on-chain, 2026-09-24)

- Canonical ERC-6551 registry `0x000000006551c19487814612e58FE06813775758` is deployed on Robinhood Chain mainnet and testnet; its codehash equals Ethereum mainnet's.
- Safe v1.4.1 (SafeL2, ProxyFactory) is deployed on mainnet and testnet.
- Stock Tokens (TSLA, AAPL, NVDA, AMZN, MSFT, GOOGL, META, MSTR, SPY, QCOM) are 18-decimals ERC-20s; USDG is 6 decimals — addresses in `config/baskets.plan.json`.
- A mainnet-fork test transfers **real** TSLA/NVDA/SPY/USDG into a freshly created Face account at mint and back out by the holder: Stock Tokens are not blocked from TBAs.
- ArbSys (`0x64`) exposes `arbBlockNumber` / `arbBlockHash`; gas ≈ 0.044 gwei, L1 data fee ≈ 0. Storing the whole art set (0.94 MB) costs ≈ 0.01 ETH.
