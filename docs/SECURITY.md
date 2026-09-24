# Security, trust assumptions and known limits

Get an independent audit before mainnet. This file lists what reviewers should focus on and what holders must trust.

## What holders do NOT have to trust

- **Supply**: 5555 total, 111 team, 5444 sale — constants in bytecode.
- **Art**: sealed in `NeonArt` only if it matches the provenance hash committed before mint. Nobody can change it afterwards.
- **Trading**: no transfer pause, no blocklist, no operator filter, no proxy. ERC-2981 royalty capped at 5%.
- **Mint money**: payees and shares are immutable; anyone can trigger the split.
- **Face accounts**: immutable implementation, controlled only by the current holder.

## What holders DO trust

| Area | Trust | Mitigation |
|---|---|---|
| Seed pool | the team funds `NeonSeeder` and may withdraw *unused* inventory | seeds already delivered live in Face accounts; `coverage()` and `fundedCount()` are public; `lockConfig()` freezes baskets |
| Randomness | L2 block hashes (sequencer could in theory bias) | tier counts are exact by construction; value at stake per draw is small |
| Metadata renderer | METADATA role can swap the renderer until `freezeMetadata()` | art bytes are sealed regardless; renderer swaps emit ERC-4906 events |
| Stock Tokens | issued by third parties, may have compliance rules | fork test proves transfers into TBAs work today; a blocked transfer makes the seed *pending*, never breaks mint |

## Reviewer focus

1. `NeonSeeder.activate` → `try this.fundFromSelf` pattern; `fundFromSelf` gated to `address(this)`; reentrancy (`nonReentrant` on `activate` / `fund`).
2. `NeonMinter.mint` payment exactness, Merkle leaf `(address, uint256)` double-hash, cap arithmetic, phase transitions.
3. `NeonFaceAccount` agent checks: grantor == current owner, epoch wipe, zero value, no self-target; Solady ERC6551 upgrade disabled.
4. `NeonArt.artData` offset parsing on the last record of a chunk; `seal` preconditions.
5. `ChainEntropy` precompile probing with gas-capped staticcalls (found and fixed during rehearsal: an emulated precompile hitting INVALID used to burn the whole transaction's gas).
6. `NeonRenderer` JSON escaping (token symbols are escaped), gas of `tokenURI` (~0.7 M).

## Agent risk (for holders)

An agent can only call what you allow. Allowing `approve` or a router function with an arbitrary recipient lets that agent move assets. The site and docs should recommend: approve trusted routers yourself, allow the agent only the swap function, set short expiries.

## Compliance language

Never describe the basket as shares, dividends or returns. Stock Tokens give economic exposure only, not legal ownership, and are not available to US persons. Keep this disclaimer in the site footer, FAQ, mint panel and metadata description (all already present).
