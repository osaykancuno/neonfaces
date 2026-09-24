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
# Steps: deploy (mock tokens) -> upload + seal the 5555 Faces -> Builders allowlist phase (free)
# -> Public phase config -> export deployment.json for the site -> mint 20 Faces -> reveal.
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

export ADMIN="${ADMIN:-$DEPLOYER}"
export ROYALTY_RECEIVER="${ROYALTY_RECEIVER:-$DEPLOYER}"
export SEED_VAULT="${SEED_VAULT:-0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC}"
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
MINTER=$(jqr minter); FACES=$(jqr faces)

# Builders allowlist for the rehearsal: the deployer (+ addresses in ../config/allowlists/builders.csv)
ALCSV=$(mktemp); printf 'address,allowance\n%s,20\n' "$DEPLOYER" > "$ALCSV"
[[ -f ../config/allowlists/builders.csv ]] && tail -n +2 ../config/allowlists/builders.csv >> "$ALCSV"
(cd ../tools && node allowlist.mjs builders "$ALCSV" >/dev/null)
ROOT=$(python -c "import json;print(json.load(open('../web/public/allowlist/builders.json'))['root'])")
PROOF=$(python -c "import json;d=json.load(open('../web/public/allowlist/builders.json'));print('['+','.join(d['entries']['$(echo "$DEPLOYER" | tr A-Z a-z)']['proof'])+']')")

send() { cast send "$@" --rpc-url "$RPC" --private-key "$PK" >/dev/null; }
send "$MINTER" "configurePhase(uint8,uint128,uint32,uint32,bytes32)" 1 0 0 1111 "$ROOT"
send "$MINTER" "configurePhase(uint8,uint128,uint32,uint32,bytes32)" 3 20000000000000000 5 0 0x0000000000000000000000000000000000000000000000000000000000000000
send "$MINTER" "setPhase(uint8)" 1
echo "== Builders phase open (free, cap 1111), Public configured (0.02 ETH, 5/wallet)"

EXPORT_RPC=$([[ $LOCAL == 1 ]] && echo "$RPC" || echo "")
(cd ../tools && node export-web.mjs "$CHAIN_ID" $EXPORT_RPC >/dev/null)
echo "== web/public/deployment.json written"

if [[ "${MINT:-1}" == 1 ]]; then
  send "$MINTER" "mint(uint256,uint256,bytes32[])" 10 20 "$PROOF"
  send "$MINTER" "mint(uint256,uint256,bytes32[])" 10 20 "$PROOF"
  echo "== minted 20 Faces: supply $(cast call "$FACES" 'totalSupply()(uint256)' --rpc-url "$RPC")"
fi

if [[ "${REVEAL:-1}" == 1 ]]; then
  send "$FACES" "requestReveal()"
  # 5 blocks at 100 ms, and the block hash stays readable for 256 blocks (~25 s): reveal promptly
  if [[ $LOCAL == 1 ]]; then cast rpc anvil_mine 8 --rpc-url "$RPC" >/dev/null; else sleep 3; fi
  send "$FACES" "reveal()"
  echo "== revealed, seed $(cast call "$FACES" 'revealSeed()(uint256)' --rpc-url "$RPC")"
fi
echo "== done. Run the site: npm --prefix ../web run dev"
