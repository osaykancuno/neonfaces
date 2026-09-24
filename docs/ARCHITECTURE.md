# Architecture

```
                 ┌──────────────┐ mint(qty, allowance, proof)  ┌───────────────┐
 holder ───────▶ │  NeonMinter  │ ───────────────────────────▶ │   NeonFaces   │ ERC-721 + 2981 + 4906
                 │ phases, AL,  │                              │ caps in code  │ provenance, reveal,
                 │ 40/25/20/15  │ activate(id) ─┐              │ Unblinking    │ mint closes at reveal
                 └──────────────┘               ▼              └──────┬────────┘
                                         ┌──────────────┐             │ tokenURI / contractURI
   canonical ERC-6551 registry ◀──────── │  NeonSeeder  │             ▼
   createAccount(impl, 0, chain, NFT, id)│ base seeds,  │      ┌──────────────┐   artData(artId)   ┌──────────┐
                 │                       │ reveal perm, │◀──── │ NeonRenderer │ ─────────────────▶ │ NeonArt  │
                 ▼                       │ top-ups      │ seed │ SVG + JSON   │                    │ SSTORE2  │
        ┌──────────────────┐   Stock     └──────┬───────┘ Of() └──────────────┘                    │ sealed   │
        │ NeonFaceAccount  │ ◀──────────────────┘                                                  └──────────┘
        │ (TBA per Face)   │  execute (holder) · executeAsAgent (scoped agent) · lock
        └──────────────────┘
```

## Contracts

| Contract | Role | Admin powers | Cannot |
|---|---|---|---|
| `NeonFaces` | ERC-721 "NEONFACES"/"NEON", ids 1..5555, "Unblinking" clock | set renderer / fallback URIs until frozen, royalty receiver (≤5%), team mint (≤111), pause **minting**, set provenance once, request reveal | exceed 5555 / 111, mint without provenance, mint after the reveal request, pause transfers, blocklist, upgrade, change art |
| `NeonMinter` | sale phases, Merkle allowlists (allowance in leaf), wallet caps, phase caps, proceeds split | configure phases, switch phase (Finished is terminal) | change split shares or payees |
| `NeonSeeder` | creates the TBA, delivers base seeds at mint, maps tokens to art at reveal, delivers tier top-ups | configure baskets until `lockConfig()`, withdraw unused pool | touch tokens already in Face accounts, influence tiers |
| `NeonFaceAccount` | ERC-6551 account (Solady base), immutable | — (only the Face holder) | be upgraded; agents can't sign, exceed their calls or ETH budget, act while locked, or survive a sale |
| `NeonArt` | 174 SSTORE2 chunks of 32 records, running keccak | add chunks / reset **until sealed** | change anything after `seal()` (permissionless, requires provenance match) |
| `NeonRenderer` | builds SVG + JSON on-chain; "Holds" lists seed tokens plus tradable tokens the Face holds | none (no owner) | — |
| `NeonTrader` | the only trading door for agents: Uniswap v3 SwapRouter02, output to the caller, Chainlink-bounded price, daily USD cap per account | none (no owner, no upgrade) | pay anyone but the caller, trade unlisted tokens, use stale prices |

Admin roles sit behind `AccessControlDefaultAdminRules` (2-step transfer, 2-day delay on NeonFaces / Seeder / Minter).

## Lifecycle of a Face

**Mint (one transaction).** `NeonMinter.mint` checks phase, exact price, Merkle proof `(address, allowance)`, wallet and phase caps → `NeonFaces.mint` (requires provenance, mint not closed) → for each id `NeonSeeder.activate`: `registry.createAccount(impl, 0, chainid, NeonFaces, id)` (idempotent) and a `try` delivery of a **base basket** (all base baskets have equal target value). If the pool is short or a token refuses, the seed is pending and anyone can `fund(id)` later — the mint never fails for seeding reasons. Nothing valuable is decided inside the mint transaction.

**Reveal.** `requestReveal()` closes minting forever and sets `revealBlock = L2 block + 5`. Anyone calls `reveal()` while that block's hash is readable (256 blocks ≈ 25 s at 100 ms; `tools/reveal-watch.mjs`). `revealSeed = keccak(arbBlockHash(revealBlock), provenance, address)`. A new request is only possible once the window has passed; requests are counted.

**Mapping.** `artIdOf(id) = (a · (id − 1) + b) mod 5555` with `(a, b)` from the seed and `a` coprime to 5555 = 5·11·101 — a bijection anyone can recompute. Art ids `[0, 4444)` are Glance, `[4444, 5277)` Watch, `[5277, 5555)` Heavy Stare, so tier counts are exact whatever the seed.

**Top-ups.** `upgrade(id)` / `upgradeBatch(ids)` (permissionless, idempotent) deliver the Watch / Heavy Stare basket, chosen by `keccak(revealSeed, id)`. `tools/upgrade-all.mjs` does all of them.

**Afterwards.** The holder uses the account (`execute`, `executeBatch`), delegates an agent, locks it before listing. Transfers reset the Unblinking clock and void any agent; a lock survives.

## On-chain art format

Record: `[grid G][10 trait bytes][RLE runs]`, run byte = `(color << 5) | (len − 1)`, palette index 0..7 (6 tones black→neon, ice, dead-pixel white). The Neon trait picks one of 3 palettes (#CCFF00 Standard, #BCEE00 Deep, #D6FF1F Hot).

Chunk: `[uint16 offset × n][records]`, 32 records per chunk, 174 chunks, largest 6.8 KB, total 942,580 bytes. Provenance: `h0 = 0; h(k+1) = keccak256(h(k) ‖ chunk(k))`, committed before any mint; `NeonArt.seal()` only succeeds on a match.

SVG: one `<path>` per palette color (runs split per row) + procedural grain from `keccak(artId, i)`. `art/neonfaces/onchain.py` and `web/src/render.js` produce the same bytes; tests assert equality in Solidity and Node.

## Face account

Holder: `execute` / `executeBatch` (CALL only), receives ETH / ERC-20 / 721 / 1155, ERC-1271 via Solady's nested EIP-712 (safe against replay across accounts of the same holder). Agents: see [AGENTS.md](AGENTS.md); trading goes through NeonTrader (Uniswap v3 + Chainlink on Robinhood Chain, addresses in `config/trader.4663.json`). Lock: `lock(until)` blocks holder calls, agent calls and signatures until `until` (≤ 365 days, extend only), survives transfers, shown as "Locked until" in the metadata.

## Live metadata

`tokenURI` reads: Stare tier (Unrevealed until reveal), base seed and status, Stare Upgrade, **Holds <TICKER>** balances, **Unblinking (days)**, **Eyes open since**, **Locked until**, Art ID. Art itself is sealed and static. A future renderer can be plugged via `setRenderer` until `freezeMetadata()`; ERC-4906 events on every change.

## Entropy

`ChainEntropy` uses ArbSys `arbBlockNumber` / `arbBlockHash` (real L2 values) when both work, otherwise native opcodes; precompile calls are gas-capped. Not a VRF — used only for the reveal key and the choice among equal-value base baskets.
