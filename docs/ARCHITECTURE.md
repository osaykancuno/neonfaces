# Architecture

```
 OpenSea mint ──▶ ┌──────────────┐  mintSeaDrop(minter, qty)   ┌───────────────┐
                  │   SeaDrop    │ ──────────────────────────▶ │   NeonFaces   │ ERC-721 + 2981 + 4906
                  │  (OpenSea)   │                             │ caps in code  │ provenance, reveal,
                  │ stages, AL,  │                             │ Unblinking    │ mint closes at reveal
                  │ price, limit │                             └──┬─────────┬──┘
                  └──────┬───────┘                   activate(id) │         │ tokenURI / contractURI
      creator share (90%)▼                                        ▼         ▼
                  ┌──────────────┐                 ┌──────────────┐  ┌──────────────┐ artData ┌──────────┐
                  │  NeonPayout  │ canonical 6551 ◀│  NeonSeeder  │◀─│ NeonRenderer │───────▶ │ NeonArt  │
                  │ 40/25/20/15  │ registry        │ base seeds,  │  │ SVG + JSON   │         │ SSTORE2  │
                  └──────────────┘     │           │ reveal perm, │  └──────────────┘         │ sealed   │
                                       ▼           │ top-ups      │                           └──────────┘
                              ┌──────────────────┐ └──────┬───────┘
                              │ NeonFaceAccount  │◀───────┘ Stock Tokens
                              │ (TBA per Face)   │  execute (holder) · executeAsAgent (scoped agent) · lock
                              └──────────────────┘
```

## Contracts

| Contract | Role | Admin powers | Cannot |
|---|---|---|---|
| `NeonFaces` | ERC-721 "NEONFACES"/"NEON", ids 1..5555, "Unblinking" clock, SeaDrop 1.0 token interface | set renderer / fallback URIs until frozen, royalty receiver (≤5%), team mint (≤111), pause **minting**, set provenance and seeder once, request reveal, choose which SeaDrop may mint and the sale manager | exceed 5555 / 111, mint without provenance or seeder, mint after the reveal request, pay mint proceeds anywhere but `NeonPayout`, pause transfers, blocklist, upgrade, change art. The only transfer ever refused is one that would make a Face own itself through Face accounts (`OwnershipCycle`) |
| `NeonPayout` | receives the creator share of every OpenSea mint, splits 40 / 25 / 20 / 15 | none (no owner) | change shares or payees |
| `NeonSeedVault` | receives the 40% seed share; the keeper makes it buy basket tokens through NeonTrader, delivered straight to the seed pool | wire seeder and trader once, grant the keeper role, send surplus to the treasury after `lockConfig()` | send ETH or tokens anywhere else, buy tokens that are in no basket, pay more than Chainlink price + 1% |
| `NeonSeeder` | creates the TBA, delivers base seeds at mint, maps tokens to art and sets at reveal, delivers tier top-ups and set bonuses | configure baskets until `lockConfig()`, withdraw unused pool | touch tokens already in Face accounts, influence tiers |
| `NeonFaceAccount` | ERC-6551 account (Solady base), immutable | — (only the Face holder) | be upgraded; agents can't sign, exceed their calls or ETH budget, act while locked, or survive a sale |
| `NeonArt` | 174 SSTORE2 chunks of 32 records, running keccak | add chunks / reset **until sealed** | change anything after `seal()` (permissionless, requires provenance match) |
| `NeonRenderer` | builds SVG + JSON on-chain; an assembled set is drawn as the whole face; "Holds" lists seed and bonus tokens plus tradable tokens the Face holds | none (no owner) | — |
| `NeonTrader` | the only trading door for agents: Uniswap v3 SwapRouter02, output to the caller, Chainlink-bounded price, daily USD cap per account; stores each account's standing strategy (`setStrategy`) and emits a reason per trade (`swapWithNote`) | none (no owner, no upgrade) | pay anyone but the caller, trade unlisted tokens, use stale prices |

External: **SeaDrop** (OpenSea, `0x00005EA0…4bf5`) holds the drop configuration — stage windows, prices, per-wallet limits, stage supply caps, the allowlist Merkle root built by OpenSea Studio — checks every mint against it, keeps OpenSea's fee and pays the rest to the payout address. `NeonFaces` only forwards configuration from the **sale manager** (the wallet used in OpenSea Studio, reported as `owner()` while set) or the admin, and rejects any payout address other than `NeonPayout`, and any stage fee above 10% or without restricted fee recipients. Studio configures everything in one `multiConfigure` call; its supply, base URI, contract URI and provenance fields are ignored because those are fixed on-chain.

Admin roles sit behind `AccessControlDefaultAdminRules` (2-step transfer, 2-day delay on NeonFaces / Seeder / SeedVault).

## Lifecycle of a Face

**Mint (one transaction, on OpenSea).** SeaDrop checks the stage window, exact price, per-wallet limit (every Face the wallet minted through SeaDrop counts), stage supply cap and, for presale stages, the Merkle proof → `NeonFaces.mintSeaDrop` (only the allowed SeaDrop; requires provenance and seeder, mint not closed, within the 5444 sale allocation) mints the ids → for each id `NeonSeeder.activate`: `registry.createAccount(impl, 0, chainid, NeonFaces, id)` (idempotent) and a `try` delivery of a **base basket** (all base baskets have equal target value). If the pool is short or a token refuses, the seed is pending and anyone can `fund(id)` later — the mint never fails for seeding reasons. Then SeaDrop pays OpenSea's fee and sends the rest to `NeonPayout`, whose 40% goes to `NeonSeedVault`; `tools/seed-keeper.mjs` turns it into pool inventory and delivers pending seeds, so the sale pays for its own seeds. Team mints (`teamMint`, admin, ≤ 111) activate their Faces the same way. Nothing valuable is decided inside the mint transaction.

**Reveal.** `requestReveal()` closes minting forever and sets `revealBlock = L2 block + 5`. Anyone calls `reveal()` while that block's hash is readable (256 blocks ≈ 25 s at 100 ms; `tools/reveal-watch.mjs`). `revealSeed = keccak(arbBlockHash(revealBlock), provenance, address)`. A new request is only possible once the window has passed; requests are counted.

**Art layout.** Art ids `[0, 3335)` are single close-ups; set k (1..555) is art ids `3335 + 4(k−1) … +3`: left eye, right eye, left mouth, right mouth (the four quarters of one face drawn at 2G × 2G). Tiers by range: singles `[0, 2668)` Glance, `[2668, 3169)` Watch, `[3169, 3335)` Heavy Stare; sets 1–444 Glance, 445–527 Watch, 528–555 Heavy Stare. Over the 5555 artworks: exactly 4444 / 833 / 278.

**Mapping.** With n Faces minted (ids 1..n, no burn, mint closed), every id gets a slot `p = (a · (id − 1) + b) mod n`, `a` coprime to n, `(a, b)` from the seed (`revealKey`). The first `4 · setsIn(n)` slots (`setsIn(n) = ⌊n · 555 / 5555⌋`, all 555 on a sell-out) are whole sets, four consecutive slots per set; the rest are singles. Which set and which single is a second keyed permutation of each range. So a partial sale deals only whole sets, keeps tiers proportional on average, and on a sell-out is a bijection onto the 5555 artworks. For n ≥ 256, `a` is also chosen so the four ids of a set are more than n/64 apart (no finished set from a run of consecutive ids). `artIdOf`, `setOf` (set id, piece, the four member ids) and `tierOf` are public views anyone can recompute.

**Sets.** A set is *assembled* when the other three pieces are owned by one piece's ERC-6551 account (`isAssembled(anchor)`): selling the anchor sells the set, the renderer draws the whole face, and `claimSetBonus(anchor)` (permissionless; the keeper calls it) delivers a one-time bonus basket into the anchor's account, once per set ever. Taking the set apart is the holder calling `executeBatch` on the anchor's account. `NeonFaces` refuses any transfer that would leave a Face owning itself (A into its own account, or into the account of a Face it holds) and caps nesting at 4 levels; every move into or out of a Face account emits `MetadataUpdate` for that Face.

**Top-ups.** `upgrade(id)` / `upgradeBatch(ids)` (permissionless, idempotent) deliver the Watch / Heavy Stare basket, chosen by `keccak(revealSeed, id)`. `tools/upgrade-all.mjs` does all of them. The set bonus is chosen by `keccak(revealSeed, setId, 4)`.

**Afterwards.** The holder uses the account (`execute`, `executeBatch`), delegates an agent, locks it before listing. Transfers reset the Unblinking clock and void any agent; a lock survives.

## On-chain art format

Record: `[grid G][11 trait bytes][RLE runs]` (the 11th is Face: none / woman / man), run byte = `(color << 5) | (len − 1)`, palette index 0..7 (6 tones black→neon, ice, dead-pixel white). The Neon trait picks one of 3 palettes (#CCFF00 Standard, #BCEE00 Deep, #D6FF1F Hot).

Chunk: `[uint16 offset × n][records]`, 32 records per chunk, 174 chunks, largest 8.9 KB, total 995,321 bytes. Provenance: `h0 = 0; h(k+1) = keccak256(h(k) ‖ chunk(k))`, committed before any mint; `NeonArt.seal()` only succeeds on a match.

SVG: one `<path>` per palette color (runs split per row) + procedural grain from `keccak(artId, i)`. An assembled set is the four records side by side on a 2G grid, grain keyed by `5555 + setId` (`renderSetSVG`). `art/neonfaces/onchain.py` and `web/src/render.js` produce the same bytes; tests assert equality in Solidity and Node.

## Face account

Holder: `execute` / `executeBatch` (CALL only), receives ETH / ERC-20 / 721 / 1155, ERC-1271 via Solady's nested EIP-712 (safe against replay across accounts of the same holder). Agents: see [AGENTS.md](AGENTS.md); trading goes through NeonTrader (Uniswap v3 + Chainlink on Robinhood Chain, addresses in `config/trader.4663.json`). Lock: `lock(until)` blocks holder calls, agent calls and signatures until `until` (≤ 365 days, extend only), survives transfers, shown as "Locked until" in the metadata.

## Live metadata

`tokenURI` reads: Stare tier (Unrevealed until reveal), base seed and status, Stare Upgrade, **Set** / **Set status** (Assembled, or Inside #id) / **Set bonus** on set pieces, **Holds <TICKER>** balances, **Unblinking (days)**, **Eyes open since**, **Gaze**, **Locked until**, Art ID. The art is sealed; the only thing time adds to the image is the **Gaze**: after 30 / 90 / 365 days with the same holder the SVG is screened with a blurred copy of itself (Steady / Fixed / Burning bloom, `gazeOf`), reset by a sale. Time-based changes emit no event, so `NeonFaces.refreshMetadata()` (anyone, once a day; the keeper calls it) emits `BatchMetadataUpdate` for marketplaces. A future renderer can be plugged via `setRenderer` until `freezeMetadata()`; ERC-4906 events on every change.

## Entropy

`ChainEntropy` uses ArbSys `arbBlockNumber` / `arbBlockHash` (real L2 values) when both work, otherwise native opcodes; precompile calls are gas-capped. Not a VRF — used only for the reveal key and the choice among equal-value base baskets.
