# Launch runbook

Everything below has been rehearsed end-to-end on a local node with the canonical registry bytecode (`contracts/script/rehearsal.sh`). Do it once more on **testnet (46630)** with real wallets before mainnet.

## 0. Accounts

| Who | What | Notes |
|---|---|---|
| **Safe 3/5** | final admin of every contract, royalty receiver, treasury | Safe v1.4.1 is deployed on Robinhood Chain (mainnet + testnet) |
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

1. Update `config/baskets.plan.json` → `prices` (USD) and `pricesAsOf`.
2. `node tools/baskets.mjs` → writes `contracts/config/baskets.4663.json` and prints the pool budget.
3. The seed vault buys that inventory. **Pre-fund `NeonSeeder` before the Builders phase** at least for the Faces that will be minted free: a Face must never be born empty.

## 3. Deploy

```bash
cd contracts
cp .env.example .env   # fill ADMIN, ROYALTY_RECEIVER, SEED_VAULT, TREASURY, GROWTH, TEAM_BENEFICIARY, SITE_URL
source .env
forge script script/Deploy.s.sol --rpc-url robinhood --private-key $DEPLOYER_PK --broadcast --slow
forge script script/UploadArt.s.sol --rpc-url robinhood --private-key $DEPLOYER_PK --broadcast --slow   # resumable, seals at the end
```
Verify every contract on Blockscout:
```bash
forge verify-contract <address> src/NeonFaces.sol:NeonFaces --chain 4663 --verifier blockscout --verifier-url https://robinhoodchain.blockscout.com/api/ --watch
```
(repeat for NeonMinter, NeonSeeder, NeonFaceAccount, NeonArt, NeonRenderer, VestingWallet; constructor args are in `broadcast/`.)

Independent check:
```bash
node tools/verify-onchain.mjs 4663
```

## 4. Hand-over to the Safe

The deploy script already started a 2-step admin transfer on NeonFaces, NeonSeeder, NeonMinter, NeonArt. After the delay (2 days; NeonArt immediately):
```bash
node tools/safe-tx.mjs 4663 accept-admin     # import safe/4663-accept-admin.json in Safe > Transaction Builder
```

## 5. Fund the seed pool

Transfer the basket inventory to `NeonSeeder`. Check coverage per basket: `cast call <seeder> "coverage(uint32)(uint256)" <basketId>`.

## 6. Allowlists and phases

```bash
node tools/allowlist.mjs builders config/allowlists/builders.csv     # address,allowance
node tools/allowlist.mjs allowlist config/allowlists/allowlist.csv
node tools/safe-tx.mjs 4663 phase Builders 0 1111                     # free, max 1111 Faces
node tools/safe-tx.mjs 4663 phase Allowlist 0.012 2000
node tools/safe-tx.mjs 4663 phase Public 0.02 0 public 5              # 5 per wallet
node tools/export-web.mjs 4663                                        # site config
```
Agent actions for holders: copy `config/agent-presets.example.json` to `config/agent-presets.4663.json` with **verified** router / token addresses (see [AGENTS.md](AGENTS.md)); `export-web` publishes it.

Deploy the site: `web/public/{deployment.json, allowlist/, agent-presets.json}` are generated (git-ignored) by the two commands above — run them, then `npm run build` and host `dist/` on Vercel / Cloudflare Pages / Netlify (`/face/:id` rewrites included; on IPFS use `/#/face/:id`).

Open phases one at a time: `node tools/safe-tx.mjs 4663 open Builders` → `Allowlist` → `Public`.

## 7. Team allocation (before the reveal — minting closes for good at the reveal request)

```bash
RPC_URL=https://rpc.mainnet.chain.robinhood.com node tools/safe-tx.mjs 4663 team-mint <safe> 111
```
Mint + activate in the same Safe batch, ideally while the sale is paused or finished (ids are computed from `totalSupply`).

## 8. Close and reveal

1. `node tools/safe-tx.mjs 4663 open Finished` (terminal).
2. Start the watcher: `PK=<any funded key> node tools/reveal-watch.mjs 4663`.
3. Safe: `node tools/safe-tx.mjs 4663 reveal-request`. This closes minting forever; the watcher calls `reveal()` within the 25-second window. If missed, repeat step 3 once the window has passed.
4. Deliver the Stare top-ups: `PK=<any funded key> node tools/upgrade-all.mjs 4663` (permissionless, idempotent — needs the Watch / Heavy Stare inventory in the pool).
5. `node tools/verify-onchain.mjs 4663` → art and tiers visible in `tokenURI`.

## 9. After mint

- `node tools/safe-tx.mjs 4663 release` whenever — pushes 40/25/20/15 (anyone can).
- `lock-seeder` once baskets are final. `freeze-metadata` only when no future renderer is planned.
- OpenSea: the collection reads `contractURI()` on-chain; claim the collection with the Safe (owner() = Safe). List on HoodMarket too.
- Refill pending seeds: `NeonSeeder.fund(id)` is permissionless.
- Point holders to their Face page (`/face/<id>`): agent delegation and lock are there. Agent builders: [AGENTS.md](AGENTS.md).

## Rehearsal (do this first)

```bash
anvil --chain-id 46630 &                                  # local, free
RPC=http://127.0.0.1:8545 PK=<anvil key> ./contracts/script/rehearsal.sh
RPC=https://rpc.testnet.chain.robinhood.com PK=<testnet key> ./contracts/script/rehearsal.sh   # real testnet
```
