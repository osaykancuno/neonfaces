// The project's only moving part off-chain: keeps the seed pool stocked from the mint itself, delivers every
// pending seed, top-up and set bonus, pays the split and the team vesting, and refreshes marketplace metadata daily.
// Everything it calls is permissionless except the vault's `buy` (KEEPER_ROLE). Run it as a loop, or with --once
// from a scheduler (.github/workflows/keeper.yml runs it every 10 minutes, no server needed).
//
//   PK=<keeper key> node seed-keeper.mjs <chainId> [--once]
//   env: RPC_URL, INTERVAL (seconds, default 60), BUFFER (Faces to stock ahead, default 25), SLIPPAGE (bps, default 100),
//        SET_EVERY_MIN (minutes between set scans after the reveal, default 30), SET_BUFFER (set bonuses to stock ahead, default 5),
//        KEEPER_STATE (JSON file carried between --once runs, so a scheduled run doesn't re-read all 5555 Faces)
//
// Each round:
//   0. finalizes a requested reveal if its block hash is readable (the watcher's job, as a safety net),
//   1. pays every payee of NeonPayout and the team's vested share (anyone can),
//   2. works out what the pool needs: pending base seeds + a buffer for the next Faces, and after the reveal the
//      exact top-up basket of every Watch / Heavy Stare Face still waiting,
//   3. makes NeonSeedVault buy the missing tokens (NeonTrader: Uniswap v3, Chainlink-bounded, straight into the pool),
//   4. delivers pending seeds (activateBatch) and the top-ups the pool can cover (upgradeBatch),
//   5. after the reveal, delivers the one-time bonus of every assembled set (claimSetBonus), so holders don't have to,
//   6. once a day, `refreshMetadata()`: Unblinking days and the Gaze change with time, marketplaces need the nudge.
// The keeper key needs gas only. It can't move the vault's ETH anywhere but into the pool.
// Stock Token feeds only update on trading days: over a weekend the buys wait, the mint doesn't.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http, parseAbi, keccak256, encodeAbiParameters, formatEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const here = dirname(fileURLToPath(import.meta.url));
const chainId = Number(process.argv[2] ?? 4663);
const once = process.argv.includes("--once");
const INTERVAL = Number(process.env.INTERVAL ?? 60);
const BUFFER = Number(process.env.BUFFER ?? 25);
const SLIPPAGE = BigInt(process.env.SLIPPAGE ?? 100);
const SET_EVERY_MIN = Number(process.env.SET_EVERY_MIN ?? 30);
const STATE = process.env.KEEPER_STATE;
const SET_BUFFER = Number(process.env.SET_BUFFER ?? 5);
const MIN_BUY_USD8 = 2n * 10n ** 8n; // skip dust buys

const dep = JSON.parse(readFileSync(resolve(here, `../contracts/deployments/${chainId}.json`), "utf8"));
const cfg = JSON.parse(readFileSync(resolve(here, `../config/trader.${chainId}.json`), "utf8"));
const rpc = process.env.RPC_URL || { 4663: "https://rpc.mainnet.chain.robinhood.com" }[chainId];
if (!process.env.PK) throw new Error("set PK (keeper key: KEEPER_ROLE on NeonSeedVault, gas only)");
if (!dep.seedVault || !dep.trader) throw new Error("deployments file needs seedVault and trader");
const chain = { id: chainId, name: "robinhood", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpc] } } };
const pub = createPublicClient({ chain, transport: http(rpc, { batch: true }) });
const wallet = createWalletClient({ account: privateKeyToAccount(process.env.PK), chain, transport: http(rpc) });

const abi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function revealSeed() view returns (uint256)",
  "function seedOf(uint256) view returns ((address account, uint8 tier, uint32 basketId, uint32 upgradeBasketId, bool activated, bool funded, bool upgraded, (address token, uint256 amount)[] legs, (address token, uint256 amount)[] upgradeLegs))",
  "function tierBaskets(uint8) view returns (uint32[])",
  "function basket(uint32) view returns ((address token, uint256 amount)[])",
  "function activateBatch(uint256[] tokenIds)",
  "function upgradeBatch(uint256[] tokenIds) returns (uint256)",
  "function setOf(uint256) view returns (uint256 setId, uint256 piece, uint256[4] members)",
  "function isAssembled(uint256) view returns (bool)",
  "function setBonus(uint256) view returns (uint32 anchorId, uint32 basketId)",
  "function claimSetBonus(uint256 anchorId)",
  "function releasable(address) view returns (uint256)",
  "function release(address payee)",
  "function releaseAll()",
  "function releasable() view returns (uint256)",
  "function release()",
  "function revealBlock() view returns (uint256)",
  "function reveal()",
  "function lastMetadataRefresh() view returns (uint64)",
  "function refreshMetadata()",
  "function price(address) view returns (uint256)",
  "function buy(address[] path, uint24[] fees, uint256 ethIn, uint256 slippageBps) returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "error InsufficientPool(address token, uint256 needed, uint256 available)",
  "error StalePrice(address token, uint256 updatedAt)",
]);
const read = (address, functionName, args = []) => pub.readContract({ address, abi, functionName, args });
async function send(address, functionName, args) {
  const { request } = await pub.simulateContract({ address, abi, functionName, args, account: wallet.account });
  const hash = await wallet.writeContract(request);
  const r = await pub.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return hash;
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const WETH = cfg.weth.toLowerCase();
const USDG = cfg.tokens.find((t) => t.symbol === "USDG").address.toLowerCase();
const feeOf = Object.fromEntries(cfg.tokens.map((t) => [t.address.toLowerCase(), t.fee]));
const symOf = Object.fromEntries(cfg.tokens.map((t) => [t.address.toLowerCase(), t.symbol]));
const route = (token) => (token === USDG ? [[cfg.weth, token], [100]] : [[cfg.weth, USDG, token], [100, feeOf[token]]]);

// what we know about each Face, refreshed incrementally
const faces = new Map(); // id -> { funded, tier, upgraded }
let scanned = 0;
let lastSetScan = 0;
let unpaidSets = null; // setId -> [4 member ids], sets whose bonus is not paid yet (after the reveal)

// state carried between scheduled --once runs (Faces already known to be done are never re-read)
function loadState() {
  if (!STATE || !existsSync(STATE)) return;
  const j = JSON.parse(readFileSync(STATE, "utf8"));
  if (j.faces !== dep.faces) return; // another deployment
  scanned = j.scanned;
  lastSetScan = j.lastSetScan ?? 0;
  for (const [id, f] of j.known) faces.set(id, f);
  unpaidSets = j.unpaidSets ? new Map(j.unpaidSets.map(([k, v]) => [BigInt(k), v.map(BigInt)])) : null;
}
function saveState() {
  if (!STATE) return;
  const known = [...faces].filter(([, f]) => !f.funded || !f.tier || (f.tier >= 2 && !f.upgraded));
  // done Faces are dropped: `scanned` already marks them as seen
  writeFileSync(STATE, JSON.stringify({
    faces: dep.faces, scanned, lastSetScan, known,
    unpaidSets: unpaidSets && [...unpaidSets].map(([k, v]) => [String(k), v.map(String)]),
  }));
}

/** Anchors of assembled sets whose one-time bonus is unpaid: [{ anchor, setId }]. */
async function assembledSets(supply) {
  if (!unpaidSets) {
    unpaidSets = new Map();
    const ids = Array.from({ length: supply }, (_, i) => BigInt(i + 1));
    for (let i = 0; i < ids.length; i += 500) {
      const r = await Promise.all(ids.slice(i, i + 500).map((id) => read(dep.seeder, "setOf", [id])));
      for (const [setId, , members] of r) if (setId) unpaidSets.set(setId, members);
    }
  }
  const due = [];
  const sets = [...unpaidSets];
  for (let i = 0; i < sets.length; i += 100) {
    await Promise.all(sets.slice(i, i + 100).map(async ([setId, members]) => {
      const [anchor] = await read(dep.seeder, "setBonus", [setId]);
      if (anchor) return unpaidSets.delete(setId);
      const flags = await Promise.all(members.map((m) => read(dep.seeder, "isAssembled", [m])));
      const k = flags.indexOf(true);
      if (k >= 0) due.push({ anchor: members[k], setId });
    }));
  }
  return due;
}

async function refresh(ids) {
  const seeds = await Promise.all(ids.map((id) => read(dep.seeder, "seedOf", [BigInt(id)])));
  seeds.forEach((s, i) => faces.set(ids[i], { funded: s.funded, tier: s.tier, upgraded: s.upgraded }));
}

async function round() {
  // 0. a requested reveal nobody finalized yet (reveal-watch.mjs does it within seconds; this is the safety net)
  if (!(await read(dep.faces, "revealSeed")) && (await read(dep.faces, "revealBlock")) > 0n) {
    try {
      log("reveal", await send(dep.faces, "reveal", []));
    } catch (e) {
      log(`reveal not possible now (${e.shortMessage ?? e.message}): too early, or the window passed and the Safe must request again`);
    }
  }

  // 1. the mint money: every payee of the split (the vault first of all), then the team's vested share
  if ((await read(dep.payout, "releasable", [dep.seedVault])) > 0n) {
    log("pay the split", await send(dep.payout, "releaseAll", []));
  }
  if (dep.teamVesting && (await read(dep.teamVesting, "releasable")) > 10n ** 16n) {
    log("release vested team share", await send(dep.teamVesting, "release", []));
  }

  // 2. what the pool needs
  const supply = Number(await read(dep.faces, "totalSupply"));
  const revealSeed = await read(dep.faces, "revealSeed");
  const fresh = Array.from({ length: supply - scanned }, (_, i) => scanned + 1 + i);
  const open = [...faces].filter(([, f]) => !f.funded || (f.tier >= 2 && !f.upgraded) || (revealSeed && f.tier === 0)).map(([id]) => id);
  await refresh([...open, ...fresh]);
  scanned = supply;

  const baseIds = (await read(dep.seeder, "tierBaskets", [1])).map(Number);
  const legsOf = new Map();
  const legs = async (b) => legsOf.get(b) ?? legsOf.set(b, await read(dep.seeder, "basket", [b])).get(b);
  const pendingBase = [...faces].filter(([, f]) => !f.funded).map(([id]) => id);
  const pendingTop = new Map(); // id -> basketId
  if (revealSeed) {
    for (const t of [2, 3]) {
      const opts = (await read(dep.seeder, "tierBaskets", [t])).map(Number);
      for (const [id, f] of faces) {
        if (f.tier !== t || f.upgraded) continue;
        const k = BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [revealSeed, BigInt(id)])));
        pendingTop.set(id, opts[Number(k % BigInt(opts.length))]);
      }
    }
  }

  // sets: the bonus basket of every assembled set still unpaid (same draw as NeonSeeder.claimSetBonus)
  const bonusDue = new Map(); // anchor -> basketId
  let bonusOpts = [];
  if (revealSeed && Date.now() / 1000 - lastSetScan >= SET_EVERY_MIN * 60) {
    lastSetScan = Math.floor(Date.now() / 1000);
    bonusOpts = (await read(dep.seeder, "tierBaskets", [4])).map(Number);
    if (bonusOpts.length) {
      for (const { anchor, setId } of await assembledSets(supply)) {
        const k = BigInt(keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint8" }], [revealSeed, setId, 4])));
        bonusDue.set(anchor, bonusOpts[Number(k % BigInt(bonusOpts.length))]);
      }
    }
  }

  // needs per token: first what is owed now, then the buffer for the next Faces (the mint may still be open)
  const owed = new Map();
  const add = async (map, b, times) => {
    for (const l of await legs(b)) {
      const t = l.token.toLowerCase();
      map.set(t, (map.get(t) ?? 0n) + l.amount * BigInt(times));
    }
  };
  const perBase = Math.ceil(pendingBase.length / baseIds.length);
  for (const b of baseIds) await add(owed, b, perBase);
  for (const b of pendingTop.values()) await add(owed, b, 1);
  for (const b of bonusDue.values()) await add(owed, b, 1);
  const ahead = new Map(owed);
  if (!revealSeed) for (const b of baseIds) await add(ahead, b, Math.ceil(BUFFER / baseIds.length));
  else if (unpaidSets?.size > bonusDue.size) for (const b of bonusOpts) await add(ahead, b, Math.ceil(SET_BUFFER / bonusOpts.length));

  // 3. buy what is missing: one buy per token; if the vault can't cover the buffer too, what is owed comes first
  const pool = new Map();
  for (const t of ahead.keys()) pool.set(t, await read(t, "balanceOf", [dep.seeder]));
  let ethLeft = await pub.getBalance({ address: dep.seedVault });
  const ethFor = async (t, need) => {
    const missing = need - pool.get(t);
    if (missing <= 0n) return 0n;
    const [pt, pe] = await Promise.all([read(dep.trader, "price", [t]), read(dep.trader, "price", [WETH])]);
    const usd8 = (missing * pt) / 10n ** (t === USDG ? 6n : 18n);
    if (usd8 < MIN_BUY_USD8) return 0n;
    return (usd8 * 10n ** 18n * 103n) / (pe * 100n); // +3% for pool fees and slippage
  };
  let aheadCost = 0n;
  try {
    for (const [t, need] of ahead) aheadCost += await ethFor(t, need);
  } catch {}
  for (const needs of aheadCost <= ethLeft ? [ahead] : [owed, ahead]) {
    for (const [t, need] of needs) {
      if (ethLeft === 0n) break;
      let ethIn;
      try {
        ethIn = await ethFor(t, need);
      } catch (e) {
        log(`${symOf[t]}: no fresh price (${e.shortMessage ?? e.message}), waiting`);
        continue;
      }
      if (ethIn === 0n) continue;
      if (ethIn > ethLeft) ethIn = ethLeft;
      const [path, fees] = route(t);
      try {
        const hash = await send(dep.seedVault, "buy", [path, fees, ethIn, SLIPPAGE]);
        pool.set(t, await read(t, "balanceOf", [dep.seeder]));
        ethLeft -= ethIn;
        log(`bought ${symOf[t]} for ${formatEther(ethIn)} ETH`, hash);
      } catch (e) {
        log(`${symOf[t]}: buy failed (${e.shortMessage ?? e.message})`);
      }
    }
  }

  // 4. deliver (only when at least one base basket is in stock: activate never reverts, but gas isn't free)
  const covered = async (b) => (await legs(b)).every((x) => (pool.get(x.token.toLowerCase()) ?? 0n) >= x.amount);
  const anyBase = (await Promise.all(baseIds.map(covered))).some(Boolean);
  for (let i = 0; anyBase && i < pendingBase.length; i += 40) {
    const ids = pendingBase.slice(i, i + 40).map(BigInt);
    log(`seed ${ids.length} pending Faces`, await send(dep.seeder, "activateBatch", [ids]));
  }
  const ready = [];
  for (const [id, b] of pendingTop) {
    const l = await legs(b);
    if (l.every((x) => pool.get(x.token.toLowerCase()) >= x.amount)) {
      l.forEach((x) => pool.set(x.token.toLowerCase(), pool.get(x.token.toLowerCase()) - x.amount));
      ready.push(BigInt(id));
    }
  }
  for (let i = 0; i < ready.length; i += 60) {
    log(`top up ${Math.min(60, ready.length - i)} Faces`, await send(dep.seeder, "upgradeBatch", [ready.slice(i, i + 60)]));
  }
  if (pendingTop.size > ready.length) log(`${pendingTop.size - ready.length} top-ups wait for stock`);
  for (const [anchor, b] of bonusDue) {
    const l = await legs(b);
    if (!l.every((x) => (pool.get(x.token.toLowerCase()) ?? 0n) >= x.amount)) {
      log(`set bonus for #${anchor} waits for stock`);
      continue;
    }
    l.forEach((x) => pool.set(x.token.toLowerCase(), pool.get(x.token.toLowerCase()) - x.amount));
    try {
      log(`set bonus to #${anchor}`, await send(dep.seeder, "claimSetBonus", [anchor]));
    } catch (e) {
      log(`set bonus #${anchor}: ${e.shortMessage ?? e.message}`); // e.g. taken apart or paid meanwhile
    }
  }
  if (pendingBase.length) await refresh(pendingBase);

  // 6. daily metadata refresh for marketplaces (time-based traits emit no event of their own)
  if (supply && Date.now() / 1000 >= Number(await read(dep.faces, "lastMetadataRefresh")) + 86_400) {
    try {
      log("refresh marketplace metadata", await send(dep.faces, "refreshMetadata", []));
    } catch (e) {
      log(`refresh skipped (${e.shortMessage ?? e.message})`);
    }
  }
  const stillPending = [...faces].filter(([, f]) => !f.funded).length;
  log(`supply ${supply} · pending seeds ${stillPending} · vault ${formatEther(await pub.getBalance({ address: dep.seedVault }))} ETH`);
}

loadState();
do {
  try {
    await round();
  } catch (e) {
    log("round failed:", e.shortMessage ?? e.message);
  }
  saveState();
  if (!once) await new Promise((r) => setTimeout(r, INTERVAL * 1000));
} while (!once);
