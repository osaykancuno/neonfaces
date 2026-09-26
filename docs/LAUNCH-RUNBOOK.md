# Launch runbook

Everything below has been rehearsed end-to-end on a local node with the canonical registry and OpenSea SeaDrop bytecode (`contracts/script/rehearsal.sh`). Do it once more on **testnet (46630)** with real wallets before mainnet.

## Calendar (sale on Tuesday 2026-10-13)

The Safe accepts the admin role 2 days after the deploy, and `verify-drop.mjs` fails until it has: deploy by **Saturday 10 October** (Sunday 11 at the latest).

| When | What |
|---|---|
| by Sun 4 Oct | addresses ready (step 0); public GitHub repo |
| week of 5 Oct | testnet rehearsal with the real Safe (sign every Safe batch once); check that OpenSea Studio imports the testnet contract |
| Fri 9 Oct | `node tools/baskets.mjs --live` (Friday's closing prices are the last fresh ones before the weekend); re-check the floor in [ECONOMICS.md](ECONOMICS.md) against the ETH price |
| Sat 10 Oct | deploy, upload the art, verify, keeper on; create the drop in OpenSea Studio |
| Sun 11 Oct | announce the snapshot time (Monday 18:00 UTC), the stage times and the rules (NFTs held in vaults, pools or loan contracts don't count: withdraw them before the snapshot) |
| Mon 12 Oct | 18:00 UTC: snapshots (stage 1 list first, then partners, ≈ 1 h 30), `allowlist.mjs`, upload both lists to Studio; the Safe accepts admin; `verify-drop.mjs` passes |
| Tue 13 Oct | 14:00 UTC stage 1, 15:30 stage 2, 17:00 public (24 h at most); when it ends: team mint and reveal the same day |

## 0. Accounts

Set up for a solo founder with no hardware wallet and two wallets: a MetaMask on the computer (Safe signer 1, Growth, Sale manager) and the personal wallet. The Safe needs both of them; everything else needs one signature.

| Who | What | Notes |
|---|---|---|
| **Safe 2/2** ("Treasury") | final admin of every contract, treasury (20%), royalty receiver | owners: the Safe signer 1 account of the computer MetaMask and the personal wallet, from **different seed phrases** (two accounts of the same MetaMask are one key, not two). One stolen key can't sign alone; losing a seed phrase locks the Safe for good, so both are written on paper, two copies each, kept in two places. A third owner can be added later from the Safe settings. Safe v1.4.1 is deployed on Robinhood Chain |
| Growth | growth (15%) | an account of the computer MetaMask (not the personal wallet, not the Safe signer account): money for collabs and growth, one signature is enough. It must differ from the Treasury address |
| Team beneficiary | receives the vested 15% | your personal wallet; the payee is a `VestingWallet` deployed by the script |
| `NeonSeedVault` | receives 50%, buys the basket tokens into the pool | deployed by the script, no address to prepare |
| Sale manager | runs the drop in OpenSea Studio (`owner()` of the collection while set) | an account of the computer MetaMask, used only in OpenSea Studio (never to sign on other sites). It can only configure SeaDrop stages: no minting, no art, no roles, proceeds always go to `NeonPayout`. Cleared after the sale |
| Keeper | runs `tools/seed-keeper.mjs` | a hot key with a little ETH for gas; it can only make the vault buy basket tokens for the pool |
| Deployer | deploys, uploads the art (≈ 0.03 ETH total gas, the only money needed before the sale) | holds nothing after hand-over |

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
Verify every contract on Blockscout:
```bash
forge verify-contract <address> src/NeonFaces.sol:NeonFaces --chain 4663 --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/ --watch
```
(repeat for NeonPayout, NeonSeedVault, NeonSeeder, NeonFaceAccount, NeonArt, NeonRenderer, VestingWallet; constructor args are in `broadcast/`.) OpenSea shows verified source and reads it to recognise the SeaDrop interface.

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

## 6. Team allocation (after the sale, before the reveal)

```bash
node tools/safe-tx.mjs 4663 team-mint <safe> 50    # account + base seed in the same tx (~190k gas per Face)
node tools/safe-tx.mjs 4663 team-mint <safe> 50
node tools/safe-tx.mjs 4663 team-mint <safe> 11
```
Minting the team Faces last means the sale's proceeds already stocked their seeds, and buyers' Faces are never queued behind them. During the sale OpenSea shows 5444 (the unminted team reserve isn't for sale). Ids don't matter: art and tier are assigned at reveal.

## 7. The drop on OpenSea

Allowlist CSVs (OpenSea format `address,limit`, no header):
```bash
node tools/snapshot.mjs config/allowlists/robinhood.json     # holders of Robinhood Chain collections -> config/allowlists/robinhood.csv
node tools/snapshot.mjs config/allowlists/partners.json      # holders of collections on other chains -> config/allowlists/partners.csv
node tools/allowlist.mjs config/allowlists/robinhood.csv      # -> config/allowlists/opensea/robinhood.csv
node tools/allowlist.mjs config/allowlists/partners.csv       # -> config/allowlists/opensea/partners.csv
```

The two configs list the chosen collections (4 on Robinhood Chain, 22 on Ethereum plus the two wrapped-Punk contracts). They read every token's owner through Multicall3 (`"method": "ownerOf"`; CryptoPunks through `punkIndexToAddress`). How the lists are cleaned, so every count is per real wallet:

- a wallet appears once per list, its NFTs summed across all the collections of that list;
- an ERC-6551 account (on Robinhood Chain every StonkBroker has one, and many hold Interns or other NFTs) counts for the wallet that owns its NFT;
- vaults, pools, loan and escrow contracts are left out (listed in `<phase>.report.json`); on Ethereum every contract is left out, since the same address on Robinhood Chain is usually no wallet at all;
- stage 1 (`robinhood.json`): the Robinhood Chain collections plus NORMIES and Normies Yacht Club, 1 Face per wallet;
- partners: at least 2 NFTs (`minNfts`), 2 Faces per wallet; a wallet also on the stage 1 list keeps at most 1 here (`notIn` + `notInLimit`). SeaDrop counts a wallet's Faces across stages, so it can't mint on stage 2 once it minted on stage 1. Run `robinhood.json` first.

Every scan saves each collection's counts in `config/allowlists/holders.json` (git-ignored): after changing rules, weights or which list a collection belongs to, `node tools/snapshot.mjs <config> --rules-only` rebuilds the list without reading the chain again.

Run both at the announced time with `"snapshotBlock": "latest"`: each collection is read at the block reached when its turn comes, recorded in the report (a pinned past block needs an archive RPC in `rpc`). Publish the two reports' blocks with the lists.

In OpenSea Studio, connected with the sale manager: create the drop from the existing contract (Robinhood Chain, `faces` in `contracts/deployments/4663.json`), then set:

| Stage | Allowlist | Start / end (UTC, Tue 29) | Price | Per wallet | Stage cap (total supply) |
|---|---|---|---|---|---|
| 1. Robinhood Chain + Normies | `opensea/robinhood.csv` | 14:00 / 15:30 | 0.011 ETH | from CSV (1) | 2000 |
| 2. Partners | `opensea/partners.csv` | 15:30 / 17:00 | 0.013 ETH | from CSV (2, or 1) | 4444 |
| 3. Public | none | 17:00 / 17:00 the next day at most | 0.018 ETH | 3 | 5444 |

Never below 0.011 ETH (self-funding floor ≈ 0.010 ETH at ETH $2,687, see [ECONOMICS.md](ECONOMICS.md)) and no free stage: every free Face is paid by the others.

- **Payout address = `NeonPayout`** (`payout` in the deployments file). Any other address is rejected on-chain.
- SeaDrop's stage cap is a ceiling on the collection's total supply (team Faces included), and per-wallet limits count every Face a wallet minted through SeaDrop, across stages. Check how Studio labels both before publishing.
- Studio publishes with one `multiConfigure` transaction from the sale manager. Allowlists can't be edited once a stage has started minting. The contract refuses stage fees above 10% or without restricted fee recipients.
- Then check the live configuration: `ADMIN=<Treasury Safe> OPENSEA_FEE_RECIPIENT=<OpenSea's fee address> node tools/verify-drop.mjs 4663` must pass (after every change in Studio too). It also fails while the Safe hasn't accepted the admin role or the deploy key still holds a role: do not open the sale until it passes.

Site:
```bash
OPENSEA_URL=https://opensea.io/collection/<slug> node tools/export-web.mjs 4663
```
`web/public/{deployment.json, agent-presets.json}` are generated (git-ignored). Set `VITE_SITE_URL` in `web/.env` to the final domain (same as `SITE_URL`): link previews on X, Telegram, WhatsApp and Discord need that absolute URL. `npm run build` and host `dist/` on Vercel / Cloudflare Pages / Netlify (`/face/:id` rewrites included; on IPFS use `/#/face/:id`).

Emergency brake: `node tools/safe-tx.mjs 4663 pause` (minting only; transfers never pause).

## 8. Close and reveal

1. Let the last stage end in Studio (or end it early), then the team mint (step 6).
2. Start the watcher: `PK=<any funded key> node tools/reveal-watch.mjs 4663`.
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
| The public stage never sells out | holders wait for a reveal that needs minting closed | the public stage ends 24 h after it opens (set in Studio), then team mint and reveal the same day; unsold Faces are never minted, sets and tiers stay proportional, the floor rule keeps every basket paid |
| The reveal window is missed | `reveal()` must land within ≈ 25 s of the target block | the watcher plus the keeper's safety net; if both miss, `reveal-request` again once the window has passed (every request is public) |
| A Safe owner isn't at hand | team mint, reveal request, lock and surplus wait | both owners are on the computer (MetaMask and the personal wallet); prepare the Safe batches (`safe-tx.mjs`) in advance, sign accept-admin first on deploy day, keep both seed phrases on paper |
| Weekend or stale feeds | the vault's buys wait (NeonTrader refuses prices older than 26 h) | close the sale and reveal Tuesday–Thursday; nothing is lost, deliveries resume on the next trading day |
| ETH falls between the sale and the top-up purchases | the vault's ETH buys fewer tokens | the reveal comes the day the sale ends and the set bonuses are bought during the sale; the vault keeps ≈ 24% above the baskets on a sell-out; the treasury can send ETH to the vault and anyone can send basket tokens to the seeder |
| A basket token or its feed stops working | deliveries with that token revert, the Face shows Pending | before `lock-seeder`, swap the leg with `setBasket`; lock only when `covered()` is true, so after the lock nothing depends on buying anymore |
| The keeper stops (key out of gas, GitHub switches the schedule off) | pending deliveries wait | every delivery is permissionless, buying included: the Face page makes the vault `restock` what is missing and delivers it, and `seed-keeper.mjs` runs with any funded key (without the role it restocks through the same door); a set's bonus comes with the transfer of its last piece, from a stock bought during the sale; the weekly keepalive job (an empty commit after 45 quiet days; if the default branch is protected, let github-actions push); if Actions ever shows the keeper disabled, press Enable; top up the keeper key |
| Marketplaces show stale data | old images or balances on OpenSea | `BatchMetadataUpdate` at the reveal, `MetadataUpdate` on every delivery and every move into or out of a Face, the daily refresh; `tokenURI` costs 2 to 9 M gas (an assembled set is the heaviest), within public RPC limits |
| The site goes down | holders lose the easy buttons, nothing else | art, metadata and accounts are on-chain; every action can be called from Blockscout |

## Rehearsal (do this first)

```bash
anvil --chain-id 46630 &                                  # local, free
RPC=http://127.0.0.1:8545 PK=<anvil key> ./contracts/script/rehearsal.sh
RPC=https://rpc.testnet.chain.robinhood.com PK=<testnet key> ./contracts/script/rehearsal.sh   # real testnet
```
