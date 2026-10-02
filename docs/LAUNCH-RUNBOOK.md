# Launch runbook

Everything below has been rehearsed end-to-end on a local node with the canonical registry and OpenSea SeaDrop bytecode (`contracts/script/rehearsal.sh`, `contracts/script/launch-day.sh`) and on **testnet (46630)** with the final art (26 Sep).

## Calendar (sale on Thursday 2026-10-01, 18:00 UTC = 20:00 in Italy)

Moved forward from Wednesday 7 October by the founder on 28 September. The Safe accepts the admin role 2 days after the
deploy, and `verify-drop.mjs` fails until it has: deploy on **Tuesday 29 September in the morning** (18:00 UTC at the
very latest, so the Safe can accept before the list opens).

| When | What |
|---|---|
| done 26 Sep | addresses ready (step 0); public GitHub repo; Safe tested with two signatures; the testnet rehearsal with the final art passed (deploy, art sealed with provenance `0x6525337e…` and verified byte for byte, SeaDrop stage, 20 mints, reveal, top-ups, split paid, a set assembled in one transaction with its bonus, a set vote, the set fused, a withdrawal and a lock from a Face account; ≈ 0.0033 test ETH; addresses in `contracts/deployments/46630.json`). The same day a local launch-day run at the real price covered the rest: six wallets buying, keeper, team mint, reveal by a stranger, `restockAndDeliver` with an empty pool, a NeonTrader trade from a Face account, a resale under lock, vesting, a stand-in Safe accepting admin after 2 days, `lockConfig`, `releaseSurplus`. OpenSea no longer supports testnets, so Studio is checked on mainnet in Draft mode on deploy day |
| Mon 28 Sep night | the founder funds the mainnet wallets: deployer 0.015 ETH, keeper 0.01 ETH, sale manager 0.003 ETH, Safe signer 1 +0.002 ETH (it executes the Safe batches: accept-admin, the 111 team Faces ≈ 21M gas, the reveal request; it held 0.0008 ETH on 26 Sep). The deploy was simulated on mainnet on 26 Sep: ≈ 32M gas for Deploy.s.sol, ≈ 258M for the art, at a base fee of 0.028 gwei |
| Tue 29 Sep, morning | the fork tests and `node tools/baskets.mjs --live` (Monday's closing prices are still fresh on Tuesday: NeonTrader accepts prices up to 26 h old). It also quotes a $50 buy of every leg on the real pools: a leg marked BLOCKED (its pool more than 1% above Chainlink, so the vault would refuse to buy it) is replaced before the deploy (USO was blocked on Sat 26 Sep: its pool was 1.6% above the feed); re-check the floor in [ECONOMICS.md](ECONOMICS.md) against the ETH price |
| Tue 29 Sep, by midday | deploy, upload the art, verify, keeper on; import the contract in OpenSea Studio with the sale-manager account and build the drop as a **Draft** (the list stage and the public stage, the list's CSV, payout), check the preview, publish only when `verify-drop.mjs` passes |
| Tue 29 Sep, 16:00 Italy | announce the sale, only once the contracts are deployed and verified: Thursday 1 October 18:00 UTC on OpenSea, 24 hours reserved to the list (0.013 ETH, 3 per wallet; wallets check themselves on the preview, neonfaces.xyz), then the public from Friday 2 October 18:00 UTC (0.018 ETH, 5 per wallet in total) until the last Face sells; team Faces and reveal after the sell-out |
| Thu 1 Oct, morning | the Safe accepts the admin role (2 days after the deploy); the list's CSV is in the presale stage (rebuilt with the extra wallets if any, see section 7), `verify-drop.mjs` passes, then publish the drop in Studio (it opens by itself at the start time) |
| Thu 1 Oct | 18:00 UTC the list stage opens for 24 hours; neonfaces.xyz stays the preview (sale terms and official links); a wallet sees whether it is on the list by connecting on OpenSea's drop page (the site's wallet check was removed on 30 Sep) |
| Fri 2 Oct | 18:00 UTC the public stage opens, until the last Face sells; at the same time replace the preview with the web app on Cloudflare (`tools/site.sh deploy web`, [SITE-HOSTING.md](SITE-HOSTING.md); the wallet check lives only on the preview and is no longer needed); after the sell-out: team mint and reveal the same day (a sell-out on a weekend only delays the Stare top-ups to Monday's prices) |

## 0. Accounts

Set up for a solo founder with no hardware wallet and two wallets: a MetaMask on the computer (Safe signer 1, Growth, Sale manager) and the personal wallet. The Safe needs both of them; everything else needs one signature.

| Who | What | Notes |
|---|---|---|
| **Safe 2/2** ("Treasury") | final admin of every contract, treasury (15%), royalty receiver | owners: the Safe signer 1 account of the computer MetaMask and the personal wallet, from **different seed phrases** (two accounts of the same MetaMask are one key, not two). One stolen key can't sign alone; losing a seed phrase locks the Safe for good, so both are written on paper, two copies each, kept in two places. A third owner can be added later from the Safe settings. Created 2026-09-26: `0x2388BB366bfEaF15d1D01C0e33660b6497FB0bE1`, Safe v1.5.0 (SafeL2), no modules, no guard |
| Growth | growth (15%) | an account of the computer MetaMask (not the personal wallet, not the Safe signer account): money for collabs and growth, one signature is enough. It must differ from the Treasury address |
| Team beneficiary | receives the vested 15% | your personal wallet; the payee is a `VestingWallet` deployed by the script |
| `NeonSeedVault` | receives 55%, buys the basket tokens into the pool | deployed by the script, no address to prepare |
| Sale manager | runs the drop in OpenSea Studio (`owner()` of the collection while set) | an account of the computer MetaMask, used only in OpenSea Studio (never to sign on other sites). It can only configure SeaDrop stages: no minting, no art, no roles, proceeds always go to `NeonPayout`. Cleared after the sale |
| Keeper | runs `tools/seed-keeper.mjs` | a hot key with a little ETH for gas; it can only make the vault buy basket tokens for the pool |
| Deployer | deploys, uploads the art (≈ 258M gas: ≈ 0.008 ETH at 0.03 gwei, measured 2026-09-26; send 0.015 ETH for margin, the only money needed before the sale) | holds nothing after hand-over |

## 1. Freeze the art (before anything is public)

```bash
cd art && python generate.py && python export_site.py && python export_brand.py
```
Keep `art/output/onchain/chunks.json`, `placeholder.hex`, `provenance.json`, `art.json`, `rarity.csv` forever (commit them). Publish the rarity table.

## 2. Seed baskets

On a trading day, right before deploying: `node tools/baskets.mjs --live` → reads Chainlink prices, writes `contracts/config/baskets.4663.json` and prints the pool budget (≈ $60k at full supply). Nothing is bought in advance: the mint pays for the pool through `NeonSeedVault` (see [ECONOMICS.md](ECONOMICS.md) for the minimum price that makes this work).

## 3. Deploy

```bash
cd contracts
cp .env.example .env   # fill ADMIN, SALE_MANAGER, ROYALTY_RECEIVER, TREASURY, GROWTH, TEAM_BENEFICIARY, KEEPER, SITE_URL
source .env
forge script script/Deploy.s.sol --rpc-url robinhood --private-key $DEPLOYER_PK --broadcast --slow
forge script script/UploadArt.s.sol --rpc-url robinhood --private-key $DEPLOYER_PK --broadcast --slow   # resumable, seals at the end
```
Verify every contract, first on Sourcify (no key, reachable from scripts; Blockscout reads it), then on Blockscout:
```bash
forge verify-contract <address> src/NeonFaces.sol:NeonFaces --chain 4663 --verifier sourcify --watch
forge verify-contract <address> src/NeonFaces.sol:NeonFaces --chain 4663 --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/ --watch
```
(repeat for NeonPayout, NeonSeedVault, NeonSeeder, NeonFaceAccount, NeonArt, NeonRenderer, NeonSetVotes, NeonTrader, VestingWallet; constructor args are in `broadcast/`.) OpenSea shows verified source and reads it to recognise the SeaDrop interface. On 26 Sep the mainnet Blockscout API answered 403 (a Cloudflare bot check) to forge and curl while the testnet one answered: if it still does, verify on Blockscout from its web page (Contract > Verify & publish > Solidity, Standard JSON input, from `forge verify-contract <address> <path:Name> --chain 4663 --show-standard-json-input > <Name>.json`), and Etherscan also covers the chain (robin.etherscan.io, `--verifier etherscan` with a free Etherscan API key).

Agent trading (NeonTrader, no owner), also wired into `NeonSeedVault` for the seed purchases: run it right after `Deploy.s.sol`, while the deployer is still admin:
```bash
forge script script/DeployTrader.s.sol --rpc-url robinhood --private-key $DEPLOYER_PK --broadcast --slow
node tools/presets.mjs 4663          # config/agent-presets.4663.json from the deployed trader
```

Independent check:
```bash
node tools/verify-onchain.mjs 4663
```

## 4. Hand-over to the Safe

The deploy script already started a 2-step admin transfer on NeonFaces, NeonSeeder, NeonSeedVault, NeonArt. After the delay (2 days; NeonArt immediately):
```bash
node tools/safe-tx.mjs 4663 accept-admin     # import safe/4663-accept-admin.json in Safe > Transaction Builder
```

## 5. Seed keeper (automated)

The keeper is the project's only off-chain moving part, and it runs by itself on GitHub Actions (`.github/workflows/keeper.yml`, every 10 minutes, free on a public repository, no server). Set it up before the first stage opens:

1. Push the repository to GitHub (public: the contracts are verified on Blockscout anyway; `.env` and keys are git-ignored) and commit `contracts/deployments/4663.json`.
2. Settings > Secrets and variables > Actions: secret `KEEPER_PK` (the keeper key), secret `RUNNER_PK` (the strategy agent key, `cast wallet new`), variable `KEEPER_CHAIN_ID` = `4663`. Publish the strategy agent's address with the site: `STRATEGY_AGENT=<its address> OPENSEA_URL=... node tools/export-web.mjs 4663`.
3. Actions > keeper > Run workflow once and read the log.

Fund the keeper key and the strategy agent key with ≈ 0.01 ETH each: each transaction costs a fraction of a cent, so it lasts for years. To run it by hand instead: `PK=<keeper key> node tools/seed-keeper.mjs 4663` (loops every minute).

Each run it pays the split (`releaseAll`) and the team's vested share, buys what the pool is missing (pending seeds first, then a stock of 25 Faces ahead) and delivers pending seeds; after the reveal it delivers the top-ups and, every 30 minutes, finds assembled sets and delivers their one-time bonus (and stocks the bonus of every set not assembled yet, so later bonuses never wait for the keeper); once a day it calls `refreshMetadata()` so marketplaces pick up Unblinking days and the Gaze; and it finalizes a requested reveal if the watcher missed it and the window is still open. Tested end to end on a mainnet fork with the live SeaDrop, Uniswap and Chainlink. Open the sale Tuesday–Thursday: over a weekend stock prices go stale and purchases wait.

Sale day: the sale lasts hours (a day at most), and GitHub's schedule can run late. For those hours disable the scheduled workflow (Actions > keeper > Disable workflow) and run the keeper by hand every minute, `PK=<keeper key> INTERVAL=60 node tools/seed-keeper.mjs 4663`, so Faces wait minutes, not a delayed run, for their basket; enable the workflow again when the sale ends. Never run both at once with the same key (their transactions would collide).

## 6. Team allocation (after the sell-out, before the reveal)

```bash
node tools/safe-tx.mjs 4663 team-mint <safe> 50    # account + base seed in the same tx (~190k gas per Face)
node tools/safe-tx.mjs 4663 team-mint <safe> 50
node tools/safe-tx.mjs 4663 team-mint <safe> 11
```
Minting the team Faces last means the sale's proceeds already stocked their seeds, and buyers' Faces are never queued behind them. During the sale OpenSea shows 5444 (the unminted team reserve isn't for sale). Ids don't matter: art and tier are assigned at reveal.

## 7. The drop on OpenSea

The list (decided 26 Sep): wallets holding at least one NFT of the listed collections at the 25 September snapshot, one entry per wallet, 3 Faces each. Which collections qualify is not published: `config/allowlists/list.json`, the lists and their reports are git-ignored. Rebuild it without reading the chain again, adding the extra wallets from `config/allowlists/extra.csv` (one `address` or `address,3` per line) when there are some:
```bash
node tools/snapshot.mjs config/allowlists/list.json --rules-only           # -> config/allowlists/list.csv (27,902 wallets)
node tools/allowlist.mjs config/allowlists/list.csv config/allowlists/extra.csv --limit 3
# -> config/allowlists/opensea/list.csv for Studio (fails above 30,000 wallets: OpenSea's limit per presale stage)
```
Since 30 Sep there is no wallet check on the site: the list is checked on OpenSea's drop page, and `allowlist.mjs` writes only the Studio CSV.

The preview has the web app's look: `landing/app.css` and `landing/app.js` are built from `web/src` (stylesheet, eye, mosaic, tape, boot, cursor, sound) by `npm --prefix web run build:preview`, which also copies the gallery the hero mosaic draws from (`landing/data/gallery.json`). Run it after any change to `web/src/style.css` or `web/src/effects/`, then publish it: `tools/site.sh deploy preview`.

In OpenSea Studio, connected with the sale manager: create the drop from the existing contract (Robinhood Chain, `faces` in `contracts/deployments/4663.json`), then set:

| Stage | Allowlist | Start / end (UTC) | Price | Per wallet | Supply |
|---|---|---|---|---|---|
| 1. The list | `config/allowlists/opensea/list.csv` | Thu 1 Oct 18:00 / Fri 2 Oct 18:00 | 0.013 ETH | from CSV (3) | 5444 |
| 2. Public | none | Fri 2 Oct 13:00 / Sat 31 Oct 18:00 (set on 2 Oct; minting really closes with the reveal request after the sell-out) | 0.009 ETH (0.018, then 0.013, 2 Oct) | 15 (from 5, 2 Oct) | 5444 |

Never below the self-funding floor (≈ 0.009 ETH at ETH $2,687, see [ECONOMICS.md](ECONOMICS.md)) and no free stage: every free Face is paid by the others.

- **Payout address = `NeonPayout`** (`payout` in the deployments file). Any other address is rejected on-chain.
- SeaDrop reads the collection's supply cap from `maxSupply()` (5444 until the team mint, which comes after the sell-out), and the per-wallet limit counts every Face a wallet minted through SeaDrop. Check how Studio labels both before publishing.
- Studio publishes with one `multiConfigure` transaction from the sale manager. The allowlist can't be edited once its stage has started minting. The contract refuses stage fees above 10% or without restricted fee recipients.
- Then check the live configuration: `ADMIN=0x2388BB366bfEaF15d1D01C0e33660b6497FB0bE1 KEEPER=<keeper address> OPENSEA_FEE_RECIPIENT=0x0000a26b00c1F0DF003000390027140000fAa719 node tools/verify-drop.mjs 4663` must pass (after every change in Studio too). The fee address is the one OpenSea's own drops on Robinhood Chain allow, at 10% (read on-chain 26 Sep). Besides the stages it reads back the whole deploy (seeder, renderer, trader, payout payees, vesting, royalty, provenance, sealed art, the Safe's roles, the keeper's role). It also fails while the Safe hasn't accepted the admin role or the deploy key still holds a role: do not open the sale until it passes.

Site:
```bash
OPENSEA_URL=https://opensea.io/collection/<slug> node tools/export-web.mjs 4663
```
`web/public/{deployment.json, agent-presets.json}` are generated (git-ignored). Set `VITE_SITE_URL` in `web/.env` to the final domain (same as `SITE_URL`): link previews on X, Telegram, WhatsApp and Discord need that absolute URL. `tools/site.sh deploy web` builds and publishes `dist/` on Cloudflare and checks it byte for byte ([SITE-HOSTING.md](SITE-HOSTING.md); the config's single-page mode serves `/face/:id`; `dist/_redirects` is for Netlify; on IPFS use `/#/face/:id`). It replaces the preview (landing/) on Friday 2 October at 18:00 UTC, when the list window ends and the public stage opens: the wallet check lives only on the preview, so it stays online for the whole list window.

Emergency brake: `node tools/safe-tx.mjs 4663 pause` (minting only; transfers never pause).

### Plan B: the stages set on-chain, the mint on neonfaces.xyz

For when Studio can't manage the contract (28 Sep: OpenSea indexed the collection, but Studio doesn't list a contract it didn't deploy). The stages are the same SeaDrop stages Studio would set, so the Faces still mint through OpenSea's SeaDrop contract, OpenSea still takes its fee, and the collection page shows every Face.

```bash
node tools/seadrop-drop.mjs 4663        # Merkle tree of the list, the proofs (web/public/drop/, git-ignored), the calldata
node tools/configure-drop.mjs 4663      # http://127.0.0.1:8787 in the browser of the sale manager's wallet
```
The page states every term, refuses any wallet other than the sale manager, simulates, sends the one `multiConfigure` and reads SeaDrop back (four checks). Then `verify-drop.mjs` as above. Re-run `seadrop-drop.mjs` whenever the list changes, and configure again before the list stage starts.

The web app mints when `web/public/drop/params.json` is published with it: the panel on Home shows a countdown, then the stage open for the connected wallet (its proof on the list, what it minted, what is left), simulates each mint and sends it to SeaDrop with OpenSea's fee recipient. Every Face minted is then born on screen with its account and basket, read from the transaction, and the screen lights up neon; each size from 1 to 5 has its own scene. So on plan B the web app goes live **before Thu 18:00 UTC**, with the proofs (`tools/site.sh deploy web`, 256 proof files, 29 MB). **On the Studio path, delete `web/public/drop/` before building**, or the site would offer its own mint next to OpenSea's.

Tested on a fork of mainnet (29 Sep): the configure page (wrong account refused, dry run, four checks PASS), the countdown switching to the list stage at 18:00:00 without a reload, listed and unlisted wallets, the per-wallet limits, a refused signature, mints of 1 to 5 in both stages, then a keeper round seeding all 100 Faces of a 100-Face rehearsal. A mint of 5 uses about 1.5M gas (a few cents at 0.02 gwei). The first Faces are born with their basket pending: the pool fills from the mint itself, on the keeper's next round.

### Site capacity (checked 27 Sep)

The mint happens on OpenSea; neonfaces.xyz is static files plus reads from the chain made by each visitor's browser, so thousands of visitors at once are fine as long as two things hold.

- **The host must not meter the traffic.** The launch days are expected at thousands of visits a day. Netlify's Free plan (300 credits a month; production deploys 15 credits, bandwidth 20 credits per GB, web requests 2 per 10,000) pauses every site when the credits run out: one visit to the preview is about 310 KB and 25 requests, one to the web app about 190 KB, roughly 12 credits per 1,000 visits, so it would stop within days. **The site runs on Cloudflare since 28 Sep** (a Worker with static assets only, reached by zone routes: static requests free and unlimited on every plan, atomic deploys, one-command rollback); the whole procedure and what was verified are in [SITE-HOSTING.md](SITE-HOSTING.md); publish with `tools/site.sh`.
- **The chain reads survive a busy public node.** The official RPC answered 40 parallel calls, a 100-call batch and 20 calls/s for 10 s from one address without errors; heavy log queries share a tighter per-address budget (44 parallel `eth_getLogs` gave six 429s, cleared in about 2 s). Every visitor has their own address, so the budget is per visitor. The site retries twice (0.5 s, 1 s) on a 429, then falls back to keyless public nodes (`rpcFallbacks` in `tools/export-web.mjs`: PublicNode, then dRPC's free tier) and stays on the node that answered for a minute before trying the official one again (`sticky()` in `web/src/chain.js`): tested with the official node down, a Face page loaded in 2.2 s instead of 27 s; a revert still comes back at once, never retried on another node. The fallbacks don't serve the journal's full-range logs; those stay on the official node, then Blockscout. Robinhood's docs recommend a dedicated provider for production (Alchemy, Quicknode, Blockdaemon, dRPC, Validation Cloud); a keyed endpoint would be public in the browser, so if one is added, restrict it to the site's domain in the provider's dashboard and put it first in `rpcFallbacks`, not in place of the official node.

## 8. Close and reveal

1. When the last public Face sells, the team mint (step 6).
2. Start the watcher: `PK=<any funded key> node tools/reveal-watch.mjs 4663`. Use the deploy key (its leftover ETH, no role left), never the keeper key while the keeper runs: two processes sending from one key collide on the nonce.
3. Safe: `node tools/safe-tx.mjs 4663 reveal-request`. This closes minting forever (SeaDrop then sees the final supply); the watcher calls `reveal()` within the 25-second window. If missed, repeat step 3 once the window has passed.
4. The seed keeper buys and delivers the Stare top-ups on its own (or, with the inventory in the pool: `PK=<any funded key> node tools/upgrade-all.mjs 4663`).
5. `node tools/verify-onchain.mjs 4663` → art and tiers visible in `tokenURI`.

## 9. After mint

- The split and the team vesting are paid by the keeper on its own (`node tools/safe-tx.mjs 4663 release` does the same by hand).
- `node tools/safe-tx.mjs 4663 sale-manager none`: the Safe becomes the collection owner on OpenSea again.
- OpenSea collection settings: creator earnings 5% (optional for buyers: transfers are never restricted) to the Safe. The collection reads `contractURI()` on-chain. List on HoodMarket too.
- `lock-seeder` once every top-up is delivered (it needs the reveal; set bonuses keep working after the lock: they use the locked baskets). From then on nothing owed to Faces can leave the pool. The vault's leftover ETH can go to the treasury once `NeonSeeder.covered()` is true (the pool holds every pending seed and unpaid set bonus): `node tools/safe-tx.mjs 4663 vault-surplus <eth>`. `freeze-metadata` only when no future renderer is planned.
- Refill pending seeds: `NeonSeeder.fund(id)` is permissionless.
- Point holders to their Face page (`/face/<id>`): withdraw, lock and agent delegation are there. Agent builders: [AGENTS.md](AGENTS.md).

## After launch: what runs alone, and the few things only a person can do

Runs by itself, forever or until done: art and metadata (on-chain), every Face account, the Gaze and Unblinking (computed at read time), the journal and the boards on the site (read from the chain in the browser), and the keeper on GitHub Actions: seeds, top-ups, set bonuses, split and vesting payments, daily metadata refresh, reveal safety net. Every action it takes is permissionless except the vault's purchases, so if it ever stopped, anyone could run `tools/seed-keeper.mjs` (or call the functions from Blockscout) and nothing would be lost. The strategy agent runs in the same workflow; if it stopped, strategies simply pause and every Face keeps what it holds.

Needs a person, on purpose (each is a decision or a key only the team should hold):

| When | What | Why it can't be automatic |
|---|---|---|
| Launch week | deploy, Safe accepts admin, OpenSea Studio stages, `verify-drop.mjs` | keys and stage terms are the team's decisions |
| End of sale | team mint, `reveal-request` from the Safe + `reveal-watch.mjs` | the reveal moment is announced; its 25-second window needs a watcher running at that moment |
| After the reveal | `sale-manager none`, later `lock-seeder` and `vault-surplus` | one-time Safe transactions |
| Before funding new baskets | `node tools/safe-tx.mjs 4663 poll <days> "<question>" "<choice>" ...`, then publish the result and the decision | only the treasury asks; the assembled sets answer |
| Every year | renew the domain; top up the keeper key if ever low (≈ 0.01 ETH lasts years) | payment and a key |

## What could stall after the mint, and the way around it

| Risk | What happens | Way around |
|---|---|---|
| The sale sells slowly | holders wait for a reveal that needs minting closed | the stage has no end time (decided 26 Sep): the reveal, the tiers, the Stare top-ups and the sets wait for the sell-out; minting closes only with the Safe's reveal request, so ending the sale early would be a separate decision, announced before it is taken. Base seeds are delivered all along |
| The reveal window is missed | `reveal()` must land within ≈ 25 s of the target block | the watcher plus the keeper's safety net; if both miss, `reveal-request` again once the window has passed (every request is public) |
| A Safe owner isn't at hand | team mint, reveal request, lock and surplus wait | both owners are on the computer (MetaMask and the personal wallet); prepare the Safe batches (`safe-tx.mjs`) in advance, sign accept-admin first on deploy day, keep both seed phrases on paper |
| Weekend or stale feeds | the vault's buys wait (NeonTrader refuses prices older than 26 h) | the sale opens on a Thursday; if the sell-out falls on a weekend, reveal anyway: nothing is lost, the top-ups and pending seeds are delivered on the next trading day |
| ETH falls between the sale and the top-up purchases | the vault's ETH buys fewer tokens | the reveal comes the day the sale ends and the set bonuses are bought during the sale; the vault keeps ≈ 24% above the baskets on a sell-out; the treasury can send ETH to the vault and anyone can send basket tokens to the seeder |
| A basket token or its feed stops working | deliveries with that token revert, the Face shows Pending | before `lock-seeder`, swap the leg with `setBasket`; lock only when `covered()` is true, so after the lock nothing depends on buying anymore |
| The keeper stops (key out of gas, GitHub switches the schedule off) | pending deliveries wait | every delivery is permissionless, buying included: the Face page makes the vault buy what is missing and deliver it in one transaction (`restockAndDeliver`; if a market is off its price the page says so before anything is signed), and `seed-keeper.mjs` runs with any funded key (without the role it restocks through the same door); a set's bonus comes with the transfer of its last piece, from a stock bought during the sale; the weekly keepalive job (an empty commit after 45 quiet days; if the default branch is protected, let github-actions push); if Actions ever shows the keeper disabled, press Enable; top up the keeper key |
| Marketplaces show stale data | old images or balances on OpenSea | `BatchMetadataUpdate` at the reveal, `MetadataUpdate` on every delivery and every move into or out of a Face, the daily refresh; `tokenURI` costs 2 to 9 M gas (an assembled set is the heaviest), within public RPC limits |
| The site goes down | holders lose the easy buttons, nothing else | art, metadata and accounts are on-chain; every action can be called from Blockscout |

## Rehearsal (do this first)

```bash
anvil --chain-id 46630 &                                  # local, free
RPC=http://127.0.0.1:8545 PK=<anvil key> ./contracts/script/rehearsal.sh
RPC=https://rpc.testnet.chain.robinhood.com PK=<testnet key> ./contracts/script/rehearsal.sh   # real testnet
anvil --chain-id 46630 --port 8548 &                      # a fresh node for the next line
./contracts/script/launch-day.sh                          # every on-chain process of launch day, PASS/FAIL per check
```
`rehearsal.sh` overwrites the tracked testnet addresses in `contracts/deployments/46630.json` when run locally: `git checkout` that file afterwards (`launch-day.sh` does it by itself). Use a fresh anvil for each run: several art uploads on one node raise its base fee until transactions fail.
