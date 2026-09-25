# Launch runbook

Everything below has been rehearsed end-to-end on a local node with the canonical registry and OpenSea SeaDrop bytecode (`contracts/script/rehearsal.sh`). Do it once more on **testnet (46630)** with real wallets before mainnet.

## 0. Accounts

| Who | What | Notes |
|---|---|---|
Set up for a solo founder with no hardware wallet: one Safe whose three keys live on different devices (two of them sign), and MetaMask accounts for everything that only needs one signature.

| Who | What | Notes |
|---|---|---|
| **Safe 2/3** ("Treasury") | final admin of every contract, treasury (25%), royalty receiver | signers: MetaMask on the computer, a wallet app on the phone, an offline backup key (written on paper, never typed into a connected device until needed). Each signer must come from a **different seed phrase**: two accounts of the same MetaMask are one key, not two. Losing one key loses nothing; one stolen key can't sign alone. Safe v1.4.1 is deployed on Robinhood Chain |
| Growth | growth (15%) | a dedicated MetaMask account (not the personal one, not a Safe signer): money for collabs and growth, one signature is enough. It must differ from the Treasury address |
| Team beneficiary | receives the vested 20% | your personal wallet; the payee is a `VestingWallet` deployed by the script |
| `NeonSeedVault` | receives 40%, buys the basket tokens into the pool | deployed by the script, no address to prepare |
| Sale manager | runs the drop in OpenSea Studio (`owner()` of the collection while set) | a dedicated MetaMask account, used only in OpenSea Studio (never to sign on other sites). It can only configure SeaDrop stages: no minting, no art, no roles, proceeds always go to `NeonPayout`. Cleared after the sale |
| Keeper | runs `tools/seed-keeper.mjs` | a hot key with a little ETH for gas; it can only make the vault buy basket tokens for the pool |
| Deployer | deploys, uploads the art (≈ 0.03 ETH total gas, the only money needed before the sale) | holds nothing after hand-over |

## 1. Freeze the art (before anything is public)

```bash
cd art && python generate.py && python export_site.py && python export_brand.py
```
Keep `art/output/onchain/chunks.json`, `placeholder.hex`, `provenance.json`, `art.json`, `rarity.csv` forever (commit them). Publish the rarity table.

## 2. Seed baskets

On a trading day, right before deploying: `node tools/baskets.mjs --live` → reads Chainlink prices, writes `contracts/config/baskets.4663.json` and prints the pool budget (≈ $42.5k at full supply). Nothing is bought in advance: the mint pays for the pool through `NeonSeedVault` (see [ECONOMICS.md](ECONOMICS.md) for the minimum price that makes this work).

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

Agent trading (NeonTrader, no owner), also wired into `NeonSeedVault` for the seed purchases — run it right after `Deploy.s.sol`, while the deployer is still admin:
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

Each run it pays the split (`releaseAll`) and the team's vested share, buys what the pool is missing (pending seeds first, then a stock of 25 Faces ahead) and delivers pending seeds; after the reveal it delivers the top-ups and, every 30 minutes, finds assembled sets and delivers their one-time bonus (keeping 5 bonuses in stock); once a day it calls `refreshMetadata()` so marketplaces pick up Unblinking days and the Gaze; and it finalizes a requested reveal if the watcher missed it and the window is still open. Tested end to end on a mainnet fork with the live SeaDrop, Uniswap and Chainlink. Open the sale Tuesday–Thursday: over a weekend stock prices go stale and purchases wait.

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

The two configs list the chosen collections (4 on Robinhood Chain, 22 on Ethereum plus the two wrapped-Punk contracts). They read every token's owner through Multicall3 (`"method": "ownerOf"`; CryptoPunks through `punkIndexToAddress`). Holders that are contracts on Ethereum (Safes, staking or escrow contracts) are left out: the same address on Robinhood Chain is usually no wallet at all. Announce a snapshot block, set it as `snapshotBlock` in both files and run them again; a block older than a few minutes needs an archive RPC in `rpc`.

In OpenSea Studio, connected with the sale manager: create the drop from the existing contract (Robinhood Chain, `faces` in `contracts/deployments/4663.json`), then set:

| Stage | Allowlist | Price | Per wallet | Stage cap (total supply) |
|---|---|---|---|---|
| 1. Robinhood Chain | `opensea/robinhood.csv` | 0.01 ETH | from CSV | 1500 |
| 2. Partners | `opensea/partners.csv` | 0.012 ETH | from CSV | 1500 + 2000 = 3500 |
| 3. Public | — | 0.02 ETH | 5 | — |

Never below the self-funding floor (≈ 0.009 ETH at ETH $2,691, see [ECONOMICS.md](ECONOMICS.md)) and no free stage: every free Face is paid by the others.

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
- `node tools/safe-tx.mjs 4663 sale-manager none` — the Safe becomes the collection owner on OpenSea again.
- OpenSea collection settings: creator earnings 5% (optional for buyers — transfers are never restricted) to the Safe. The collection reads `contractURI()` on-chain. List on HoodMarket too.
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
| Every year | renew the domain; top up the keeper key if ever low (≈ 0.01 ETH lasts years) | payment and a key |

## Rehearsal (do this first)

```bash
anvil --chain-id 46630 &                                  # local, free
RPC=http://127.0.0.1:8545 PK=<anvil key> ./contracts/script/rehearsal.sh
RPC=https://rpc.testnet.chain.robinhood.com PK=<testnet key> ./contracts/script/rehearsal.sh   # real testnet
```
