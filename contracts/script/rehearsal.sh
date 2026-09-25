#!/usr/bin/env bash
# Full launch rehearsal on a local fork or on Robinhood Chain testnet (46630), with mock Stock Tokens.
#
#   # local node (no funds needed; the canonical ERC-6551 registry bytecode is installed automatically):
#   anvil --chain-id 46630 &
#   RPC=http://127.0.0.1:8545 PK=0xac09...ff80 ./script/rehearsal.sh
#   (prefer plain anvil over --fork-url: anvil only partially emulates Arbitrum's ArbSys precompile)
#
#   # real testnet (deployer needs testnet ETH):
#   RPC=https://rpc.testnet.chain.robinhood.com PK=<deployer key> ./script/rehearsal.sh
#
# Steps: deploy (mock tokens) -> upload + seal the 5555 Faces -> configure the SeaDrop public stage the way
# OpenSea Studio does (payout = NeonPayout, OpenSea fee recipient, price) -> export deployment.json for the site
# -> mint 20 Faces through SeaDrop (what OpenSea's mint button calls) -> reveal -> Stare top-ups.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${RPC:?set RPC}"
: "${PK:?set PK (deployer private key)}"
DEPLOYER=$(cast wallet address "$PK")
CHAIN_ID=$(cast chain-id --rpc-url "$RPC")
LOCAL=$([[ "$RPC" == *127.0.0.1* || "$RPC" == *localhost* ]] && echo 1 || echo 0)

REGISTRY=0x000000006551c19487814612e58FE06813775758
if [[ $LOCAL == 1 && "$(cast code $REGISTRY --rpc-url "$RPC")" == "0x" ]]; then
  cast rpc anvil_setCode $REGISTRY "$(tr -d '[:space:]' < test/fixtures/erc6551-registry.hex)" --rpc-url "$RPC" >/dev/null
  echo "== installed canonical ERC-6551 registry bytecode (from mainnet) at $REGISTRY"
fi
SEADROP=0x00005EA00Ac477B1030CE78506496e8C2dE24bf5
if [[ $LOCAL == 1 && "$(cast code $SEADROP --rpc-url "$RPC")" == "0x" ]]; then
  # 21 KB of bytecode is too long for a Windows command line: pipe the RPC call through stdin
  printf '{"jsonrpc":"2.0","id":1,"method":"anvil_setCode","params":["%s","%s"]}' $SEADROP "$(tr -d '[:space:]' < test/fixtures/seadrop.hex)"     | curl -s -X POST -H 'content-type: application/json' --data @- "$RPC" >/dev/null
  cast rpc anvil_setStorageAt $SEADROP 0x0 0x0000000000000000000000000000000000000000000000000000000000000001 --rpc-url "$RPC" >/dev/null # reentrancy guard
  echo "== installed OpenSea SeaDrop bytecode (from mainnet) at $SEADROP"
fi

export ADMIN="${ADMIN:-$DEPLOYER}"
export ROYALTY_RECEIVER="${ROYALTY_RECEIVER:-$DEPLOYER}"
export TREASURY="${TREASURY:-0x90F79bf6EB2c4f870365E785982E1f101E93b906}"
export GROWTH="${GROWTH:-0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65}"
export TEAM_BENEFICIARY="${TEAM_BENEFICIARY:-0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc}"
export SITE_URL="${SITE_URL:-http://localhost:5173/}"
export USE_MOCK_TOKENS=true

echo "== chain $CHAIN_ID, deployer $DEPLOYER"
forge script script/Deploy.s.sol --rpc-url "$RPC" --private-key "$PK" --broadcast --slow >${TMPDIR:-/tmp}/nf-deploy.log 2>&1 || { tail -30 ${TMPDIR:-/tmp}/nf-deploy.log; exit 1; }
grep -E "Neon|written" ${TMPDIR:-/tmp}/nf-deploy.log
forge script script/UploadArt.s.sol --rpc-url "$RPC" --private-key "$PK" --broadcast --slow >${TMPDIR:-/tmp}/nf-upload.log 2>&1 || { tail -30 ${TMPDIR:-/tmp}/nf-upload.log; exit 1; }
echo "== art uploaded and sealed: $(grep -oE '0x[0-9a-f]{64}' ${TMPDIR:-/tmp}/nf-upload.log | tail -1)"

DEP="deployments/$CHAIN_ID.json"
jqr() { python -c "import json,sys;print(json.load(open('$DEP'))['$1'])"; }
PAYOUT=$(jqr payout); FACES=$(jqr faces)
# stands in for OpenSea's fee recipient; on OpenSea, Studio sets the real one
FEE_RECIPIENT="${FEE_RECIPIENT:-0x976EA74026E726554dB657fA54763abd0C3a0aa9}"
PRICE="${PRICE:-100000000000000}" # 0.0001 ETH keeps a testnet rehearsal cheap

send() { cast send "$@" --rpc-url "$RPC" --private-key "$PK" >/dev/null; }
NOW=$(cast block latest -f timestamp --rpc-url "$RPC")
send "$FACES" "updateCreatorPayoutAddress(address,address)" "$SEADROP" "$PAYOUT"
send "$FACES" "updateAllowedFeeRecipient(address,address,bool)" "$SEADROP" "$FEE_RECIPIENT" true
send "$FACES" "updatePublicDrop(address,(uint80,uint48,uint48,uint16,uint16,bool))" "$SEADROP" "($PRICE,$NOW,$((NOW + 30 * 86400)),20,1000,true)"
echo "== SeaDrop public stage live (price $PRICE wei, 20/wallet, 10% fee), payout -> NeonPayout $PAYOUT"

EXPORT_RPC=$([[ $LOCAL == 1 ]] && echo "$RPC" || echo "")
(cd ../tools && node export-web.mjs "$CHAIN_ID" $EXPORT_RPC >/dev/null)
echo "== web/public/deployment.json written"

# demo agent actions (test router + mock tokens) so the holder panel can be tried end to end
SEEDER=$(jqr seeder)
TSLA=$(cast call "$SEEDER" "basket(uint32)((address,uint256)[])" 1 --rpc-url "$RPC" | grep -oE "0x[0-9a-fA-F]{40}" | head -1)
USDG=$(cast call "$SEEDER" "basket(uint32)((address,uint256)[])" 4 --rpc-url "$RPC" | grep -oE "0x[0-9a-fA-F]{40}" | tail -1)
ROUTER=$(forge create test/mocks/MockRouter.sol:MockRouter --rpc-url "$RPC" --private-key "$PK" --broadcast 2>/dev/null | grep "Deployed to" | awk '{print $3}')
send "$USDG" "mint(address,uint256)" "$ROUTER" 1000000000000000000000000
send "$TSLA" "mint(address,uint256)" "$ROUTER" 1000000000000000000000
cat > ../web/public/agent-presets.json <<JSON
{ "presets": [
  { "id": "buy-usdg", "title": "Buy USDG with ETH (test router)", "plain": "Your agent can spend ETH from this Face's wallet, up to your limit, to buy test USDG. What it buys stays in the Face.", "risk": "low", "needsEth": true,
    "calls": [{ "target": "$ROUTER", "signature": "buyWithETH(address)", "label": "Buy tokens with ETH on the test router" }] },
  { "id": "swap-tsla", "title": "Swap TSLA into USDG (test router)", "plain": "Your agent can turn test TSLA held by this Face into test USDG. The USDG comes back into the Face.", "risk": "low", "needsEth": false,
    "approvals": [{ "token": "$TSLA", "spender": "$ROUTER", "label": "test TSLA" }],
    "calls": [{ "target": "$ROUTER", "signature": "swap(address,address,uint256)", "label": "Swap tokens on the test router" }] }
] }
JSON
echo "== demo agent actions published (test router $ROUTER)"

if [[ "${MINT:-1}" == 1 ]]; then
  for _ in 1 2; do
    send "$SEADROP" "mintPublic(address,address,address,uint256)" "$FACES" "$FEE_RECIPIENT" 0x0000000000000000000000000000000000000000 10 --value $((PRICE * 10))
  done
  echo "== minted 20 Faces through SeaDrop: supply $(cast call "$FACES" 'totalSupply()(uint256)' --rpc-url "$RPC"), NeonPayout holds $(cast balance "$PAYOUT" --rpc-url "$RPC") wei"
fi

if [[ "${REVEAL:-1}" == 1 ]]; then
  send "$FACES" "requestReveal()"
  # 5 blocks at 100 ms, and the block hash stays readable for 256 blocks (~25 s): reveal promptly
  if [[ $LOCAL == 1 ]]; then cast rpc anvil_mine 8 --rpc-url "$RPC" >/dev/null; else sleep 3; fi
  send "$FACES" "reveal()"
  echo "== revealed, seed $(cast call "$FACES" 'revealSeed()(uint256)' --rpc-url "$RPC")"
  (cd ../tools && RPC_URL="$RPC" PK="$PK" node upgrade-all.mjs "$CHAIN_ID" | tail -2)
fi
echo "== done. Run the site: npm --prefix ../web run dev"
