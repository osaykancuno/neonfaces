# Architecture

```
                 ┌──────────────┐ mint(qty, allowance, proof)  ┌───────────────┐
 holder ───────▶ │  NeonMinter  │ ───────────────────────────▶ │   NeonFaces   │ ERC-721 + 2981 + 4906
                 │ phases, AL,  │                              │ caps in code  │ provenance, reveal,
                 │ 40/25/20/15  │ activate(id) ─┐              │ Unblinking    │ renderer hook
                 └──────────────┘               ▼              └──────┬────────┘
                                         ┌──────────────┐             │ tokenURI / contractURI
   canonical ERC-6551 registry ◀──────── │  NeonSeeder  │             ▼
   createAccount(impl, 0, chain, NFT, id)│ urn, baskets │      ┌──────────────┐   artData(artId)   ┌──────────┐
                 │                       │ pending seeds│◀──── │ NeonRenderer │ ─────────────────▶ │ NeonArt  │
                 ▼                       └──────┬───────┘ seed │ SVG + JSON   │                    │ SSTORE2  │
        ┌──────────────────┐   Stock Tokens     │         Of() └──────────────┘                    │ sealed   │
        │ NeonFaceAccount  │ ◀──────────────────┘                                                  └──────────┘
        │ (TBA per Face)   │  execute (holder) · executeAsAgent (scoped agent)
        └──────────────────┘
```

## Contracts

| Contract | Role | Admin powers | Cannot |
|---|---|---|---|
| `NeonFaces` | ERC-721 "NEONFACES"/"NEON", ids 1..5555 | set renderer / fallback URIs until frozen, royalty receiver (≤5%), team mint (≤111), pause **minting**, request reveal, set provenance once before mint | exceed 5555 / 111, pause transfers, blocklist, upgrade, change art |
| `NeonMinter` | sale phases, Merkle allowlists (allowance in leaf), per-wallet caps, per-phase supply caps, proceeds split | configure phases, switch phase (Finished is terminal) | change split shares or payees, withdraw to anyone else |
| `NeonSeeder` | creates the TBA, draws the Stare tier (exact urn), funds baskets, records seeds, maps tokens to art | configure baskets until `lockConfig()`, withdraw unused pool | touch tokens already in Face accounts, re-draw a tier |
| `NeonFaceAccount` | ERC-6551 account (Solady base), immutable | — (the Face holder is the only owner) | be upgraded; agents can't move ETH, sign, call the account itself, or survive a sale |
| `NeonArt` | 174 SSTORE2 chunks of 32 records, running keccak | add chunks / reset **until sealed** | change anything after `seal()` (permissionless, requires provenance match) |
| `NeonRenderer` | builds SVG + JSON on-chain | none (no owner, no storage) | — |

All admin roles sit behind `AccessControlDefaultAdminRules` (2-step transfer, 2-day delay on NeonFaces / Seeder / Minter).

## Mint flow (one transaction)

1. `NeonMinter.mint` checks phase, price (exact `msg.value`), Merkle proof `(address, allowance)`, wallet cap, phase cap.
2. `NeonFaces.mint` mints sequential ids inside the public allocation (5444); the team allocation (111) is separate.
3. For each id, `NeonSeeder.activate(id)`:
   - `registry.createAccount(impl, salt 0, chainid, NeonFaces, id)` — idempotent;
   - draws the tier from the urn (probability = remaining slots of the tier / remaining slots), records `tierIndex`;
   - `try this.fundFromSelf(...)` — transfers the basket legs to the account; on any failure the seed is *pending* and the mint still succeeds. Anyone can later call `fund(id)`.

## On-chain art format

Record: `[grid G][10 trait bytes][RLE runs]`, run byte = `(color << 5) | (len - 1)`, palette index 0..7 (6 tones black→neon, ice, dead-pixel white). Neon trait selects one of 3 palettes (#CCFF00 Standard, #BCEE00 Deep, #D6FF1F Hot).

Chunk: `[uint16 offset × n][records]`, 32 records per chunk, 174 chunks, largest 6.8 KB. Total 942,580 bytes.

Provenance: `h0 = 0; h(k+1) = keccak256(h(k) ‖ chunk(k))`. Committed in `NeonFaces.provenanceHash` by the deploy script before any mint. `NeonArt.seal()` only succeeds if the uploaded chunks hash to it.

SVG: one `<path>` per palette color (runs split per row), grain drawn procedurally from `keccak(artId, i)` (Dusty specks; Heavy scan pattern + turbulence + streak). The exact same bytes are produced by `art/neonfaces/onchain.py` and `web/src/render.js`; tests assert byte equality in Solidity and Node.

## Reveal

1. `requestReveal()` (METADATA role) sets `revealBlock = L2 block + 5`.
2. Anyone calls `reveal()` after that block while its hash is readable (256 blocks ≈ 25 s at 100 ms): `revealSeed = keccak(arbBlockHash(revealBlock), provenance, address)`. `tools/reveal-watch.mjs` does it automatically. If the window is missed, request again.
3. `artIdOf(id) = tierFirst + (tierIndex + keccak(revealSeed, tier) % tierSize) % tierSize` — a bijection inside each tier, verifiable by anyone.

## Entropy

`ChainEntropy` uses ArbSys `arbBlockNumber` / `arbBlockHash` (real L2 values) when both work, otherwise native opcodes; precompile calls are gas-capped. This is not a VRF: the sequencer could bias it. It only drives low-stakes draws (tier order, reveal offset), and tier *counts* are exact regardless of randomness.

## Agent delegation (NeonFaceAccount)

`setAgent(agent, expiry, [(target, selector)])` by the holder. `executeAsAgent(target, data)` succeeds only if: caller is the agent, not expired, the Face holder is still the one who granted it, and `(target, selector)` is allowed in the current epoch. Zero value only. Re-configuring bumps the epoch and wipes old permissions. Typical pattern: holder approves a router once, allows the agent `router.swap` only — assets never leave the Face account.

## Dynamic metadata

`tokenURI` reads live: Stare tier, seed basket (tickers via `symbol()`), seed status, **Holds <TICKER>** balances inside the account, **Unblinking (days)** and **Eyes open since** (date). The art itself is static and sealed. A future "mood" renderer can be plugged via `setRenderer` until `freezeMetadata()`; `BatchMetadataUpdate` (ERC-4906) is emitted on every change.
