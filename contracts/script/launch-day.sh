#!/usr/bin/env bash
# Launch day on a local node: every on-chain process in the real order, at the real price, each check PASS/FAIL.
#
#   anvil --chain-id 46630 --port 8548 &        # a fresh node (several art uploads on one node raise its base fee)
#   ./contracts/script/launch-day.sh
#
# Sale through SeaDrop from 6 wallets -> keeper -> team mint -> reveal by a stranger -> top-ups -> a set gathered,
# assembled (bonus in the last transfer), voted and fused -> a Face account: withdraw, NeonTrader trade, daily cap,
# lock, resale -> split, vesting, royalties -> 31 days later (Gaze, vesting) -> hand-over to a stand-in Safe after the
# 2-day delay, lockConfig, pool reserve, releaseSurplus. Wallets are anvil's public test accounts (never real keys).
# Leaves web/public/deployment.json on this node (the site shows it) and restores the tracked testnet addresses.
set -uo pipefail
export PATH="$PATH:$HOME/.foundry/bin"
cd "$(dirname "$0")/../.."
SP=${TMPDIR:-/tmp}
R=${RPC:-http://127.0.0.1:8548}
[[ "$R" == *127.0.0.1* || "$R" == *localhost* ]] || { echo "local node only"; exit 1; }
key() { cast wallet private-key --mnemonic "test test test test test test test test test test test junk" --mnemonic-index "$1"; }
addr() { cast wallet address "$1"; }
K0=$(key 0); D0=$(addr $K0)            # deployer (admin until the hand-over, keeper, pollster locally)
K9=$(key 9); SAFE=$(addr $K9)          # stands in for the treasury Safe
FAILS=0
ok() { if [[ "$1" == "$2" ]]; then echo "PASS  $3"; else echo "FAIL  $3 (got '$1', want '$2')"; FAILS=$((FAILS + 1)); fi; }
reverts() { # reverts "<what>" <from> <to> <sig> [args...]
  local what=$1 from=$2; shift 2
  local out
  if out=$(cast call --from "$from" "$@" --rpc-url $R 2>&1); then echo "FAIL  $what (did not revert)"; FAILS=$((FAILS + 1));
  elif echo "$out" | grep -q "execution reverted"; then echo "PASS  $what (reverts: $(echo "$out" | grep -oE 'execution reverted[^,]*' | head -1 | cut -c21-90))";
  else echo "FAIL  $what (call error, not a revert: $(echo "$out" | head -1 | cut -c1-120))"; FAILS=$((FAILS + 1)); fi
}
send() { local k=$1; shift; [[ -n "$k" ]] || { echo "FAIL  empty key for $*"; FAILS=$((FAILS + 1)); return; }; cast send "$@" --rpc-url $R --private-key "$k" >/dev/null || { echo "FAIL  tx $*"; FAILS=$((FAILS + 1)); }; }
call() { cast call "$@" --rpc-url $R | cut -d' ' -f1; }
attr() { cast call $F "tokenURI(uint256)(string)" $1 --rpc-url $R | python -c "
import sys,json,base64;s=sys.stdin.read().strip().strip('\"');a={x['trait_type']:x['value'] for x in json.loads(base64.b64decode(s.split(',',1)[1]))['attributes']};print(a.get('''$2''','-'))"; }
warp() { cast rpc evm_increaseTime $1 --rpc-url $R >/dev/null; cast rpc anvil_mine 1 --rpc-url $R >/dev/null; }
keeper() { (cd tools && RPC_URL=$R KEEPER_STATE=$SP/keeper-launch.json PK=$K0 timeout 300 node seed-keeper.mjs 46630 --once 2>&1 | sed 's/^/        keeper: /' | tail -8); }

echo "=== 1. deploy + art (real price 0.011 ETH)"
rm -f $SP/keeper-launch.json
[[ -n "$K0" && -n "$K9" ]] || { echo "FAIL  keys"; exit 1; }
PRICE=11000000000000000 MINT=0 REVEAL=0 RPC=$R PK=$K0 ./contracts/script/rehearsal.sh > $SP/launch-rehearsal.log 2>&1 || { echo "FAIL  deploy"; tail -5 $SP/launch-rehearsal.log; exit 1; }
grep -E "sealed|NeonFaces |NeonTrader" $SP/launch-rehearsal.log
DEP=contracts/deployments/46630.json
j() { python -c "import json;print(json.load(open('$DEP'))['$1'])"; }
F=$(j faces); S=$(j seeder); V=$(j seedVault); P=$(j payout); VOTES=$(j setVotes); VEST=$(j teamVesting); ART=$(j art); T=$(j trader)
tok() { python -c "import json;print(next(t['address'] for t in json.load(open('config/trader.46630.json'))['tokens'] if t['symbol']=='$1'))"; }
fee() { python -c "import json;print(next(t['fee'] for t in json.load(open('config/trader.46630.json'))['tokens'] if t['symbol']=='$1'))"; }
WETH=$(tok WETH); USDG=$(tok USDG); TSLA=$(tok TSLA)
SEADROP=0x00005EA00Ac477B1030CE78506496e8C2dE24bf5; FEEREC=0x976EA74026E726554dB657fA54763abd0C3a0aa9
ok "$(call $F 'provenanceHash()(bytes32)')" "$(python -c "import json;print(json.load(open('art/output/provenance.json'))['provenanceHash'])")" "provenance committed before the first mint"

echo "=== 2. sale through SeaDrop from 6 wallets (0.011 ETH each)"
declare -A KEYOF; KEYOF[$D0]=$K0
for pair in 1:20 4:20 5:15 6:10 7:10 8:5; do
  k=$(key ${pair%%:*}); n=${pair##*:}; KEYOF[$(addr $k)]=$k
  send $k $SEADROP "mintPublic(address,address,address,uint256)" $F $FEEREC 0x0000000000000000000000000000000000000000 $n --value $((11000000000000000 * n))
done
ok "$(call $F 'totalSupply()(uint256)')" 80 "80 Faces sold"
reverts "a 21st Face for one wallet (20/wallet stage)" $(addr $(key 1)) $SEADROP "mintPublic(address,address,address,uint256)" $F $FEEREC 0x0000000000000000000000000000000000000000 1 --value 11000000000000000
reverts "mint with a fee recipient OpenSea didn't allow" $(addr $(key 8)) $SEADROP "mintPublic(address,address,address,uint256)" $F $(addr $(key 1)) 0x0000000000000000000000000000000000000000 1 --value 11000000000000000
reverts "admin can't allow a new minter once the sale started" $D0 $F "updateAllowedSeaDrop(address[])" "[$D0]"
PAY_BAL=$(cast balance $P --rpc-url $R)
ok "$PAY_BAL" $(python -c "print(80 * 11000000000000000 * 90 // 100)") "NeonPayout holds 90% of the sales (10% OpenSea fee)"

echo "=== 3. keeper during the sale: split, buys, seeds"
keeper
PENDING=0; for id in $(seq 1 80); do [[ "$(attr $id 'Seed Status')" == Funded ]] || PENDING=$((PENDING + 1)); done
ok $PENDING 0 "every sold Face holds its base seed"

echo "=== 4. team mint (111), then reveal"
for _ in 1 2 3; do send $K0 $F "teamMint(address,uint256)" $D0 37; done
reverts "team mint beyond 111" $D0 $F "teamMint(address,uint256)" $D0 1
keeper
send $K0 $F "requestReveal()"
reverts "mint after requestReveal (mint closed)" $(addr $(key 8)) $SEADROP "mintPublic(address,address,address,uint256)" $F $FEEREC 0x0000000000000000000000000000000000000000 1 --value 11000000000000000
reverts "reveal before the target block" $D0 $F "reveal()"
cast rpc anvil_mine 8 --rpc-url $R >/dev/null
send $(key 8) $F "reveal()"   # anyone finalizes
[[ "$(call $F 'revealSeed()(uint256)')" != 0 ]] && echo "PASS  revealed by a stranger" || { echo "FAIL  reveal"; FAILS=$((FAILS + 1)); }
N=$(call $F 'totalSupply()(uint256)'); ok $N 191 "supply 191 (80 sold + 111 team)"

echo "=== 5. keeper after the reveal: top-ups and set bonuses"
keeper; keeper
ok "$(call $S 'covered()(bool)')" true "pool covers everything owed to Faces"
WAIT=0; for id in $(seq 1 $N); do s=$(attr $id 'Stare'); u=$(attr $id 'Stare Upgrade'); [[ "$s" != Glance && "$u" == - ]] && WAIT=$((WAIT + 1)); done
ok $WAIT 0 "every Watch / Heavy Stare Face got its top-up"

echo "=== 6. sets: assemble, bonus, replay, vote, fuse"
SET=""; for id in $(seq 1 $N); do
  out=$(cast call $S 'setOf(uint256)(uint256,uint256,uint256[4])' $id --rpc-url $R | tr '
' ' ')
  set -- $out; [[ "$1" == 0 || "$2" != 0 ]] && continue
  SET=$1; ANCHOR=$id; MEMBERS=$(echo "$out" | grep -oE '\[.*\]' | tr -d '[],'); OWNER=$(call $F 'ownerOf(uint256)(address)' $id)
  [[ "$OWNER" != "$D0" ]] && break
done
echo "      collector $OWNER gathers set $SET (pieces $MEMBERS)"
for x in $MEMBERS; do
  o=$(call $F 'ownerOf(uint256)(address)' $x)
  [[ "$o" != "$OWNER" ]] && send ${KEYOF[$o]} $F "transferFrom(address,address,uint256)" $o $OWNER $x
done
KO=${KEYOF[$OWNER]}
echo "      set $SET: anchor #$ANCHOR, pieces $MEMBERS, holder $OWNER"
send $KO $F "assembleSet(uint256)" $ANCHOR
ok "$(call $S 'isAssembled(uint256)(bool)' $ANCHOR)" true "assembleSet in one transaction"
ok "$(attr $ANCHOR 'Set Status')" Assembled "metadata: Set Status Assembled"
[[ "$(attr $ANCHOR 'Set Bonus')" != - ]] && echo "PASS  set bonus paid inside the last transfer ($(attr $ANCHOR 'Set Bonus'))" || { echo "FAIL  set bonus"; FAILS=$((FAILS + 1)); }
reverts "set bonus can't be claimed twice" $OWNER $S "claimSetBonus(uint256)" $ANCHOR
NOW=$(cast block latest -f timestamp --rpc-url $R)
send $K0 $VOTES "createPoll(string,string[],uint64,uint64)" "Which basket next?" '["Gold","Bitcoin"]' $NOW $((NOW + 7 * 86400))
send $KO $VOTES "vote(uint256,uint256,uint256)" 0 $ANCHOR 1
ok "$(call $VOTES 'voteOf(uint256,uint256)(uint256)' 0 $SET)" 1 "the assembled set voted (choice index 1)"
reverts "a Face that is not an assembled anchor can't vote" $(addr $(key 1)) $VOTES "vote(uint256,uint256,uint256)" 0 1 0
reverts "only the pollster asks" $(addr $(key 1)) $VOTES "createPoll(string,string[],uint64,uint64)" "x" '["a","b"]' $NOW $((NOW + 100))
send $KO $S "fuse(uint256)" $ANCHOR
ok "$(attr $ANCHOR 'Set Status')" Fused "fused for good"
AACC=$(call $S 'accountOf(uint256)(address)' $ANCHOR); PIECE=$(echo $MEMBERS | tr ' ' '\n' | grep -vx $ANCHOR | head -1)
reverts "a piece can't leave a fused anchor" $OWNER $AACC "execute(address,uint256,bytes,uint8)" $F 0 $(cast calldata "transferFrom(address,address,uint256)" $AACC $OWNER $PIECE) 0

echo "=== 7. a holder's own account: withdraw, trade, lock, resale"
K1=$(key 1); H1=$(addr $K1); FACE=""
for id in $(seq 1 20); do s=$(attr $id Seed); [[ "$(call $F 'ownerOf(uint256)(address)' $id)" == "$H1" && ( "$s" == TSLA || "$s" == NVDA ) ]] && { FACE=$id; SEED=$s; break; }; done
A=$(call $S 'accountOf(uint256)(address)' $FACE); ST=$(tok $SEED)
echo "      Face #$FACE (seed $SEED), account $A"
if [[ -n "$ST" ]]; then
  b=$(call $ST 'balanceOf(address)(uint256)' $A)
  send $K1 $A "execute(address,uint256,bytes,uint8)" $ST 0 $(cast calldata "transfer(address,uint256)" $H1 $((b / 2))) 0
  ok "$(call $ST 'balanceOf(address)(uint256)' $H1)" $((b / 2)) "holder withdrew half of its $SEED from Face #$FACE"
fi
reverts "a stranger can't use the account" $(addr $(key 4)) $A "execute(address,uint256,bytes,uint8)" $H1 0 0x 0
send $K1 $A "execute(address,uint256,bytes,uint8)" $T 0 $(cast calldata "setDailyLimit(uint256)" 10000000000) 0   # $100/day
cast send $A --value 1000000000000000 --rpc-url $R --private-key $K1 >/dev/null
BEFORE=$(call $TSLA 'balanceOf(address)(uint256)' $A)
send $K1 $A "execute(address,uint256,bytes,uint8)" $T 1000000000000000 $(cast calldata "swapWithNote(address[],uint24[],uint256,uint256,string)" "[$WETH,$USDG,$TSLA]" "[$(fee WETH),$(fee TSLA)]" 1000000000000000 100 "first trade") 0
AFTER=$(call $TSLA 'balanceOf(address)(uint256)' $A)
python -c "import sys; sys.exit(0 if int('$AFTER') > int('$BEFORE') else 1)" && echo "PASS  NeonTrader swap ETH -> TSLA from the account, with a note" || { echo "FAIL  swap"; FAILS=$((FAILS + 1)); }
cast send $A --value 200000000000000000 --rpc-url $R --private-key $K1 >/dev/null
reverts "a trade above the account's daily cap (\$100)" $H1 $A "execute(address,uint256,bytes,uint8)" $T 100000000000000000 $(cast calldata "swap(address[],uint24[],uint256,uint256)" "[$WETH,$USDG,$TSLA]" "[$(fee WETH),$(fee TSLA)]" 100000000000000000 100) 0
NOW=$(cast block latest -f timestamp --rpc-url $R)
send $K1 $A "lock(uint64)" $((NOW + 3 * 86400))
reverts "locked account: no withdrawals" $H1 $A "execute(address,uint256,bytes,uint8)" $H1 1 0x 0
H4=$(addr $(key 4))
send $K1 $F "transferFrom(address,address,uint256)" $H1 $H4 $FACE
ok "$(call $A 'holder()(address)')" $H4 "the account follows the Face to the buyer"
[[ "$(attr $FACE 'Locked Until')" != - ]] && echo "PASS  the lock survives the sale (Locked Until in the metadata)" || { echo "FAIL  lock trait"; FAILS=$((FAILS + 1)); }
reverts "the old holder lost the account" $H1 $A "execute(address,uint256,bytes,uint8)" $H1 1 0x 0
ok "$(attr $FACE 'Unblinking Days')" 0 "Unblinking days restart with the new holder"
reverts "public restock when nothing is owed" $H4 $V "restock(address[],uint24[])" "[$WETH,$USDG,$TSLA]" "[$(fee WETH),$(fee TSLA)]"
reverts "refreshMetadata twice in a day" $H4 $F "refreshMetadata()"

echo "=== 8. money: split, vesting, royalties"
send $(key 8) $P "releaseAll()"
TEAM=$(cast balance $VEST --rpc-url $R); GROWTH=$(cast balance 0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65 --rpc-url $R)
echo "      vesting wallet holds $(cast from-wei $TEAM) ETH (15% of $(cast from-wei $PAY_BAL))"
ok "$TEAM" $(python -c "print($PAY_BAL * 15 // 100)") "team 15% sits in the 6-month VestingWallet"
ROY=$(cast call $F 'royaltyInfo(uint256,uint256)(address,uint256)' 1 1000000000000000000 --rpc-url $R | tail -1 | cut -d' ' -f1)
ok "$ROY" 50000000000000000 "royalties 5% (ERC-2981)"

echo "=== 9. time passes: 31 days"
warp $((31 * 86400))
send $(key 8) $F "refreshMetadata()"
echo "      Face #2 after 31 days: Unblinking Days $(attr 2 'Unblinking Days'), Gaze $(attr 2 'Gaze')"
B0=$(cast balance 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc --rpc-url $R)
send $(key 8) $VEST "release()"
python -c "import sys; sys.exit(0 if int('$(cast balance 0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc --rpc-url $R)') > int('$B0') else 1)" && echo "PASS  vested ETH released to the team beneficiary" || { echo "FAIL  vesting release"; FAILS=$((FAILS + 1)); }
send $(key 4) $A "execute(address,uint256,bytes,uint8)" $H4 1000 0x 0 && echo "PASS  lock expired: the new holder takes ETH out of the account"

echo "=== 10. hand-over to the Safe (2-day delay), then the Safe's jobs"
for c in $F $S $V $ART; do send $K0 $c "beginDefaultAdminTransfer(address)" $SAFE; done
reverts "the Safe can't accept before 2 days" $SAFE $F "acceptDefaultAdminTransfer()"
warp $((2 * 86400 + 10))
for c in $F $S $V $ART; do send $K9 $c "acceptDefaultAdminTransfer()"; done
ok "$(call $F 'defaultAdmin()(address)')" $SAFE "Safe is admin of NeonFaces"
ok "$(call $S 'defaultAdmin()(address)')" $SAFE "Safe is admin of NeonSeeder"
ok "$(call $V 'defaultAdmin()(address)')" $SAFE "Safe is admin of NeonSeedVault"
ok "$(call $ART 'defaultAdmin()(address)')" $SAFE "Safe is admin of NeonArt"
reverts "the deployer is no longer admin" $D0 $S "lockConfig()"
send $K9 $S "lockConfig()"
ok "$(call $S 'configLocked()(bool)')" true "baskets locked by the Safe"
SEEDT=""; for sym in TSLA NVDA SPY USDG; do t=$(tok $sym); [[ "$(call $S 'owed(address)(uint256)' $t)" != 0 ]] && { SEEDT=$t; SYMW=$sym; break; }; done
PB=$(call $SEEDT 'balanceOf(address)(uint256)' $S); echo "      pool holds $PB $SYMW, owed $(call $S 'owed(address)(uint256)' $SEEDT)"
reverts "the Safe can't withdraw what Faces are owed" $SAFE $S "withdrawPool(address,address,uint256)" $SEEDT $SAFE $PB
VB=$(cast balance $V --rpc-url $R)
if [[ "$VB" != 0 ]]; then send $K9 $V "releaseSurplus(uint256)" $VB; ok "$(cast balance $V --rpc-url $R)" 0 "vault surplus released to the treasury ($(cast from-wei $VB) ETH)"; fi
send $K9 $F "setSaleManager(address)" 0x0000000000000000000000000000000000000000
git checkout -- contracts/deployments/46630.json # rehearsal.sh overwrote the tracked testnet addresses
echo
echo "=== $FAILS failure(s)"
