// Minting on this site, through OpenSea's SeaDrop contract: the stages are configured on-chain by the sale manager
// with tools/seadrop-drop.mjs, and this panel calls SeaDrop directly, as OpenSea's own page does. On only when
// /drop/params.json is published; without it the panel links to OpenSea.
//
// The NEONLIST (10 Oct, the founder): SeaDrop's public stage, 0.004 ETH a Face, up to 15 per wallet in total, from
// Tue 13 Oct 13:00 UTC to Sat 31 Oct 18:00 UTC; a wallet mints with mintPublic, no proof. Every rule is enforced by
// SeaDrop, not here (the window, the price, the per-wallet limit): this panel reads the chain and shows what the
// contract will accept, so nobody signs a transaction that would fail.
//
// The check (The Stare): before the NEONLIST opens, a connected wallet is checked for what minting needs, read live:
// Robinhood Chain in the wallet, ETH on Robinhood Chain for at least one Face and its gas, Faces left of its 15.
// #419's eye opens on the wallet as the checks pass: wide and lit when it is ready, half open on what is missing.
import { parseAbi, parseEther, formatEther, formatUnits, parseEventLogs } from "viem";
import { state, ensureChain, short, read, readAt, metadata, explorer } from "./chain.js";
import { chamber, terminal, birth } from "./effects/birth.js";
import { pixelEye } from "./effects/eye.js";

export const SEADROP = parseAbi([
  "function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable",
  "function getPublicDrop(address nftContract) view returns ((uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))",
  // SeaDrop 1.0's errors, and NeonFaces' own that bubble up through it
  "error NotActive(uint256 currentTimestamp, uint256 startTimestamp, uint256 endTimestamp)",
  "error MintQuantityCannotBeZero()",
  "error MintQuantityExceedsMaxMintedPerWallet(uint256 total, uint256 allowed)",
  "error MintQuantityExceedsMaxSupply(uint256 total, uint256 maxSupply)",
  "error MintQuantityExceedsMaxTokenSupplyForStage(uint256 total, uint256 maxTokenSupplyForStage)",
  "error FeeRecipientNotAllowed()",
  "error IncorrectPayment(uint256 got, uint256 want)",
  "error PayerNotAllowed()",
  "error MintIsPaused()",
  "error MintIsClosed()",
  "error ExceedsPublicAllocation()",
]);
const FACES = parseAbi([
  "function getMintStats(address minter) view returns (uint256 minterNumMinted, uint256 currentTotalSupply, uint256 maxSupply)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);
const ZERO = "0x0000000000000000000000000000000000000000";

export const MINT_ERRORS = {
  NotActive: "The NEONLIST isn't open right now.",
  MintQuantityExceedsMaxMintedPerWallet: ([total, allowed]) => `That would make ${total} Faces for this wallet: the limit is ${allowed}.`,
  MintQuantityExceedsMaxSupply: "Not that many Faces are left: try a smaller number.",
  MintQuantityExceedsMaxTokenSupplyForStage: "Not that many Faces are left: try a smaller number.",
  ExceedsPublicAllocation: "Not that many Faces are left: try a smaller number.",
  IncorrectPayment: "The amount sent doesn't match the price. Reload the page and try again.",
  MintIsPaused: "Minting is paused for a moment. Nothing was sent: try again shortly.",
  MintIsClosed: "The mint is over. The Faces now trade on OpenSea.",
};

let P = null; // params.json
let ui = null; // helpers from main.js: { doConnect, errMsg, toast, sound, onMinted, open, records }
let stage = null; // the art pane (chamber)
let eye = null; // the panel's own eye (The Stare): { setOpen }
let view = null; // the last chain read
let qty = 1;
let busy = false;
let skew = 0; // correction to this device's clock, in seconds (see readChain)
let checked = null; // the last check shown: { key, ready }; a new account or chain checks again
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Load the drop's parameters; null when this site doesn't mint (the OpenSea path). */
export async function loadDrop() {
  if (state.preview) return null;
  try {
    const r = await fetch("/drop/params.json", { cache: "no-store" });
    if (!r.ok) return null;
    const p = await r.json();
    if (p.faces?.toLowerCase() !== state.dep.faces.toLowerCase() || !p.public) return null;
    const big = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "boolean" ? v : BigInt(v)]));
    P = { ...p, public: big(p.public) };
    return P;
  } catch {
    return null;
  }
}

/** The NEONLIST's announced terms: what the panel shows until SeaDrop holds them. */
const NEONLIST = {
  mintPrice: parseEther("0.004"),
  maxTotalMintableByWallet: 15n,
  startTime: BigInt(Date.UTC(2026, 9, 13, 13) / 1000),
  endTime: BigInt(Date.UTC(2026, 9, 31, 18) / 1000),
};
/** The NEONLIST is set when SeaDrop's public stage holds its price and window. */
const listSet = (v) =>
  !!v?.configured && P.public.mintPrice === NEONLIST.mintPrice && P.public.startTime === NEONLIST.startTime && P.public.endTime === NEONLIST.endTime;
const L = () => (listSet(view) ? P.public : NEONLIST);

// gas: a Face opens its account and receives its basket in the mint transaction. Measured on a mainnet fork (10 Oct):
// 3 Faces ≈ 0.88M gas, 12 ≈ 3.05M, so ≈ 0.16M + 0.24M a Face; kept a little above. The wallet wants the gas limit
// (estimate + 30%) at its max fee (about twice the gas price) covered too.
const GAS_BASE = 200_000n;
const GAS_PER_FACE = 300_000n;
const reserve = (n, gasPrice) => ((GAS_BASE + GAS_PER_FACE * n) * 13n * gasPrice * 2n) / 10n;
/** How many Faces this balance pays for, price and gas included, up to `max`. */
const affordable = (balance, price, gasPrice, max) => {
  let n = 0n;
  while (n < max && balance >= (n + 1n) * price + reserve(n + 1n, gasPrice)) n++;
  return n;
};

const ethFmt = (wei) => `${Number(formatEther(wei)).toLocaleString("en-US", { maximumFractionDigits: 4 })} ETH`;
const when = (sec) => {
  const d = new Date(Number(sec) * 1000);
  // UTC only (the founder, 3 Oct): one time for everyone, the one the posts use
  return `${d.toLocaleString("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })}, ${d.toISOString().slice(11, 16)} UTC`;
};
const countdown = (sec) => {
  let s = Math.max(0, Math.round(sec));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return `${d ? `${d}d ` : ""}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};
const nowChain = () => Date.now() / 1000 + skew;

/** The stage at a given chain time. */
function stageAt(t) {
  const l = L();
  if (t < Number(l.startTime)) return "before";
  if (t < Number(l.endTime)) return "list";
  return "ended";
}

/** Read everything the panel shows. */
async function readChain() {
  const pub = state.pub;
  const who = state.account;
  const [block, drop, stats, closed, gasPrice] = await Promise.all([
    pub.getBlock(),
    pub.readContract({ address: P.seaDrop, abi: SEADROP, functionName: "getPublicDrop", args: [P.faces] }),
    pub.readContract({ address: P.faces, abi: FACES, functionName: "getMintStats", args: [who ?? ZERO] }),
    pub.readContract({ address: P.faces, abi: parseAbi(["function mintClosed() view returns (bool)"]), functionName: "mintClosed" }),
    pub.getGasPrice(),
  ]);
  // the device's clock, unless it is more than 2 minutes off the chain's (a phone set to the wrong time): the latest
  // block can itself be a few seconds old on a quiet chain, so it only corrects big gaps
  const gap = Number(block.timestamp) - Date.now() / 1000;
  skew = Math.abs(gap) > 120 ? gap : 0;
  // the stage's terms are whatever SeaDrop holds right now (price, limit, window): read from the chain, so a change by
  // the sale manager reaches every open page within one read, with no deploy
  const onChain = drop.startTime !== 0 && drop.feeBps <= 1000 && drop.restrictFeeRecipients;
  if (onChain) {
    P.public = {
      ...P.public,
      mintPrice: BigInt(drop.mintPrice),
      startTime: BigInt(drop.startTime),
      endTime: BigInt(drop.endTime),
      maxTotalMintableByWallet: BigInt(drop.maxTotalMintableByWallet),
      feeBps: BigInt(drop.feeBps),
    };
  }
  const v = { configured: onChain, closed, minted: who ? stats[0] : 0n, supply: stats[1], max: stats[2], balance: null, onChain: null, gasPrice, account: who };
  if (who) {
    const [balance, chainId] = await Promise.all([
      pub.getBalance({ address: who }),
      state.provider?.request({ method: "eth_chainId" }).catch(() => null),
    ]);
    v.balance = balance;
    v.onChain = chainId ? Number(chainId) === state.chain.id : null;
  }
  return v;
}

/** What this wallet can do now: { stage, price, limit, left, afford } */
function offer(v) {
  const stage = stageAt(nowChain());
  const remaining = v.max > v.supply ? v.max - v.supply : 0n;
  if (v.closed || remaining === 0n) return { stage: "soldout" };
  if (stage === "ended") return { stage };
  if (stage === "list" && !listSet(v)) return { stage: "waiting" };
  const l = L();
  const price = l.mintPrice;
  const limit = l.maxTotalMintableByWallet;
  if (!v.account) return { stage, price, limit };
  let left = limit > v.minted ? limit - v.minted : 0n;
  if (left > remaining) left = remaining;
  const afford = v.balance == null ? left : affordable(v.balance, price, v.gasPrice, left);
  return { stage, price, limit, left, afford };
}

/** The check's verdict for this wallet: three lines and whether it is ready. */
function verdict(v, o) {
  const rows = [];
  // short lines: the log must fit one line each on a 320 px phone
  rows.push(v.onChain === false ? { k: "chain", v: "not selected", ok: false, fix: "chain" } : { k: "chain", v: "Robinhood", ok: true });
  rows.push(o.afford > 0n ? { k: "eth", v: ethFmt(v.balance), ok: true } : { k: "eth", v: `${ethFmt(v.balance ?? 0n)}, short`, ok: false, fix: "eth" });
  rows.push(o.left > 0n ? { k: "faces left", v: `${o.left} of ${o.limit}`, ok: true } : { k: "faces left", v: `0 of ${o.limit}`, ok: false, fix: "limit" });
  return { rows, ready: rows.every((r) => r.ok) };
}
const dots = (k, n = 12) => `${k} ${".".repeat(Math.max(2, n - k.length))}`;

/** The Stare: the check typed in the log while #419's eye opens on the wallet. Once per account and chain. */
async function stare(v, o) {
  const key = `${v.account}:${v.onChain}:${o.afford > 0n}:${o.left > 0n}`;
  const { rows, ready } = verdict(v, o);
  const box = $("#stare");
  box.hidden = false;
  if (checked?.key === key) return;
  checked = { key, ready };
  box.classList.remove("ready", "short");
  eye?.setOpen(0);
  const log = terminal($("#mint-log"));
  log.clear();
  $("#mint-log").hidden = false;
  log.line(`> NEONLIST check · ${short(v.account)}`, "dim");
  for (const [i, r] of rows.entries()) {
    eye?.setOpen(((i + 1) / rows.length) * (ready ? 0.9 : 0.4));
    await log.line(`> ${dots(r.k)} ${r.v} ${r.ok ? "OK" : "!"}`, r.ok ? "" : "err");
  }
  if (checked?.key !== key) return; // another account took over meanwhile
  eye?.setOpen(ready ? 1 : 0.4);
  box.classList.add(ready ? "ready" : "short");
  await log.line(ready ? "> THEY SEE YOU." : "> not ready yet", ready ? "neon" : "err");
  if (ready) ui.sound.success();
}

function paint() {
  const box = $("#site-mint");
  if (!box || !view) return;
  const o = offer(view);
  const l = L();
  const pill = $("#phase-pill");
  pill.classList.toggle("live", o.stage === "list");
  pill.textContent = { before: "NEONLIST opens soon", list: "NEONLIST live", waiting: "Opening", soldout: "Sold out", ended: "Mint over" }[o.stage];
  const terms = `The NEONLIST: ${ethFmt(l.mintPrice)} a Face, up to ${l.maxTotalMintableByWallet} per wallet in total, until ${esc(when(l.endTime))}. You pay with ETH on Robinhood Chain, not on Ethereum, plus a few cents of gas.`;
  const who = view.account ? `<span class="fine">Wallet ${short(view.account)}</span>` : "";
  let html = "";
  if (o.stage === "before") {
    html = `<p class="mint-line">The NEONLIST opens <b>${esc(when(l.startTime))}</b>.</p>
      <p class="mint-count" id="mint-count" aria-label="Time until the NEONLIST opens">${countdown(Number(l.startTime) - nowChain())}</p>
      <p class="fine">${terms}</p>`;
    if (!view.account) html += `<button class="btn btn-neon btn-wide" data-mint="connect">Check your wallet</button><p class="fine">Connecting signs nothing.</p>`;
    else html += fixes(view, o) + who;
  } else if (o.stage === "waiting") {
    html = `<p class="mint-line">Opening in a moment: the NEONLIST is being set on-chain.</p><p class="fine">This page checks every few seconds. No need to reload.</p>${who}`;
  } else if (o.stage === "soldout" || o.stage === "ended") {
    html = `<p class="mint-line">${o.stage === "soldout" ? "Sold out: all 5444 Faces of the sale are minted." : "The mint is over."} They now trade on OpenSea.</p>`;
  } else {
    html = `<p class="mint-line"><b>NEONLIST</b> · ${ethFmt(o.price)} per Face · up to ${o.limit} per wallet in total</p>`;
    if (!view.account) {
      html += `<button class="btn btn-neon btn-wide" data-mint="connect">Connect wallet to mint</button><p class="fine">${terms}</p>`;
    } else if (o.left === 0n) {
      html += `<p class="msg ok">This wallet has minted ${view.minted}, its limit.</p>${who}`;
    } else {
      if (BigInt(qty) > o.left) qty = Number(o.left);
      if (qty < 1) qty = 1;
      const n = BigInt(qty);
      const total = o.price * n;
      const short_ = view.balance != null && view.balance < total + reserve(n, view.gasPrice);
      html += `<div class="qty" role="group" aria-label="How many Faces">
          <button class="btn btn-ghost" data-mint="minus" aria-label="One less"${qty <= 1 ? " disabled" : ""}>−</button>
          <output aria-live="polite">${qty}</output>
          <button class="btn btn-ghost" data-mint="plus" aria-label="One more"${n >= o.left ? " disabled" : ""}>+</button>
          <span class="fine">of ${o.left} left for this wallet</span>
        </div>
        <button class="btn btn-neon btn-wide" data-mint="mint"${busy || short_ ? " disabled" : ""}>${busy ? "Minting…" : `Mint ${qty} · ${ethFmt(total)}`}</button>
        ${short_ ? `<p class="msg err">This wallet holds ${ethFmt(view.balance)} on Robinhood Chain: ${o.afford > 0n ? `enough for ${o.afford} Face${o.afford > 1n ? "s" : ""} with gas.` : `${qty} Face${qty > 1 ? "s" : ""} need${qty > 1 ? "" : "s"} ${ethFmt(total)} plus a little gas.`}</p>` : ""}
        <p class="fine">Plus network gas, a few cents. The NEONLIST closes ${esc(when(l.endTime))}.</p>
        <p class="fine">You sign one transaction to OpenSea's SeaDrop contract (${short(P.seaDrop)}), nothing else: no token approval, so nothing else in your wallet can move.</p>${who}`;
    }
  }
  // the explorer path (the founder, 4 Oct): a wallet can send the same call itself; these are its values
  if (view.account && (o.stage === "before" || o.stage === "list")) {
    const row = (k, v) => `<dt>${k}</dt><dd><code>${esc(v)}</code></dd>`;
    html += `<details class="explorer-mint"><summary>Mint from the explorer instead</summary>
      <p class="fine">From ${esc(when(l.startTime))}: on <a href="https://robinhoodchain.blockscout.com/address/${P.seaDrop}?tab=write_contract" target="_blank" rel="noopener">OpenSea's SeaDrop contract</a>, connect this wallet and call <code>mintPublic</code> with these values, sending ${ethFmt(l.mintPrice)} times the quantity. It is the same transaction this page sends.</p>
      <dl>${row("nftContract", P.faces)}${row("feeRecipient", P.feeRecipient)}${row("minterIfNotPayer", ZERO)}${row("quantity", "1 to " + l.maxTotalMintableByWallet)}</dl>
    </details>`;
  }
  html += `<div class="mint-result" id="mint-result"></div>`;
  const keep = $("#mint-result")?.innerHTML;
  box.innerHTML = html;
  if (keep) $("#mint-result").innerHTML = keep;
  if (o.stage === "before" && view.account) stare(view, o);
  else if (o.stage !== "before") $("#stare").hidden = !busy;
}

/** Under the check: what to do about each line that isn't OK, and the share once the wallet is ready. */
function fixes(v, o) {
  const { rows, ready } = verdict(v, o);
  if (ready) {
    const text = `My wallet is ready for the NEONLIST. ${when(L().startTime)}. They don't blink. #NEONFACE`;
    return `<p class="msg ok">This wallet is ready for the NEONLIST: ${o.afford >= o.left ? `up to ${o.left}` : `${o.afford}`} Face${o.afford > 1n ? "s" : ""}, as it stands. Come back when it opens.</p>
      <a class="btn btn-ghost btn-wide" target="_blank" rel="noopener" href="https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(`${location.origin}/neonlist`)}">Share on X</a>`;
  }
  const need = L().mintPrice + reserve(1n, v.gasPrice);
  const tips = rows.filter((r) => !r.ok).map((r) => ({
    chain: `<button class="btn btn-neon btn-wide" data-mint="chain">Switch network</button><p class="fine">It adds Robinhood Chain to your wallet if it isn't there yet.</p>`,
    eth: `<p class="msg err">Bring ETH to Robinhood Chain: about ${ethFmt(need)} for one Face with its gas, ${ethFmt(L().mintPrice)} more for each other Face. ETH on Ethereum doesn't count: bridge it first.</p>`,
    limit: `<p class="msg">This wallet has already minted its ${o.limit} Faces.</p>`,
  })[r.fix]);
  return tips.join("") + `<button class="btn btn-ghost btn-wide" data-mint="recheck">Check again</button>`;
}

async function refresh() {
  try {
    view = await readChain();
    paint();
  } catch {}
}

/** What each new Face received, read back from the chain: image, account, basket. */
async function born(ids) {
  const tokens = state.dep.tradeTokens ?? [];
  const dec = new Map();
  const leg = async (l) => {
    const t = tokens.find((x) => x.address.toLowerCase() === l.token.toLowerCase());
    const sym = t ? (t.symbol === "WETH" ? "ETH" : t.symbol) : await readAt(l.token, "erc20", "symbol").catch(() => "?");
    if (!dec.has(l.token)) dec.set(l.token, readAt(l.token, "erc20", "decimals").then(Number).catch(() => 18));
    const amount = Number(formatUnits(l.amount, await dec.get(l.token))).toLocaleString("en-US", { maximumSignificantDigits: 4 });
    return { sym, amount };
  };
  return Promise.all(
    ids.map(async (id) => {
      const [meta, seed] = await Promise.all([metadata(id), read("seeder", "seedOf", [BigInt(id)])]);
      return { id, image: meta.image, account: seed.account, funded: seed.funded, legs: seed.funded ? await Promise.all(seed.legs.map(leg)) : [] };
    }),
  );
}

async function mint() {
  const o = offer(view);
  if (!o.left || busy) return;
  busy = true;
  paint();
  // the eye watches the signature, on phones too (the art pane is hidden there)
  $("#stare").hidden = false;
  $("#stare").classList.remove("short");
  $("#stare").classList.add("ready");
  eye?.setOpen(1);
  const log = terminal($("#mint-log"));
  log.clear();
  $("#mint-log").hidden = false;
  const out = () => $("#mint-result");
  out().innerHTML = "";
  try {
    await ensureChain();
    const n = BigInt(qty);
    const value = o.price * n;
    const call = { functionName: "mintPublic", args: [P.faces, P.feeRecipient, ZERO, n] };
    log.line("> NEONLIST ............. open");
    const { request } = await state.pub.simulateContract({ address: P.seaDrop, abi: SEADROP, ...call, value, account: state.account });
    // each Face opens its account and receives its basket in the same transaction: leave room above the estimate
    const gas = await state.pub.estimateContractGas({ address: P.seaDrop, abi: SEADROP, ...call, value, account: state.account });
    log.line("> dry run .............. ok");
    log.line("> waiting for your signature");
    stage?.set("sign");
    const hash = await state.wallet.writeContract({ ...request, gas: (gas * 13n) / 10n });
    stage?.set("chain");
    eye?.setOpen(0.15);
    log.line(`> sent ${hash.slice(0, 10)}…${hash.slice(-6)}`);
    log.line("> writing to the chain ...");
    const r = await state.pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error("The transaction reverted. Nothing was minted; only gas was spent.");
    const ids = parseEventLogs({ abi: FACES, logs: r.logs, eventName: "Transfer" })
      .filter((l) => l.address.toLowerCase() === P.faces.toLowerCase() && l.args.from === ZERO)
      .map((l) => Number(l.args.tokenId));
    log.line(`> block ${r.blockNumber.toLocaleString("en-US")} ... ${ids.length} Face${ids.length > 1 ? "s" : ""} minted`, "neon");
    eye?.setOpen(1);
    busy = false;
    refresh();
    out().innerHTML = `<span class="msg ok">Minted. Open ${ids.length > 1 ? "them" : "it"}:</span>${ids.map((id) => `<a href="/face/${id}" data-link>#${id} →</a>`).join("")}`;
    ui.onMinted?.();
    const faces = await born(ids).catch(() => null);
    stage?.set("idle");
    if (faces?.length) {
      const text = (id) => `I just minted NEONFACES #${id} on the NEONLIST, on Robinhood Chain. It was born with its own account. They don't blink. #NEONFACE`;
      birth(faces, { hash, block: Number(r.blockNumber), link: explorer(`tx/${hash}`) }, {
        records: ui.records,
        share: (id) => `https://x.com/intent/post?text=${encodeURIComponent(text(id))}&url=${encodeURIComponent(`${location.origin}/face/${id}`)}`,
        open: ui.open,
      });
    } else ui.sound.success();
  } catch (e) {
    busy = false;
    stage?.set("idle");
    eye?.setOpen(0.4);
    paint();
    const msg = ui.errMsg(e);
    log.line(`> ${/rejected/i.test(msg) ? "not signed: nothing was sent" : "stopped"}`, "err");
    if (out()) out().innerHTML = `<span class="msg err">${esc(msg)}</span>`;
    if (!/rejected/i.test(msg)) ui.sound.error();
  }
}

/** The moment the NEONLIST opens: the panel flashes neon, once, and the eye opens wide. */
function opening() {
  const panel = $(".mint-panel");
  panel.classList.remove("flash");
  void panel.offsetWidth;
  panel.classList.add("flash");
  eye?.setOpen(1);
  ui.sound.success();
}

/** Start the panel. `helpers`: { doConnect, errMsg, toast, sound, onMinted } */
export function setupSiteMint(helpers) {
  ui = helpers;
  const box = $("#site-mint");
  box.hidden = false;
  if (helpers.records?.length) stage = chamber($(".mint-art"), helpers.records);
  const cv = $("#stare canvas");
  if (cv) eye = pixelEye(cv, { cols: 48, rows: 24, open: 0 });
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mint]");
    if (!b || b.disabled) return;
    const k = b.dataset.mint;
    if (k === "connect") ui.doConnect().catch((err) => err.message !== "cancelled" && ui.toast(ui.errMsg(err)));
    if (k === "chain") ensureChain().then(() => ((checked = null), refresh())).catch((err) => ui.toast(ui.errMsg(err)));
    if (k === "recheck") { checked = null; refresh(); }
    if (k === "minus") { qty = Math.max(1, qty - 1); paint(); }
    if (k === "plus") { qty += 1; paint(); }
    if (k === "mint") mint();
  });
  window.addEventListener("neon:account", () => { qty = 1; checked = null; $("#mint-result") && ($("#mint-result").innerHTML = ""); refresh(); });
  refresh();
  setInterval(() => !busy && refresh(), 10_000);
  // the hero's countdown: the first thing a visitor sees, a tap away from the panel
  let hero = $("#hero-count");
  if (!hero) {
    hero = document.createElement("a");
    hero.id = "hero-count";
    hero.className = "hero-count";
    hero.href = "/#mint";
    hero.dataset.link = "";
    $(".hero-cta")?.after(hero);
  }
  const heroTick = () => {
    const t = nowChain();
    const s = stageAt(t);
    hero.hidden = !(s === "before" || s === "list");
    if (s === "before") hero.innerHTML = `<span>The NEONLIST opens in</span><b>${countdown(Number(L().startTime) - t)}</b>`;
    else if (s === "list") hero.innerHTML = `<span>The NEONLIST is open</span><b>Mint now</b>`;
  };
  heroTick();
  // the countdown and the stage change on time, between reads
  let last = null;
  setInterval(() => {
    heroTick();
    if (!view) return;
    const s = stageAt(nowChain());
    if (s !== last && last !== null) {
      refresh();
      if (s === "list") opening();
    }
    last = s;
    const c = $("#mint-count");
    if (c) c.textContent = countdown(Number(L().startTime) - nowChain());
  }, 1000);
}
