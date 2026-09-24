# Security review

Internal review, 2026-09-25. It is not a substitute for an independent audit before mainnet.

**Scope:** `contracts/src/*` (NeonFaces, NeonMinter, NeonSeeder, NeonFaceAccount, NeonArt, NeonRenderer, NeonTrader, ChainEntropy), deploy/upload scripts, site transaction flows.
**Method:** line-by-line manual review with an attacker's model; 66 Foundry tests including attack scenarios (tier re-roll contract, rogue agent, front-run drain, full-supply permutation); mainnet-fork tests with real Stock Tokens, the real Uniswap v3 router/pools and Chainlink feeds; `forge lint` (every warning reviewed); end-to-end rehearsal on a local node with the canonical registry bytecode, including the site's mint and holder panel and a live agent.

## Findings

| ID | Severity | Finding | Status |
|---|---|---|---|
| H-01 | High | **Tier sniping.** The Stare tier was drawn inside the mint transaction; a contract could mint, read its tier and revert until it got Heavy Stare (≈ $60 of baskets vs $3), paying only gas. | **Fixed.** Nothing valuable is decided at mint: every Face gets an equivalent base basket. Tier and art are set together at reveal by a keyed permutation; Watch / Heavy Stare top-ups are delivered after reveal (permissionless). Test: `test_Security_TierCannotBeSnipedAtMint`. |
| H-02 | High | **Agents trading directly on a DEX router.** Selector-level permissions can't constrain arguments: an agent allowed `exactInput` could set itself as `recipient`, or accept any price and sandwich its own trades to drain the Face. | **Fixed.** Ready-made actions only allow `NeonTrader.swap`: output always paid to the calling Face, minimum output from Chainlink (≤ 1% + pool fees), listed tokens only, stale prices refused, daily USD cap set by the holder. Verified on a mainnet fork against the real Uniswap router, pools and feeds (`TraderFork.t.sol`). |
| M-01 | Medium | **Resale front-run.** A seller could empty the Face account after listing, just before the sale executes; the buyer receives an empty Face. | **Fixed.** `lock(until)` on the account blocks holder calls, agent calls and ERC-1271 signatures; it survives the sale and shows as "Locked until" in the metadata. Tests: `test_Lock_*`. |
| M-02 | Medium | **Late minters could pick art.** If the reveal happened while minting was open, the permutation would be known for future token ids. | **Fixed.** `requestReveal()` closes minting forever (`mintClosed`), team mint included. |
| M-03 | Medium | **Reveal grinding.** The metadata role could let a reveal window expire and request again. | **Mitigated.** No re-request while the target block is pending or its hash is readable; every request is counted on-chain (`revealRequests`) and evented; `tools/reveal-watch.mjs` lets anyone finalize immediately. Residual: a deliberately missed 25 s window can be retried, visibly. |
| M-04 | Medium | **Gas burn in entropy probing** (found in rehearsal). Calling an emulated ArbSys that hits INVALID consumed 63/64 of the transaction gas. | **Fixed.** Precompile calls are gas-capped and ArbSys is used only if both `arbBlockNumber` and `arbBlockHash` work. |
| L-01 | Low | Minting before the provenance commitment would make the art impossible to seal. | **Fixed.** Mint reverts with `ProvenanceNotSet`. |
| L-02 | Low | Deploy script revoked the metadata role from the admin when `ADMIN == deployer`. | **Fixed.** |
| L-03 | Low (functional) | Agents could not spend ETH (no ETH → token strategies), no batching, permissions only replaceable wholesale. | **Fixed.** ETH budget (`setAgentValueAllowance`), `executeBatchAsAgent`, `setAgentPermissions(add/remove)`. |
| I-01 | Info | ERC-20 allowances granted *before* a lock stay valid at the token level. | Documented in the contract, the holder panel and here. Revoke approvals before listing. |
| I-02 | Info | Allowing `transfer` / `approve` / `setApprovalForAll` to an agent lets it move assets. | By design (the holder chooses). The holder panel flags these selectors and asks for confirmation. |
| I-03 | Info | Randomness is L2 block-hash based, not a VRF. | Accepted: counts are exact by construction; only the reveal key depends on it. |
| I-04 | Info | Base-basket choice at mint is re-rollable. | Accepted: base baskets must be configured with equal value (documented in `config/baskets.plan.json`). |
| I-05 | Info | NeonTrader trusts Chainlink; there is no L2 sequencer-uptime feed on Robinhood Chain. | Accepted: prices older than 26 h are refused; the worst an agent can do inside the rules is ≤ 1% + fees per trade, bounded by the holder's daily cap. |
| I-06 | Info | Lint: calls in loops, events after calls, `encodePacked` with dynamic args, ETH sends. | Reviewed: trusted immutable targets, strings only (never hashed), sends only to immutable payees or within the agent budget. |

## What holders do NOT have to trust

- **Supply**: 5555 total, 111 team, 5444 sale — constants in bytecode. Minting ends forever at the reveal request.
- **Art**: sealed in `NeonArt` only if it matches the provenance committed before the first mint (enforced).
- **Trading**: no transfer pause, no blocklist, no operator filter, no proxy. Royalty capped at 5%.
- **Mint money**: payees and shares are immutable; anyone can trigger the split.
- **Face accounts**: immutable implementation; only the current holder controls it; agents are scoped and die on sale.

## What holders DO trust

| Area | Trust | Mitigation |
|---|---|---|
| Seed pool | the team funds `NeonSeeder` and may withdraw *unused* inventory | delivered seeds live in Face accounts; `coverage()`, `fundedCount()`, `upgradedCount()` are public; `lockConfig()` freezes baskets |
| Reveal timing | the metadata role requests the reveal | M-03 above |
| Renderer | the metadata role can swap the renderer until `freezeMetadata()` | art bytes are sealed regardless; swaps emit ERC-4906 events |
| Stock Tokens | issued by third parties with their own rules | fork test proves transfers into Face accounts work; a blocked transfer leaves the seed *pending*, never breaks a mint |

## Before mainnet

1. Independent audit of the seven contracts (≈ 1.5k lines of Solidity), focusing on H-01/H-02/M-01 fixes, `NeonTrader` price math, `NeonFaceAccount`, `NeonArt.artData` offsets and `NeonRenderer` JSON escaping.
2. Testnet rehearsal with the real Safe and real wallets (`contracts/script/rehearsal.sh`).
3. Configure base baskets with equal value (I-04).
