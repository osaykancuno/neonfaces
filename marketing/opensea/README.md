# OpenSea: the collection page and the drop page

Everything to paste into OpenSea, field by field. Images: `python marketing/opensea/make_opensea.py` (repo root), all
from the collection's own art. Sizes follow OpenSea's creator FAQ as read on 28 Sep 2026; if Studio asks for another
size, rebuild with the script rather than stretching a file.

**When**: the collection only exists on OpenSea after the deploy (Tue 29 Sep). Connected with the **sale manager**
(0x70Ad3dA485fD66F0986f465457AE804Bb11EFb99, the contract's `owner()`), import the contract in Studio, build the drop as
a **Draft**, fill the pages below, check the preview. The drop is published on Thu 1 Oct, once the Safe holds the admin role (the announcement is Tue 29 Sep, 16:00 Italy):
dates and prices on these pages are fine, they go public only then. The OpenSea account itself (connect the sale
manager, sign in) can be made any time.

## Images

| File | Size | Where it goes |
|---|---|---|
| `logo-1000.png` | 1000 x 1000 | Collection logo (profile image; OpenSea crops it to a circle: the eye stays whole) |
| `logo-240.png` | 240 x 240 | Drop page: banner logo |
| `header-desktop.png` | 2400 x 900 (8:3) | Drop page header, desktop; collection page banner, desktop |
| `header-mobile.png` | 1920 x 1080 (16:9) | Drop page header, mobile; collection page banner, mobile |
| `header-desktop-plain.png` | 2400 x 900 | The same wall without the box, if OpenSea's own title sits on top of ours |
| `section-1-on-chain.png` ... `section-5-gaze.png` | 3200 x 1800 (16:9) | Drop page: the five sections, in order |
| `prereveal-1200.png` | 1200 x 1200 | Pre-reveal image, only if Studio asks for one (the contract already serves this art on-chain before the reveal) |

`brand/banner.gif` (1500 x 500, animated) also works as a header where a GIF is accepted.

## Collection settings

- **Name**: NEONFACES
- **Category**: PFPs (or Art, if PFPs is not offered)
- **Links**: website `https://neonfaces.xyz`; X `https://x.com/osaykancuno`
- **Creator earnings**: 5% to the Safe `0x2388BB366bfEaF15d1D01C0e33660b6497FB0bE1` (optional for buyers; transfers are never restricted)
- **Description** (about 640 characters):

```
They don't blink. 5555 close-up pixel faces, fully on-chain on Robinhood Chain: the pixels, the traits and the metadata live in the contracts, with no server and no link that can break. Every Face is its own wallet (ERC-6551) and is born with a small basket of Stock Tokens; the holder can add to it or withdraw it at any time, and it moves with the Face when it changes hands. 555 faces come in four pieces to collect and assemble. The longer a Face stays with its holder, the harder it stares.

Stock Tokens give economic exposure only, not legal ownership of shares; availability depends on where you live and on the issuer's terms.
```

## Drop page

**Title**: NEONFACES

**Short description** (under the header):

```
5555 fully on-chain faces on Robinhood Chain. Every Face is a wallet with a small basket inside. Wallets on the list mint first for 24 hours, up to 3 each; then the sale opens to everyone, up to 5 per wallet in total, until every Face is sold. Art and tiers are revealed on-chain for everyone at once when the last Face is sold.
```

### Stages (as in docs/LAUNCH-RUNBOOK.md, section 7)

| Stage | Allowlist | Start / end (UTC) | Price | Per wallet |
|---|---|---|---|---|
| The list | `config/allowlists/opensea/list.csv` | Thu 1 Oct 18:00 / Fri 2 Oct 18:00 | 0.013 ETH | 3 (from the CSV) |
| Public | none | Fri 2 Oct 18:00 / at least 90 days later | 0.018 ETH | 5 |

Payout address: `NeonPayout` (`payout` in contracts/deployments/4663.json). Then `verify-drop.mjs` (Playbook).

### Sections (image left or right, title, text)

**1. The art lives on the chain** (`section-1-on-chain.png`)

```
Every Face is a grid of 20 to 40 blocks, about 190 bytes, stored on Robinhood Chain. The contract draws the image and writes the traits every time someone asks: no server, no link that can break. Every face starts from a portrait of a person who doesn't exist, and the full set was sealed against a fingerprint published before the mint, so nobody can swap the art later.
```

**2. Every Face is a wallet** (`section-2-wallet.png`)

```
Each Face has its own account on the chain (ERC-6551): the NFT is the key, and whoever holds the Face controls what's inside. Every Face starts with a base basket of about $5 in one of TSLA, NVDA, AAPL, AMZN or MSFT; Watch Faces receive about $14 more and Heavy Stare Faces about $70 more after the reveal. Add to it, withdraw it, or leave it: if the Face changes hands, what's inside goes with it.

Stock Tokens give economic exposure only, not legal ownership of shares; availability depends on where you live and on the issuer's terms.
```

**3. Three kinds of stare** (`section-3-tiers.png`)

```
When the sale closes, the reveal assigns every Face its art with a formula anyone can recompute on the chain, and the art decides the tier: Glance (4444 of the 5555 artworks), Watch (833) and Heavy Stare (278). Nothing valuable is decided inside the mint transaction, so nobody can mint, peek at the tier and cancel.
```

**4. Four pieces. One face.** (`section-4-sets.png`)

```
555 faces were cut in four: left eye, right eye, left mouth, right mouth. Each piece is a Face of its own, with its own wallet, and the reveal deals whole sets only, so every set can be completed. Move the other three pieces into one piece's wallet and that Face shows the whole face; the first time a set is assembled it receives a one-time basket of about $12. An assembled set can also be fused for good, with a neon frame.
```

**5. The Gaze** (`section-5-gaze.png`)

```
Every Face counts how long it has stayed with its holder. After 30, 90 and 365 days its neon starts to glow: Steady, Fixed, Piercing. The contract draws the glow into the art itself, so it shows on every marketplace and in every wallet. A sale resets it. There is no payout for waiting, only the picture.
```

### FAQ

**What do I get when I mint?**
```
A Face: an NFT with its own wallet, born with a base basket of about $5 in Stock Tokens. Every Face looks the same until the last one is sold; then the reveal gives every Face its art and tier, for everyone at once.
```

**How does the sale work?**
```
Thursday 1 October, 18:00 UTC: 24 hours reserved to wallets on the list, 0.013 ETH, up to 3 each (check your wallet on neonfaces.xyz). Friday 2 October, 18:00 UTC: the sale opens to everyone at 0.018 ETH, up to 5 per wallet in total, until every Face is sold. 5444 Faces are for sale; the 111 team Faces are minted after the sell-out.
```

**Where does the mint money go?**
```
OpenSea keeps its 10% fee. The rest is split by the contract: 55% to a seed vault that can only buy the basket tokens for the Faces, 15% treasury (art, site, audits), 15% team (released over 6 months), 15% growth and collaborations. The shares and the addresses are fixed in the contract; nobody can change them.
```

**Can I take out what's inside my Face?**
```
Yes, at any time, from the Face's page on neonfaces.xyz. Before listing a Face you can also lock its wallet until a date, so buyers can see that nothing can leave it before the sale. Stock Tokens give economic exposure only, not legal ownership of shares; availability depends on where you live and on the issuer's terms.
```

**Is this an investment?**
```
No. NEONFACES sells an artwork that can hold on-chain exposure, and promises no returns: what's inside a Face is worth whatever those tokens are worth. The contracts have no proxy and transfers can never be paused; the code, the tests and the security review are public.
```
