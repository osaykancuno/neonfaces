// Minting on this site, through OpenSea's SeaDrop contract (plan B of 28 Sep: the stages are configured on-chain by
// the sale manager with tools/seadrop-drop.mjs, and this panel calls SeaDrop directly, as OpenSea's own page does).
// On only when /drop/params.json is published next to the proofs; without it the panel links to OpenSea.
//
// Every rule is enforced by SeaDrop, not here: the stage window, the price, the per-wallet limit and, on the list,
// the Merkle proof whose leaf carries the stage terms. This panel only reads the chain, finds the wallet's proof and
// shows what the contract will accept, so nobody signs a transaction that would fail.
import { parseAbi, parseEther, formatEther, formatUnits, parseEventLogs } from "viem";
import { state, ensureChain, short, read, readAt, metadata, explorer } from "./chain.js";
import { chamber, terminal, birth } from "./effects/birth.js";

const MINT_PARAMS = "(uint256 mintPrice, uint256 maxTotalMintableByWallet, uint256 startTime, uint256 endTime, uint256 dropStageIndex, uint256 maxTokenSupplyForStage, uint256 feeBps, bool restrictFeeRecipients)";
export const SEADROP = parseAbi([
  "function mintPublic(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity) payable",
  `function mintAllowList(address nftContract, address feeRecipient, address minterIfNotPayer, uint256 quantity, ${MINT_PARAMS} mintParams, bytes32[] proof) payable`,
  "function getPublicDrop(address nftContract) view returns ((uint80 mintPrice, uint48 startTime, uint48 endTime, uint16 maxTotalMintableByWallet, uint16 feeBps, bool restrictFeeRecipients))",
  "function getAllowListMerkleRoot(address nftContract) view returns (bytes32)",
  // SeaDrop 1.0's errors, and NeonFaces' own that bubble up through it
  "error NotActive(uint256 currentTimestamp, uint256 startTimestamp, uint256 endTimestamp)",
  "error MintQuantityCannotBeZero()",
  "error MintQuantityExceedsMaxMintedPerWallet(uint256 total, uint256 allowed)",
  "error MintQuantityExceedsMaxSupply(uint256 total, uint256 maxSupply)",
  "error MintQuantityExceedsMaxTokenSupplyForStage(uint256 total, uint256 maxTokenSupplyForStage)",
  "error FeeRecipientNotAllowed()",
  "error InvalidProof()",
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
  NotActive: "This stage isn't open right now.",
  MintQuantityExceedsMaxMintedPerWallet: ([total, allowed]) => `That would make ${total} Faces for this wallet: the limit is ${allowed}.`,
  MintQuantityExceedsMaxSupply: "Not that many Faces are left: try a smaller number.",
  MintQuantityExceedsMaxTokenSupplyForStage: "Not that many Faces are left in this stage: try a smaller number.",
  ExceedsPublicAllocation: "Not that many Faces are left: try a smaller number.",
  InvalidProof: "This wallet isn't on the NEONLIST.",
  IncorrectPayment: "The amount sent doesn't match the price. Reload the page and try again.",
  MintIsPaused: "Minting is paused for a moment. Nothing was sent: try again shortly.",
  MintIsClosed: "The mint is over. The Faces now trade on OpenSea.",
};

let P = null; // params.json
let ui = null; // helpers from main.js: { doConnect, errMsg, toast, sound, onMinted, open, records }
let stage = null; // the art pane (chamber)
let view = null; // the last chain read: { now, configured, stage, supply, max, minted, proof, balance }
let qty = 1;
let busy = false;
let skew = 0; // correction to this device's clock, in seconds (see readChain)
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Load the drop's parameters; null when this site doesn't mint (the OpenSea path). */
export async function loadDrop() {
  if (state.preview) return null;
  try {
    const r = await fetch("/drop/params.json", { cache: "no-store" });
    if (!r.ok) return null;
    const p = await r.json();
    if (p.faces?.toLowerCase() !== state.dep.faces.toLowerCase()) return null;
    const big = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "boolean" ? v : BigInt(v)]));
    P = { ...p, list: big(p.list), public: big(p.public) };
    return P;
  } catch {
    return null;
  }
}

/** The NEONLIST (the founder, 4 Oct): the only way this site mints, from Tue 13 Oct 13:00 UTC to Sat 31 Oct 18:00 UTC.
 *  Until its stage is set on-chain (its wallets come later), the panel shows these announced terms. */
const NEONLIST = {
  mintPrice: parseEther("0.004"),
  maxTotalMintableByWallet: 15n,
  startTime: BigInt(Date.UTC(2026, 9, 13, 13) / 1000),
  endTime: BigInt(Date.UTC(2026, 9, 31, 18) / 1000),
};
/** The NEONLIST is set when SeaDrop holds the site's list (params.json) and that list is the NEONLIST (stage index 2). */
const listSet = (v) => !!v?.configured.list && P.list.dropStageIndex === 2n;
/** The NEONLIST's terms: from its Merkle leaves once set, the announced ones before. */
const L = () => (listSet(view) ? P.list : NEONLIST);

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

/** The stage at a given chain time: the NEONLIST only. */
function stageAt(t) {
  const l = L();
  if (t < Number(l.startTime)) return "before";
  if (t < Number(l.endTime)) return "list";
  return "ended";
}

async function proofOf(address) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(address.toLowerCase()));
  const h = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const r = await fetch(`/drop/proofs/${h.slice(0, 2)}.json`, { cache: "no-cache" });
  if (r.status === 404) return null; // no wallet of the list falls in this shard
  if (!r.ok) throw new Error("The NEONLIST couldn't be loaded. Check your connection and reload.");
  return (await r.json())[h.slice(0, 20)] ?? null;
}

/** Read everything the panel shows. */
async function readChain() {
  const pub = state.pub;
  const who = state.account;
  const [block, root, drop, stats, closed] = await Promise.all([
    pub.getBlock(),
    pub.readContract({ address: P.seaDrop, abi: SEADROP, functionName: "getAllowListMerkleRoot", args: [P.faces] }),
    pub.readContract({ address: P.seaDrop, abi: SEADROP, functionName: "getPublicDrop", args: [P.faces] }),
    pub.readContract({ address: P.faces, abi: FACES, functionName: "getMintStats", args: [who ?? ZERO] }),
    pub.readContract({ address: P.faces, abi: parseAbi(["function mintClosed() view returns (bool)"]), functionName: "mintClosed" }),
  ]);
  // the device's clock, unless it is more than 2 minutes off the chain's (a phone set to the wrong time): the latest
  // block can itself be a few seconds old on a quiet chain, so it only corrects big gaps
  const gap = Number(block.timestamp) - Date.now() / 1000;
  skew = Math.abs(gap) > 120 ? gap : 0;
  // a page left open across a drop update holds the old parameters: fetch them again (the proof shards follow, read
  // with cache revalidation), so a visitor watching the countdown never gets stuck on "Opening"
  // the list's terms live in its Merkle leaves, so they must match params.json exactly; the public stage's terms are
  // whatever SeaDrop holds right now (price, limit, window): read from the chain, so a change by the sale manager
  // reaches every open page within one read, with no deploy and no pause
  const listOk = () => root.toLowerCase() === P.root.toLowerCase();
  if (!listOk()) await loadDrop(); // the list changed since this page loaded: fetch its params and proofs again
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
  const configured = { list: listOk(), public: onChain };
  const v = {
    configured,
    closed,
    minted: who ? stats[0] : 0n,
    supply: stats[1],
    max: stats[2],
    proof: undefined,
    balance: null,
    account: who,
  };
  if (who) {
    const [proof, balance] = await Promise.all([
      nowChain() < Number(P.list.endTime) ? proofOf(who) : Promise.resolve(undefined),
      pub.getBalance({ address: who }),
    ]);
    v.proof = proof;
    v.balance = balance;
  }
  return v;
}

/** What this wallet can do now: { stage, price, limit, left, reason } */
function offer(v) {
  const stage = stageAt(nowChain());
  const remaining = v.max > v.supply ? v.max - v.supply : 0n;
  if (v.closed || remaining === 0n) return { stage: "soldout" };
  if (stage === "before" || stage === "ended") return { stage };
  if (!listSet(v)) return { stage: "waiting" };
  const price = P.list.mintPrice;
  const limit = P.list.maxTotalMintableByWallet;
  if (!v.account) return { stage, price, limit };
  if (!v.proof) return { stage, price, limit, reason: "notlisted" };
  let left = limit > v.minted ? limit - v.minted : 0n;
  if (left > remaining) left = remaining;
  return { stage, price, limit, left };
}

function paint() {
  const box = $("#site-mint");
  if (!box || !view) return;
  const o = offer(view);
  const l = L();
  const pill = $("#phase-pill");
  pill.classList.toggle("live", o.stage === "list" && !o.reason);
  pill.textContent = { before: "NEONLIST opens soon", list: "NEONLIST live", waiting: "Opening", soldout: "Sold out", ended: "Mint over" }[o.stage];
  const who = view.account ? `<span class="fine">Wallet ${short(view.account)}${view.balance != null ? ` · ${ethFmt(view.balance)} on Robinhood Chain` : ""}</span>` : "";
  const terms = `Wallets of the communities that back NEONFACES mint at ${ethFmt(l.mintPrice)} a Face, up to ${l.maxTotalMintableByWallet} each, until ${esc(when(l.endTime))}.`;
  let html = "";
  if (o.stage === "before") {
    // no mint button before it opens: the date, the countdown, the terms and, once the list is set, this wallet's place on it
    const check = !listSet(view)
      ? `<p class="fine">Before it opens, this page will tell each wallet whether it is on the NEONLIST.</p>`
      : view.account
        ? view.proof
          ? `<p class="msg ok">This wallet is on the NEONLIST: come back when it opens.</p>`
          : `<p class="msg">This wallet isn't on the NEONLIST.</p>`
        : `<button class="btn btn-ghost btn-wide" data-mint="connect">Connect to check your wallet</button>`;
    html = `<p class="mint-line">The NEONLIST opens <b>${esc(when(l.startTime))}</b>.</p>
      <p class="mint-count" id="mint-count" aria-label="Time until the NEONLIST opens">${countdown(Number(l.startTime) - nowChain())}</p>
      <p class="fine">Minting on neonfaces.xyz happens on the NEONLIST. ${terms} You pay with ETH on Robinhood Chain, not on Ethereum, plus a few cents of gas.</p>
      ${check}${who}`;
  } else if (o.stage === "waiting") {
    html = `<p class="mint-line">Opening in a moment: the NEONLIST is being set on-chain.</p><p class="fine">This page checks every few seconds. No need to reload.</p>${who}`;
  } else if (o.stage === "soldout" || o.stage === "ended") {
    html = `<p class="mint-line">${o.stage === "soldout" ? "Sold out: all 5444 Faces of the sale are minted." : "The mint is over."} They now trade on OpenSea.</p>`;
  } else {
    const until = `The NEONLIST closes ${esc(when(l.endTime))}.`;
    html = `<p class="mint-line"><b>NEONLIST</b> · ${ethFmt(o.price)} per Face · up to ${o.limit} per wallet in total</p>`;
    if (!view.account) {
      html += `<button class="btn btn-neon btn-wide" data-mint="connect">Connect wallet to mint</button><p class="fine">${terms}</p>`;
    } else if (o.reason === "notlisted") {
      html += `<p class="msg">This wallet isn't on the NEONLIST.</p>${who}`;
    } else if (o.left === 0n) {
      html += `<p class="msg ok">This wallet has minted ${view.minted}, its limit.</p>${who}`;
    } else {
      if (BigInt(qty) > o.left) qty = Number(o.left);
      if (qty < 1) qty = 1;
      const total = o.price * BigInt(qty);
      const short_ = view.balance != null && view.balance < total;
      html += `<div class="qty" role="group" aria-label="How many Faces">
          <button class="btn btn-ghost" data-mint="minus" aria-label="One less"${qty <= 1 ? " disabled" : ""}>−</button>
          <output aria-live="polite">${qty}</output>
          <button class="btn btn-ghost" data-mint="plus" aria-label="One more"${BigInt(qty) >= o.left ? " disabled" : ""}>+</button>
          <span class="fine">of ${o.left} left for this wallet</span>
        </div>
        <button class="btn btn-neon btn-wide" data-mint="mint"${busy || short_ ? " disabled" : ""}>${busy ? "Minting…" : `Mint ${qty} · ${ethFmt(total)}`}</button>
        ${short_ ? `<p class="msg err">This wallet holds ${ethFmt(view.balance)} on Robinhood Chain: ${qty} Face${qty > 1 ? "s" : ""} need${qty > 1 ? "" : "s"} ${ethFmt(total)} plus a little gas.</p>` : ""}
        <p class="fine">Plus network gas, a few cents. ${until}</p>
        <p class="fine">You sign one transaction to OpenSea's SeaDrop contract (${short(P.seaDrop)}), nothing else: no token approval, so nothing else in your wallet can move.</p>${who}`;
    }
  }
  // the explorer path (the founder, 4 Oct): a wallet on the NEONLIST can send the same call itself; these are its values
  if (listSet(view) && view.proof && (o.stage === "before" || o.stage === "list")) {
    const lp = P.list;
    const params = `[${[lp.mintPrice, lp.maxTotalMintableByWallet, lp.startTime, lp.endTime, lp.dropStageIndex, lp.maxTokenSupplyForStage, lp.feeBps].join(", ")}, ${lp.restrictFeeRecipients}]`;
    const row = (k, v) => `<dt>${k}</dt><dd><code>${esc(v)}</code></dd>`;
    html += `<details class="explorer-mint"><summary>Mint from the explorer instead</summary>
      <p class="fine">From ${esc(when(lp.startTime))}: on <a href="https://robinhoodchain.blockscout.com/address/${P.seaDrop}?tab=write_contract" target="_blank" rel="noopener">OpenSea's SeaDrop contract</a>, connect this wallet and call <code>mintAllowList</code> with these values, sending ${ethFmt(lp.mintPrice)} times the quantity. It is the same transaction this page sends.</p>
      <dl>${row("nftContract", P.faces)}${row("feeRecipient", P.feeRecipient)}${row("minterIfNotPayer", ZERO)}${row("quantity", "1 to " + lp.maxTotalMintableByWallet)}${row("mintParams", params)}${row("proof", JSON.stringify(view.proof))}</dl>
    </details>`;
  }
  html += `<div class="mint-result" id="mint-result"></div>`;
  const keep = $("#mint-result")?.innerHTML;
  box.innerHTML = html;
  if (keep) $("#mint-result").innerHTML = keep;
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
  const log = terminal($("#mint-log"));
  log.clear();
  $("#mint-log").hidden = false;
  const out = () => $("#mint-result");
  out().innerHTML = "";
  try {
    await ensureChain();
    const n = BigInt(qty);
    const value = o.price * n;
    const call =
      o.stage === "list"
        ? { functionName: "mintAllowList", args: [P.faces, P.feeRecipient, ZERO, n, P.list, view.proof] }
        : { functionName: "mintPublic", args: [P.faces, P.feeRecipient, ZERO, n] };
    log.line(`> ${o.stage === "list" ? "NEONLIST proof ........ found" : "public stage ........... open"}`);
    const { request } = await state.pub.simulateContract({ address: P.seaDrop, abi: SEADROP, ...call, value, account: state.account });
    // each Face opens its account and receives its basket in the same transaction: leave room above the estimate
    const gas = await state.pub.estimateContractGas({ address: P.seaDrop, abi: SEADROP, ...call, value, account: state.account });
    log.line("> dry run .............. ok");
    log.line("> waiting for your signature");
    stage?.set("sign");
    const hash = await state.wallet.writeContract({ ...request, gas: (gas * 13n) / 10n });
    stage?.set("chain");
    log.line(`> sent ${hash.slice(0, 10)}…${hash.slice(-6)}`);
    log.line("> writing to the chain ...");
    const r = await state.pub.waitForTransactionReceipt({ hash });
    if (r.status !== "success") throw new Error("The transaction reverted. Nothing was minted; only gas was spent.");
    const ids = parseEventLogs({ abi: FACES, logs: r.logs, eventName: "Transfer" })
      .filter((l) => l.address.toLowerCase() === P.faces.toLowerCase() && l.args.from === ZERO)
      .map((l) => Number(l.args.tokenId));
    log.line(`> block ${r.blockNumber.toLocaleString("en-US")} ... ${ids.length} Face${ids.length > 1 ? "s" : ""} minted`, "neon");
    busy = false;
    refresh();
    out().innerHTML = `<span class="msg ok">Minted. Open ${ids.length > 1 ? "them" : "it"}:</span>${ids.map((id) => `<a href="/face/${id}" data-link>#${id} →</a>`).join("")}`;
    ui.onMinted?.();
    const faces = await born(ids).catch(() => null);
    stage?.set("idle");
    if (faces?.length) {
      const text = (id) => `I just minted NEONFACES #${id} on Robinhood Chain. It was born with its own account. They don't blink.`;
      birth(faces, { hash, block: Number(r.blockNumber), link: explorer(`tx/${hash}`) }, {
        records: ui.records,
        share: (id) => `https://x.com/intent/post?text=${encodeURIComponent(text(id))}&url=${encodeURIComponent(`${location.origin}/face/${id}`)}`,
        open: ui.open,
      });
    } else ui.sound.success();
  } catch (e) {
    busy = false;
    stage?.set("idle");
    paint();
    const msg = ui.errMsg(e);
    log.line(`> ${/rejected/i.test(msg) ? "not signed: nothing was sent" : "stopped"}`, "err");
    if (out()) out().innerHTML = `<span class="msg err">${esc(msg)}</span>`;
    if (!/rejected/i.test(msg)) ui.sound.error();
  }
}

/** The moment a stage opens: the panel flashes neon, once. */
function opening() {
  const panel = $(".mint-panel");
  panel.classList.remove("flash");
  void panel.offsetWidth;
  panel.classList.add("flash");
  ui.sound.success();
}

/** Start the panel. `helpers`: { doConnect, errMsg, toast, sound, onMinted } */
export function setupSiteMint(helpers) {
  ui = helpers;
  const box = $("#site-mint");
  box.hidden = false;
  if (helpers.records?.length) stage = chamber($(".mint-art"), helpers.records);
  box.addEventListener("click", (e) => {
    const b = e.target.closest("[data-mint]");
    if (!b || b.disabled) return;
    const k = b.dataset.mint;
    if (k === "connect") ui.doConnect().catch((err) => err.message !== "cancelled" && ui.toast(ui.errMsg(err)));
    if (k === "minus") { qty = Math.max(1, qty - 1); paint(); }
    if (k === "plus") { qty += 1; paint(); }
    if (k === "mint") mint();
  });
  window.addEventListener("neon:account", () => { qty = 1; $("#mint-result") && ($("#mint-result").innerHTML = ""); refresh(); });
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
