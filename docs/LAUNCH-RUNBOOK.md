# Launch runbook

Everything below has been rehearsed end-to-end on a local node with the canonical registry and OpenSea SeaDrop bytecode (`contracts/script/rehearsal.sh`). Do it once more on **testnet (46630)** with real wallets before mainnet.

## 0. Accounts

| Who | What | Notes |
|---|---|---|
| **Safe 3/5** | final admin of every contract, royalty receiver, treasury | Safe v1.4.1 is deployed on Robinhood Chain (mainnet + testnet) |
| Sale manager | runs the drop in OpenSea Studio (`owner()` of the collection while set) | hardware wallet. It can only configure SeaDrop stages: no minting, no art, no roles, proceeds always go to `NeonPayout`. Use the Safe itself if Studio accepts it (check on testnet). Cleared after the sale |
| Seed vault (Safe or separate multisig) | receives 40% of proceeds, buys Stock Tokens, refills `NeonSeeder` | must be able to hold/buy Stock Tokens (Robinhood ecosystem, non-US) |
| Growth multisig | 15% | |
| Team beneficiary | receives the vested 20% | the payee is a `VestingWallet` deployed by the script |
| Deployer EOA | deploys, uploads the art (≈ 0.02 ETH total gas) | holds nothing after hand-over |

## 1. Freeze the art (before anything is public)

```bash
cd art && python generate.py && python export_site.py
```
Keep `art/output/onchain/chunks.json`, `placeholder.hex`, `provenance.json`, `art.json`, `rarity.csv` forever (commit them). Publish the rarity table.

## 2. Seed baskets

1. On a trading day: `node tools/baskets.mjs --live` → reads Chainlink prices, writes `contracts/config/baskets.4663.json` and prints the pool budget (≈ $42.5k at full supply).
3. The seed vault buys that inventory. **Pre-fund `NeonSeeder` before the team mint and the first stage** at least for the Faces minted free: a Face must never be born empty.

## 3. Deploy

```bash
cd contracts
cp .env.example .env   # fill ADMIN, SALE_MANAGER, ROYALTY_RECEIVER, SEED_VAULT, TREASURY, GROWTH, TEAM_BENEFICIARY, SITE_URL
source .env
forge script script/Deploy.s.sol --rpc-url robinhood --private-key $DEPLOYER_PK --broadcast --slow
forge script script/UploadArt.s.sol --rpc-url robinhood --private-key $DEPLOYER_PK --broadcast --slow   # resumable, seals at the end
```
Verify every contract on Blockscout:
```bash
forge verify-contract <address> src/NeonFaces.sol:NeonFaces --chain 4663 --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/ --watch
```
(repeat for NeonPayout, NeonSeeder, NeonFaceAccount, NeonArt, NeonRenderer, VestingWallet; constructor args are in `broadcast/`.) OpenSea shows verified source and reads it to recognise the SeaDrop interface.

Agent trading (NeonTrader, no owner) and the holder panel's ready-made action:
```bash
forge script script/DeployTrader.s.sol --rpc-url robinhood --private-key $DEPLOYER_PK --broadcast --slow
node tools/presets.mjs 4663          # config/agent-presets.4663.json from the deployed trader
```

Independent check:
```bash
node tools/verify-onchain.mjs 4663
```

## 4. Hand-over to the Safe

The deploy script already started a 2-step admin transfer on NeonFaces, NeonSeeder, NeonArt. After the delay (2 days; NeonArt immediately):
```bash
node tools/safe-tx.mjs 4663 accept-admin     # import safe/4663-accept-admin.json in Safe > Transaction Builder
```

## 5. Fund the seed pool

Transfer the basket inventory to `NeonSeeder`. Check coverage per basket: `cast call <seeder> "coverage(uint32)(uint256)" <basketId>`.

## 6. Team allocation (before the drop opens)

```bash
node tools/safe-tx.mjs 4663 team-mint <safe> 50    # account + base seed in the same tx (~190k gas per Face)
node tools/safe-tx.mjs 4663 team-mint <safe> 50
node tools/safe-tx.mjs 4663 team-mint <safe> 11
```
The sale can only use the 5444 public Faces; SeaDrop sees `maxSupply()` = 5444 + team Faces already minted, so minting the team first makes OpenSea show 5555 from day one. Ids don't matter: art and tier are assigned at reveal.

## 7. The drop on OpenSea

Allowlist CSVs (OpenSea format `address,limit`, no header):
```bash
node tools/snapshot.mjs config/allowlists/collections.json    # holders of partner NFT collections -> config/allowlists/<phase>.csv
node tools/allowlist.mjs config/allowlists/builders.csv       # -> config/allowlists/opensea/builders.csv
node tools/allowlist.mjs config/allowlists/allowlist.csv      # -> config/allowlists/opensea/allowlist.csv
```

In OpenSea Studio, connected with the sale manager: create the drop from the existing contract (Robinhood Chain, `faces` in `contracts/deployments/4663.json`), then set:

| Stage | Allowlist | Price | Per wallet | Stage cap (total supply) |
|---|---|---|---|---|
| Builders | `opensea/builders.csv` | free | from CSV | 111 + 1111 = 1222 |
| Allowlist | `opensea/allowlist.csv` | 0.012 ETH | from CSV | 1222 + 2000 = 3222 |
| Public | — | 0.02 ETH | 5 | — |

- **Payout address = `NeonPayout`** (`payout` in the deployments file). Any other address is rejected on-chain.
- SeaDrop's stage cap is a ceiling on the collection's total supply (team Faces included), and per-wallet limits count every Face a wallet minted through SeaDrop, across stages. Check how Studio labels both before publishing.
- Studio publishes with one `multiConfigure` transaction from the sale manager. Allowlists can't be edited once a stage has started minting.

Site:
```bash
OPENSEA_URL=https://opensea.io/collection/<slug> node tools/export-web.mjs 4663
```
`web/public/{deployment.json, agent-presets.json}` are generated (git-ignored). `npm run build` and host `dist/` on Vercel / Cloudflare Pages / Netlify (`/face/:id` rewrites included; on IPFS use `/#/face/:id`).

Emergency brake: `node tools/safe-tx.mjs 4663 pause` (minting only; transfers never pause).

## 8. Close and reveal

1. Let the last stage end in Studio (or end it early).
2. Start the watcher: `PK=<any funded key> node tools/reveal-watch.mjs 4663`.
3. Safe: `node tools/safe-tx.mjs 4663 reveal-request`. This closes minting forever (SeaDrop then sees the final supply); the watcher calls `reveal()` within the 25-second window. If missed, repeat step 3 once the window has passed.
4. Deliver the Stare top-ups: `PK=<any funded key> node tools/upgrade-all.mjs 4663` (permissionless, idempotent — needs the Watch / Heavy Stare inventory in the pool).
5. `node tools/verify-onchain.mjs 4663` → art and tiers visible in `tokenURI`.

## 9. After mint

- `node tools/safe-tx.mjs 4663 release` whenever — pushes 40/25/20/15 (anyone can).
- `node tools/safe-tx.mjs 4663 sale-manager none` — the Safe becomes the collection owner on OpenSea again.
- OpenSea collection settings: creator earnings 5% (optional for buyers — transfers are never restricted) to the Safe. The collection reads `contractURI()` on-chain. List on HoodMarket too.
- `lock-seeder` once baskets are final. `freeze-metadata` only when no future renderer is planned.
- Refill pending seeds: `NeonSeeder.fund(id)` is permissionless.
- Point holders to their Face page (`/face/<id>`): withdraw, lock and agent delegation are there. Agent builders: [AGENTS.md](AGENTS.md).

## Rehearsal (do this first)

```bash
anvil --chain-id 46630 &                                  # local, free
RPC=http://127.0.0.1:8545 PK=<anvil key> ./contracts/script/rehearsal.sh
RPC=https://rpc.testnet.chain.robinhood.com PK=<testnet key> ./contracts/script/rehearsal.sh   # real testnet
```
