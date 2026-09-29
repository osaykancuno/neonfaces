import { formatEther, formatUnits, encodeFunctionData } from "viem";
import { ABI, TIERS, state, loadDeployment, read, readAt, wallets, connect, ensureChain, short, explorer, metadata, facesOf } from "./chain.js";
import { pixelEye } from "./effects/eye.js";
import { decode, svgDataURI, setDataURI, PIECES, SINGLES } from "./render.js";
import { journal, longestStares, completedSets, fmtDay, openApprovals } from "./journal.js";
import { holderPanel, knownTokens } from "./agent-ui.js";
import { hunt } from "./hunter.js";
import { route as tradeRoute } from "./actions.js";
import { liveValue, valueHistory, sparkline } from "./value.js";
import { boot, mosaic, reveals, cursor, tape, scramble, toast } from "./effects/fx.js";
import { sound, soundToggle } from "./effects/sound.js";
import { loadDrop, setupSiteMint, MINT_ERRORS } from "./mint.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let gallery = []; // [{ artId, stare, record }]: on-chain pixel records
let hunting = 0; // the set hunter shows only its latest lookup
const VIEWS = { "": "view-home", faces: "view-faces", sets: "view-sets", mine: "view-mine", guide: "view-guide" }; // routes of the app
let lastView = null;
let sets = []; // [{ set, stare, face, records[4] }]: whole sets for the Sets section
let placeholder = null;
let rarity = null;
let siteMint = false; // plan B: the mint happens on this page, through SeaDrop (mint.js)
const faceURI = (f) => svgDataURI(f.artId, f.record);

// =====================================================================================
// boot
// =====================================================================================
boot();
cursor();
soundToggle($("#sound-btn"));
tape($("#tape"));
pixelEye($("#eye"));
pixelEye($("#nav-eye"), { cols: 24, rows: 12, fade: false });

const [_, g, r] = await Promise.all([
  loadDeployment(),
  fetch("/data/gallery.json").then((x) => x.json()).catch(() => ({})),
  fetch("/data/rarity.json").then((x) => x.json()).catch(() => null),
]);
gallery = g.faces ?? [];
sets = g.sets ?? [];
placeholder = g.placeholder;
rarity = r;
await liveRecords();

mosaic($("#mosaic"), gallery.map((f) => f.record));
renderGallery();
renderSets();
renderTraits();
renderSplit();
renderFooter();
reveals();
document.querySelectorAll(".hero [data-scramble]").forEach((el) => scramble(el, { duration: 1400 }));
setupMint();
renderMyFaces();
renderWatch();
setupHunter();
route();

window.addEventListener("popstate", route);

document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-link]");
  if (!a || e.metaKey || e.ctrlKey) return;
  const url = new URL(a.href);
  if (url.origin !== location.origin) return;
  e.preventDefault();
  history.pushState({}, "", url.pathname + url.hash);
  route();
});

// =====================================================================================
// routing: an app of views ("/", "/faces", "/sets", "/mine", "/guide") and "/face/:id"
// =====================================================================================
function route() {
  const m = location.pathname.match(/^\/face\/(\d+)/) || location.hash.match(/^#\/face\/(\d+)/);
  const tab = m ? "faces" : location.pathname.split("/")[1] ?? "";
  const view = m ? "face-page" : VIEWS[tab] ?? "view-home";
  document.querySelectorAll("#app > .page").forEach((p) => (p.hidden = p.id !== view));
  document.querySelectorAll("[data-tab]").forEach((a) => a.toggleAttribute("aria-current", a.dataset.tab === (VIEWS[tab] ? tab : "")));
  const changed = view !== lastView;
  lastView = view;
  if (m) {
    window.scrollTo(0, 0);
    showFace(Number(m[1]));
  } else if (location.hash.length > 1) {
    requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: changed ? "auto" : "smooth" }));
  } else if (changed) {
    window.scrollTo(0, 0);
  }
  if (view === "view-mine") renderMyFaces();
}

// open a minted Face by number (Faces view)
$("#faces-open").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = Number($("#faces-open-id").value);
  if (v >= 1 && v <= 5555) {
    history.pushState({}, "", `/face/${v}`);
    route();
  }
});

// =====================================================================================
// gallery + modal
// =====================================================================================
function attr(f, k) {
  return decode(f.record).traits.find((x) => x.trait_type === k)?.value;
}

// Once the art is sealed on-chain, the gallery bytes are read straight from NeonArt instead of the bundle.
async function liveRecords() {
  if (state.preview) return;
  try {
    if (!(await readAt(state.dep.art, "art", "isSealed"))) return;
    const recs = await Promise.all(gallery.map((f) => readAt(state.dep.art, "art", "artData", [BigInt(f.artId)])));
    recs.forEach((rec, i) => (gallery[i].record = rec));
    $("#gallery-source").textContent = `Read live from NeonArt ${short(state.dep.art)}.`;
  } catch {}
}

function renderGallery(limit = 48) {
  const grid = $("#gallery-grid");
  grid.innerHTML = gallery
    .slice(0, limit)
    .map(
      (f) => `<button class="g-item" data-art="${f.artId}" aria-label="Face preview ${f.artId}">
        <img loading="lazy" src="${faceURI(f)}" alt="">
        <span class="g-meta">${esc(attr(f, "Crop"))} · ${esc(f.stare)}${f.artId >= SINGLES ? ` · Set #${Math.floor((f.artId - SINGLES) / 4) + 1}` : ""}</span></button>`,
    )
    .join("");
  grid.querySelectorAll(".g-item").forEach((b) => b.addEventListener("click", () => openModal(Number(b.dataset.art))));
  let more = $(".gallery-more");
  if (!more && gallery.length > limit) {
    more = document.createElement("div");
    more.className = "gallery-more";
    more.innerHTML = `<button class="btn btn-ghost">Show more faces</button>`;
    grid.after(more);
    more.firstChild.addEventListener("click", () => { renderGallery(gallery.length); more.remove(); });
  }
}

function openModal(artId) {
  const f = gallery.find((x) => x.artId === artId);
  let m = $("#modal");
  if (!m) {
    m = document.createElement("div");
    m.id = "modal";
    m.className = "modal";
    document.body.appendChild(m);
    m.addEventListener("click", (e) => { if (e.target === m || e.target.closest(".modal-close")) m.hidden = true; });
    window.addEventListener("keydown", (e) => e.key === "Escape" && (m.hidden = true));
  }
  m.innerHTML = `<button class="btn btn-ghost modal-close">Close</button>
    <div class="modal-box">
      <canvas width="480" height="480"></canvas>
      <div>
        <div class="label">Art ${artId} · ${decode(f.record).g}×${decode(f.record).g} blocks · ${(f.record.length - 2) / 2} bytes</div>
        <div class="face-traits"><div><span>Stare</span>${esc(f.stare)}</div>${decode(f.record).traits.map((a) => `<div><span>${esc(a.trait_type)}</span>${esc(a.value)}</div>`).join("")}</div>
        <p class="fine">This is the exact SVG the contract returns: same bytes, same renderer, ported to your browser. Which Face you get is decided on-chain at reveal.</p>
        <a class="btn btn-ghost" download="neonfaces-art-${artId}.svg" href="${faceURI(f)}">Download SVG</a>
      </div>
    </div>`;
  m.hidden = false;
  dissolveIn(m.querySelector("canvas"), faceURI(f));
}

// pixel dissolve: the Face resolves from 4 blocks to 480
function dissolveIn(cv, src) {
  const ctx = cv.getContext("2d");
  const img = new Image();
  img.onload = () => {
    sound.sweep();
    ctx.imageSmoothingEnabled = false;
    const steps = [4, 8, 16, 32, 64, 480];
    const tmp = document.createElement("canvas");
    const tctx = tmp.getContext("2d");
    steps.forEach((s, i) =>
      setTimeout(() => {
        tmp.width = tmp.height = s;
        tctx.drawImage(img, 0, 0, s, s);
        ctx.drawImage(tmp, 0, 0, s, s, 0, 0, 480, 480);
      }, i * 90),
    );
  };
  img.src = src;
}

// =====================================================================================
// sets: the four pieces close up on hover into the whole face
// =====================================================================================
function renderSets() {
  $("#sets-grid").innerHTML = sets
    .map(
      (s) => `<div class="set-card" tabindex="0">
        <div class="set-quad">${s.records.map((r, q) => `<img loading="lazy" src="${svgDataURI(SINGLES + 4 * (s.set - 1) + q, r)}" alt="${PIECES[q]}">`).join("")}</div>
        <span class="g-meta">Set #${s.set} · ${esc(s.face)} · ${esc(s.stare)}</span></div>`,
    )
    .join("");
}

// =====================================================================================
// set hunter: where the missing pieces are (read live, watched sets remembered in this browser)
// =====================================================================================
function setupHunter() {
  if (state.preview) {
    $("#hunter-list").innerHTML = `<p class="fine">Opens with the collection: sets are dealt at the reveal.</p>`;
    $("#hunter-form").hidden = true;
    return;
  }
  $("#hunter-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const id = Number($("#hunter-id").value);
    if (id >= 1 && id <= 5555) runHunter([id]);
  });
  $("#hunter-mine").addEventListener("click", () => (state.account ? runHunter("mine") : doConnect().catch((e) => e.message !== "cancelled" && toast(errMsg(e)))));
  runHunter([]); // watched sets and what moved since the last visit
}

async function runHunter(which) {
  const ticket = ++hunting;
  const list = $("#hunter-list");
  list.innerHTML = `<p class="fine">Looking…</p>`;
  try {
    const ids = which === "mine" ? await facesOf(state.account).catch(() => []) : which;
    if (ticket !== hunting) return;
    await hunt(list, $("#hunter-alerts"), ids, state.account);
  } catch (e) {
    if (ticket === hunting) list.innerHTML = `<p class="fine">${esc(errMsg(e))}</p>`;
  }
}

// =====================================================================================
// the watch: longest stares + sets completed (read live, refreshed with the mint panel)
// =====================================================================================
async function renderWatch() {
  if (state.preview) return;
  try {
    const top = await longestStares(10);
    if (top.length)
      $("#watch-stares").innerHTML = top
        .map((x) => `<li><a href="/face/${x.id}" data-link>Face #${x.id}</a><span class="fine">${esc(x.owner)}</span><b>${x.days}d</b></li>`)
        .join("");
    const [done, sealed, supply, closed] = await Promise.all([
      completedSets(),
      readAt(state.dep.art, "art", "isSealed").catch(() => false),
      read("faces", "totalSupply"),
      read("faces", "mintClosed"),
    ]);
    const dealt = Math.floor((Number(supply) * 555) / 5555);
    $("#sets-count").textContent = closed ? `${done.length} / ${dealt}` : done.length ? `${done.length}` : "";
    if (!done.length) return;
    const shown = done.slice(0, 12);
    const recs = sealed
      ? await Promise.all(shown.map((d) => Promise.all([0, 1, 2, 3].map((q) => readAt(state.dep.art, "art", "artData", [BigInt(SINGLES + 4 * (d.setId - 1) + q)])))))
      : [];
    $("#watch-sets").innerHTML = shown
      .map((d, i) => `<a href="/face/${d.anchor}" data-link>${recs[i] ? `<img src="${setDataURI(d.setId, recs[i])}" alt="">` : ""}Set #${d.setId} · Face #${d.anchor}<br>${fmtDay(d.t)}</a>`)
      .join("");
  } catch {}
}

// =====================================================================================
// traits
// =====================================================================================
function renderTraits() {
  if (!rarity) return;
  const el = $("#trait-explorer");
  el.innerHTML = rarity.traits
    .map((t) => {
      const bars = t.values
        .map((v) => {
          const pct = (100 * v.count) / rarity.total;
          return `<div class="bar"><span>${esc(v.value)}</span><span class="pct">${v.count} · ${pct.toFixed(pct < 1 ? 2 : 1)}%</span>
          <div class="track"><div class="fill" style="--w:${Math.max(pct, 0.6)}%"></div></div></div>`;
        })
        .join("");
      return `<div class="trait"><h3>${esc(t.trait)} <small>${t.values.length} values</small></h3>${bars}</div>`;
    })
    .join("");
}

// =====================================================================================
// split
// =====================================================================================
async function renderSplit() {
  const parts = [
    { pct: 55, name: "Seed vault", desc: "A contract that can only buy the basket tokens for the Faces, at Chainlink-checked prices. The product promise." },
    { pct: 15, name: "Treasury", desc: "Multisig: art, site, audit, market making." },
    { pct: 15, name: "Team", desc: "Streams through a 6-month linear vesting contract. No floor dumps." },
    { pct: 15, name: "Growth", desc: "Collabs and growth." },
  ];
  if (!state.preview) {
    try {
      const [accounts] = await read("payout", "payees");
      accounts.forEach((a, i) => (parts[i].addr = a));
    } catch {}
  }
  const colors = ["#ccff00", "#94b21d", "#677920", "#414d12"];
  let acc = 0;
  const R = 80;
  const C = 2 * Math.PI * R;
  $("#donut").innerHTML =
    parts
      .map((p, i) => {
        const seg = `<circle cx="100" cy="100" r="${R}" fill="none" stroke="${colors[i]}" stroke-width="34" stroke-dasharray="${(p.pct / 100) * C - 2} ${C}" stroke-dashoffset="${-acc * C / 100}" transform="rotate(-90 100 100)"/>`;
        acc += p.pct;
        return seg;
      })
      .join("") + `<text x="100" y="96" text-anchor="middle" fill="#f2ffc8" font-family="Silkscreen" font-size="16">MINT</text><text x="100" y="118" text-anchor="middle" fill="#8a9a5a" font-family="JetBrains Mono" font-size="10">on-chain split</text>`;
  $("#split-list").innerHTML = parts
    .map((p) => {
      const link = p.addr ? explorer(`address/${p.addr}`) : null;
      const addr = p.addr ? `<small>${link ? `<a href="${link}" target="_blank" rel="noopener">${p.addr}</a>` : p.addr}</small>` : "";
      return `<li><b>${p.pct}%</b><div><span><strong>${p.name}</strong>: ${p.desc}</span>${addr}</div></li>`;
    })
    .join("");
}

function renderFooter() {
  const el = $("#foot-contracts");
  if (state.preview) {
    el.textContent = "Contracts: deploying soon on Robinhood Chain (4663)";
    return;
  }
  const d = state.dep;
  const items = [["Faces", d.faces], ["Payout", d.payout], ["Seeder", d.seeder], ["Art", d.art], ["Renderer", d.renderer]];
  el.innerHTML = items
    .map(([n, a]) => {
      const l = explorer(`address/${a}`);
      return l ? `<a href="${l}" target="_blank" rel="noopener">${n} ${short(a)}</a>` : `<span>${n} ${short(a)}</span>`;
    })
    .join("");
}

// =====================================================================================
// wallet
// =====================================================================================
async function pickWallet() {
  const list = wallets();
  if (!list.length) {
    toast("No wallet found. Install a browser wallet (MetaMask, Rabby, Coinbase Wallet…)");
    throw new Error("no wallet");
  }
  if (list.length === 1) return list[0].provider;
  return new Promise((resolve, reject) => {
    const m = document.createElement("div");
    m.className = "modal";
    m.innerHTML = `<div class="picker"><h3>Choose a wallet</h3>${list
      .map((w, i) => `<button data-i="${i}">${w.info.icon ? `<img src="${esc(w.info.icon)}" alt="">` : ""}${esc(w.info.name)}</button>`)
      .join("")}</div>`;
    document.body.appendChild(m);
    m.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-i]");
      if (b) { m.remove(); resolve(list[Number(b.dataset.i)].provider); }
      else if (e.target === m) { m.remove(); reject(new Error("cancelled")); }
    });
  });
}

async function doConnect() {
  if (state.preview) return toast("Not deployed yet. They're watching the chain.");
  const provider = await pickWallet();
  await connect(provider);
  await ensureChain();
}

$("#connect").addEventListener("click", () => doConnect().catch((e) => e.message !== "cancelled" && toast(errMsg(e))));
window.addEventListener("neon:account", () => {
  $("#connect").textContent = state.account ? short(state.account) : "Connect";
  renderMyFaces();
  if (state.account) runHunter("mine");
  if (!$("#face-page").hidden) route();
});

const FRIENDLY = {
  AccountIsLocked: "This Face's account is locked.",
  InvalidLock: "A lock can only be extended, up to 365 days.",
  InvalidAgentConfig: "Check the agent address, expiry and calls (the account itself can't be a target).",
  InsufficientPool: "The seed pool is short of a token: try again, the seed vault buys it first.",
  MarketOffPrice: ([token]) =>
    `${tokenOf(token)?.symbol ?? "This token"}'s market is more than 1% away from its reference price right now, so the seed vault won't buy it (it never overpays). Nothing was signed and nothing is lost: the keeper retries every 10 minutes, or try again later.`,
  NothingToRestock: "The pool already holds what this needs.",
  NotYourPiece: ([id]) => `#${id} isn't in your wallet: bring it over first (from another wallet, or out of the Face that holds it).`,
  SetIsFused: "This piece is fused into its set for good: it only moves with the Face that holds it.",
  NotTheHolder: "Only the wallet that holds this Face can do that.",
  SetAlreadyFused: "This set is already fused.",
  PollClosed: "This question is closed.",
  VaultEmpty: "The seed vault has no ETH left to buy it: the treasury can send ETH to the vault, or anyone can send the token to the pool.",
  StalePrice: "Stock prices aren't fresh (markets closed): buying waits for the next trading day.",
  NotUpgradeable: "Nothing to upgrade for this Face.",
  OwnershipCycle: "That would put a Face inside itself. Move the pieces into one Face only.",
  SetNotAssembled: "The other three pieces must be inside this Face's account first.",
  SetBonusAlreadyPaid: "This set's bonus was already paid.",
  Unauthorized: "Only the holder can do this.",
};

Object.assign(FRIENDLY, MINT_ERRORS);

const tokenOf = (address) => (state.dep?.tradeTokens ?? []).find((t) => t.address.toLowerCase() === String(address).toLowerCase());

function errMsg(e) {
  const data = e?.cause?.data?.errorName ? e.cause.data : e?.walk?.((x) => x?.data?.errorName)?.data;
  const f = data && FRIENDLY[data.errorName];
  if (f) return typeof f === "function" ? f(data.args ?? []) : f;
  const m = e?.shortMessage || e?.details || e?.message || String(e);
  if (/User rejected|denied/i.test(m)) return "Transaction rejected.";
  if (/insufficient funds|exceeds (the )?balance/i.test(m)) return "Not enough ETH on Robinhood Chain for this mint plus gas.";
  if (/Too little received/i.test(m)) return "This market is more than 1% away from its reference price right now, so NeonTrader won't trade at a worse price. Nothing was signed: try again later.";
  const custom = m.match(/reverted with the following reason:\s*(.*)|error (\w+)\(/);
  return custom ? custom[1] || custom[2] : m.slice(0, 180);
}

// =====================================================================================
// mint (on OpenSea) + the connected wallet's Faces
// =====================================================================================
function setupMint() {
  const pick = () => gallery[Math.floor(Math.random() * gallery.length)];
  $("#mint-preview").src = gallery.length ? faceURI(pick()) : svgDataURI(5555, placeholder);
  setInterval(() => gallery.length && ($("#mint-preview").src = faceURI(pick())), 1600);

  const btn = $("#opensea-btn");
  const url = state.dep?.opensea?.collection;
  if (url) btn.href = url;
  else {
    btn.removeAttribute("href");
    btn.classList.add("disabled");
    btn.textContent = "OpenSea drop: link soon";
  }
  if (state.preview) {
    $("#phase-pill").textContent = "Coming soon";
    $("#progress-text").textContent = "0 / 5555";
    $("#my-faces").innerHTML = `<span class="fine">Your Faces show up here once the collection is deployed and you connect your wallet.</span>`;
    return;
  }
  refreshMint();
  setInterval(refreshMint, 12_000);
  loadDrop().then((drop) => drop && startSiteMint(drop));
}

/** Plan B: the panel mints here. The words that said "on OpenSea" say where the mint really happens. */
function startSiteMint(drop) {
  siteMint = true;
  const fee = Number(drop.list.feeBps) / 100;
  $("#hero-mint").textContent = "Mint";
  const btn = $("#opensea-btn");
  btn.className = "btn btn-ghost btn-wide";
  btn.textContent = "The collection on OpenSea ↗";
  if (!btn.href) btn.hidden = true;
  $("#mint-fine").textContent = `Minting happens right here, through OpenSea's SeaDrop contract: the same contract OpenSea's own drops use, so the stage, price, limit and list are enforced on-chain, not by this page. Each Face is minted with its account and base basket in the same transaction. Stock Tokens give economic exposure only, not ownership of shares.`;
  $("#funds-lead").innerHTML = `The mint runs through OpenSea's SeaDrop contract${fee ? `, and OpenSea keeps ${fee}% of primary sales` : ""}. The rest can only be paid to <code>NeonPayout</code>: shares and addresses are immutable, and anyone can push the split with <code>releaseAll()</code>. Resale royalties: 5% suggested on-chain (ERC-2981) to the treasury multisig, optional because transfers are never restricted.`;
  $("#faq-where").textContent = "Right here: the Mint button on Home opens the panel, which mints through OpenSea's SeaDrop contract on Robinhood Chain. Your Faces show up on OpenSea and trade there. This app is also where you look inside your Faces and manage them: withdraw, trade, lock, assemble sets, delegate an agent.";
  setupSiteMint({
    doConnect,
    errMsg,
    toast,
    sound,
    records: gallery.map((f) => f.record),
    onMinted: () => { refreshMint(); renderMyFaces(); },
    open: (id) => { history.pushState({}, "", `/face/${id}`); route(); },
  });
}

async function refreshMint() {
  if (state.preview) return;
  try {
    const [supply, funded, closed] = await Promise.all([read("faces", "totalSupply"), read("seeder", "fundedCount"), read("faces", "mintClosed")]);
    const done = closed || supply >= 5555n;
    if (!siteMint) $("#phase-pill").textContent = done ? "Mint over · trade on OpenSea" : "Minting on OpenSea";
    if (!siteMint) $("#phase-pill").classList.toggle("live", !done);
    if (done && state.dep?.opensea?.collection) $("#opensea-btn").textContent = "View on OpenSea ↗";
    $("#progress-text").textContent = `${supply} / 5555`;
    $("#progress-bar").style.width = `${(Number(supply) / 5555) * 100}%`;
    $("#seeded-text").textContent = `${funded} seeded`;
    document.querySelectorAll('[data-stat="minted"]').forEach((e) => (e.textContent = supply.toString()));
    document.querySelectorAll('[data-stat="seeded"]').forEach((e) => (e.textContent = funded.toString()));
  } catch {}
}

async function renderMyFaces() {
  const el = $("#my-faces");
  if (state.preview) return;
  if (!state.account) {
    el.innerHTML = `<button class="btn btn-ghost" id="my-connect">Connect to see yours</button>`;
    $("#my-connect").onclick = () => doConnect().catch((e) => e.message !== "cancelled" && toast(errMsg(e)));
    return;
  }
  el.innerHTML = `<span class="fine">Looking…</span>`;
  const ids = await facesOf(state.account).catch(() => []);
  el.innerHTML = ids.length
    ? ids.map((id) => `<a href="/face/${id}" data-link>#${id} →</a>`).join("")
    : `<span class="fine">No Face found for ${short(state.account)}. Know the number? Open it: <a href="/face/1" data-link>/face/&lt;number&gt;</a></span>`;
}

// =====================================================================================
// face page
// =====================================================================================
const fmtDate = (sec) => new Date(Number(sec) * 1000).toISOString().slice(0, 16).replace("T", " ");

async function showFace(id) {
  $("#face-title").textContent = `NEONFACES #${id}`;
  $("#face-img").src = placeholder ? svgDataURI(5555, placeholder) : "";
  ["#face-owner", "#face-account", "#face-balances", "#face-traits", "#face-agent", "#face-links", "#face-actions", "#face-set"].forEach((s) => ($(s).innerHTML = ""));
  $("#face-journal").innerHTML = `<li class="fine">Nothing yet.</li>`;
  $("#face-set").hidden = true;
  $("#face-holder")?.remove();
  $("#face-agent").hidden = $("#face-agent").previousElementSibling.hidden = false;
  $("#face-search").onsubmit = (e) => {
    e.preventDefault();
    const v = Number($("#face-search-id").value);
    if (v >= 1 && v <= 5555) { history.pushState({}, "", `/face/${v}`); route(); }
  };
  if (state.preview) {
    $("#face-owner").innerHTML = `<b>status</b> collection not deployed yet`;
    return;
  }
  try {
    const [owner, meta, seed] = await Promise.all([
      read("faces", "ownerOf", [BigInt(id)]),
      metadata(id),
      read("seeder", "seedOf", [BigInt(id)]),
    ]);
    $("#face-img").src = meta.image; // on-chain SVG
    const accLink = explorer(`address/${seed.account}`);
    $("#face-owner").innerHTML = `<b>holder</b>${esc(owner)}`;
    $("#face-account").innerHTML = `<b>account</b>${accLink ? `<a href="${accLink}" target="_blank" rel="noopener">${seed.account}</a>` : seed.account} · <span class="neon">${seed.tier ? TIERS[seed.tier] : "Unrevealed"}</span>`;
    const show = (a) => (a.display_type === "date" ? new Date(a.value * 1000).toISOString().slice(0, 10) : a.trait_type === "Set" ? `#${a.value}` : a.value);
    $("#face-traits").innerHTML = meta.attributes.map((a) => `<div><span>${esc(a.trait_type)}</span>${esc(show(a))}</div>`).join("");

    // balances: seed tokens (always) + any tradable token the account holds + ETH
    const seedTokens = [...seed.legs, ...seed.upgradeLegs, ...(await bonusLegs(id))].map((l) => l.token.toLowerCase());
    const tokens = [...new Set([...seedTokens, ...(await knownTokens()).map((x) => x.toLowerCase())])];
    const deployed = !!(await state.pub.getCode({ address: seed.account }));
    const eth = await state.pub.getBalance({ address: seed.account });
    const rows = await Promise.all(
      tokens.map(async (t) => {
        const [bal, sym, dec] = await Promise.all([
          readAt(t, "erc20", "balanceOf", [seed.account]),
          readAt(t, "erc20", "symbol").catch(() => "?"),
          readAt(t, "erc20", "decimals").catch(() => 18),
        ]);
        return { sym, token: t, bal, dec: Number(dec), v: formatUnits(bal, dec), keep: bal > 0n || seedTokens.includes(t) };
      }),
    ).then((r) => r.filter((x) => x.keep));
    rows.push({ sym: "ETH", token: null, bal: eth, dec: 18, v: formatEther(eth) });
    const balRow = (b) =>
      `<div class="bal"><span>${esc(b.sym)}</span><b>${Number(b.v).toLocaleString("en-US", { maximumFractionDigits: 6 })}</b>${
        b.usd == null ? "" : `<em>${usd(b.usd)}</em>`
      }</div>`;
    $("#face-balances").innerHTML = rows.map(balRow).join("");
    showValue(seed.account, rows, balRow).catch(() => {});

    // permissionless actions: anyone can push a pending seed or a top-up
    const act = (label, fn) => {
      const btn = document.createElement("button");
      btn.className = "btn btn-neon";
      btn.textContent = label;
      btn.onclick = () => deliver(fn, id, () => showFace(id));
      $("#face-actions").appendChild(btn);
    };
    if (!seed.activated) act("Activate this Face", "activate");
    else if (!seed.funded) act("Seed pending: deliver it", "fund");
    if (seed.tier >= 2 && !seed.upgraded) act(`Deliver the ${TIERS[seed.tier]} top-up`, "upgrade");
    if ($("#face-actions").children.length) keeperNote($("#face-actions"));
    journal(id, seed.account)
      .then((entries) => {
        if (entries.length) $("#face-journal").innerHTML = entries.slice(0, 40).map((e) => `<li><time>${fmtDay(e.t)}</time>${esc(e.text)}</li>`).join("");
      })
      .catch(() => {});

    // agent + lock
    let agentInfo = null;
    let lockedUntil = 0n;
    if (deployed) {
      agentInfo = await readAt(seed.account, "account", "agentConfig");
      lockedUntil = await readAt(seed.account, "account", "effectiveLockedUntil"); // its own lock or the Face it sits in
    }
    const lockedNow = Number(lockedUntil) * 1000 > Date.now();
    if (seed.tier) await setPanel(id, owner, seed.account, lockedNow).catch(() => {});
    const [agent, , expiry, active, allowance] = agentInfo ?? [];
    $("#face-agent").innerHTML =
      (!deployed
        ? `<b>agent</b>account not deployed yet`
        : active
          ? `<b>agent</b>${agent}<br><b>until</b>${fmtDate(expiry)} · <b>ETH budget</b>${formatEther(allowance)}`
          : `<b>agent</b>none active`) +
      (lockedNow ? `<br><b>locked until</b><span class="neon">${fmtDate(lockedUntil)}</span>. The holder, agents and signatures can't move anything out` : "") +
      `<br><span class="fine" id="face-approvals">Checking token approvals…</span>`;
    approvalsCheck(id, seed.account, tokens).catch(() => ($("#face-approvals").textContent = ""));

    const links = [];
    const tl = explorer(`token/${state.dep.faces}/instance/${id}`);
    if (tl) links.push(`<a href="${tl}" target="_blank" rel="noopener">Blockscout ↗</a>`);
    if (state.dep.chain.opensea) links.push(`<a href="${state.dep.chain.opensea}/${state.dep.faces}/${id}" target="_blank" rel="noopener">OpenSea ↗</a>`);
    links.push(`<a href="${meta.image}" download="neonface-${id}.svg">Download SVG</a>`);
    $("#face-links").innerHTML = links.join("");

    if (new URLSearchParams(location.search).get("do") && !(state.account && state.account.toLowerCase() === owner.toLowerCase())) {
      $("#face-actions").insertAdjacentHTML("beforebegin", `<p class="msg">An action was prepared for this Face. Connect the wallet that holds it to review it; nothing happens without your confirmation.</p>`);
    }
    if (state.account && state.account.toLowerCase() === owner.toLowerCase() && deployed) {
      const ctx = { state, send, readAt, ABI, toast, reload: () => showFace(id) };
      await holderPanel(ctx, $("#face-links"), id, seed.account, agentInfo, lockedUntil);
      $("#face-agent").hidden = $("#face-agent").previousElementSibling.hidden = true; // the panel says it in full
    }
  } catch (e) {
    $("#face-owner").innerHTML = `<b>status</b>${/nonexistent|ERC721NonexistentToken|0x7e273289/i.test(String(e)) ? "not minted yet" : esc(errMsg(e))}`;
  }
}

/** Buyer check: approvals a lock can't stop, on this Face's account and on set pieces sitting inside it. */
async function approvalsCheck(id, account, tokens) {
  const accounts = [account];
  const [setId, , members] = await read("seeder", "setOf", [BigInt(id)]);
  if (setId) {
    for (const m of members.map(Number).filter((m) => m !== id)) {
      if ((await read("faces", "ownerOf", [BigInt(m)])).toLowerCase() === account.toLowerCase()) accounts.push(await read("seeder", "accountOf", [BigInt(m)]));
    }
  }
  const open = await openApprovals(accounts, tokens);
  const el = $("#face-approvals");
  if (!el) return;
  el.innerHTML = open.length
    ? `<b class="badge warn">Open token approvals</b>: ${open
        .map((a) => `${short(a.spender)} can take ${esc(a.amount)} ${esc(a.sym)}${a.account === account ? "" : " from a piece inside"}`)
        .join("; ")}. A lock doesn't stop these: before buying, ask the holder to revoke them.`
    : "No open token approvals: what is inside can only move with the holder, and not at all while locked.";
}

/** Legs of the set bonus this Face received (none if it isn't a set's bonus anchor). */
async function bonusLegs(id) {
  const [setId] = await read("seeder", "setOf", [BigInt(id)]);
  if (!setId) return [];
  const [anchor, basketId] = await read("seeder", "setBonus", [setId]);
  return Number(anchor) === id ? read("seeder", "basket", [basketId]) : [];
}

// ---- set panel: where the four pieces are, assemble / take apart, the one-time bonus ----
async function setPanel(id, owner, account, lockedNow) {
  const [setId, piece, members] = await read("seeder", "setOf", [BigInt(id)]);
  if (!setId) return;
  const el = $("#face-set");
  const ids = members.map(Number);
  const [owners, accounts, assembledHere, bonus, sealed, fusedInfo] = await Promise.all([
    Promise.all(ids.map((m) => read("faces", "ownerOf", [BigInt(m)]))),
    Promise.all(ids.map((m) => read("seeder", "accountOf", [BigInt(m)]))),
    read("seeder", "isAssembled", [BigInt(id)]),
    read("seeder", "setBonus", [setId]),
    readAt(state.dep.art, "art", "isSealed").catch(() => false),
    read("seeder", "fusedSet", [setId]).catch(() => [0, 0n]),
  ]);
  const fused = Number(fusedInfo[0]) !== 0;
  const fusedHere = Number(fusedInfo[0]) === id;
  const recs = sealed ? await Promise.all(ids.map((_, q) => readAt(state.dep.art, "art", "artData", [BigInt(SINGLES + 4 * (Number(setId) - 1) + q)]))) : null;
  const lc = (a) => a.toLowerCase();
  const me = state.account && lc(state.account);
  const mine = me && lc(owner) === me;
  // an anchor inside another Face's account: its holder acts through that account (execute)
  const viaAccount = !mine && me && lc((await readAt(owner, "account", "holder").catch(() => null)) ?? "") === me ? owner : null;
  const control = mine || !!viaAccount;
  const act = (target, abi, functionName, args, done) =>
    viaAccount
      ? send(viaAccount, ABI.accountExec, "executeBatch", [[{ target, value: 0n, data: encodeFunctionData({ abi, functionName, args }) }], 0], done)
      : send(target, abi, functionName, args, done);
  // where each piece is: in this Face's account, inside another piece, or with a holder
  const where = (q) => {
    if (ids[q] === id) return "this Face";
    const k = accounts.findIndex((a) => lc(a) === lc(owners[q]));
    if (k >= 0) return ids[k] === id ? "inside this Face" : `inside #${ids[k]}`;
    return me && lc(owners[q]) === me ? "your wallet" : short(owners[q]);
  };
  const os = state.dep.chain.opensea;
  el.innerHTML = `<h3>Set #${setId} · ${esc(PIECES[Number(piece)])}</h3>
    <div class="pieces">${ids
      .map((m, q) => `<div class="piece${m === id ? " here" : ""}">${recs ? `<img src="${svgDataURI(SINGLES + 4 * (Number(setId) - 1) + q, recs[q])}" alt="">` : ""}
        <a href="/face/${m}" data-link><b>#${m}</b></a>${esc(PIECES[q])}<br>${esc(where(q))}${os && (!me || lc(owners[q]) !== me) && m !== id ? `<br><a href="${os}/${state.dep.faces}/${m}" target="_blank" rel="noopener">OpenSea ↗</a>` : ""}</div>`)
      .join("")}</div>
    <p class="fine">${fusedHere
      ? `Fused for good on ${fmtDate(fusedInfo[1])}: the three pieces can never leave this Face, so the set only changes hands whole.${lockedNow ? "" : control ? " Their baskets can still move: lock it before listing, so buyers see they stay." : ' <b class="badge warn">Not locked</b>: the pieces stay, but the baskets inside can still be withdrawn before a sale completes.'}`
      : fused
        ? `Fused for good inside <a href="/face/${fusedInfo[0]}" data-link>Face #${fusedInfo[0]}</a>: this piece only changes hands with it.`
        : assembledHere
          ? `Assembled: this Face holds the other three pieces and shows the whole face. Selling it sells the set.${lockedNow ? "" : control ? " Listing it? Lock it first on this page, so buyers can see the pieces can't leave before the sale." : ' <b class="badge warn">Not locked</b>: the holder can still take the pieces out before a sale completes. Ask for a lock before buying.'}`
          : `Assemble the set by moving the other three pieces into one piece's account: that Face then shows the whole face.`}
    ${Number(bonus[0]) ? ` Set bonus paid to #${bonus[0]}.` : " The first assembly earns a one-time bonus basket, delivered with the last piece."}</p>
    <div class="set-total" hidden></div>
    <div class="face-actions"></div>`;
  $("#face-set").hidden = false;
  if (assembledHere) setTotal(el.querySelector(".set-total"), accounts).catch(() => {});
  const actions = el.querySelector(".face-actions");
  const button = (label, fn) => {
    const b = document.createElement("button");
    b.className = "btn btn-neon";
    b.textContent = label;
    b.onclick = fn;
    actions.appendChild(b);
  };
  const reload = () => showFace(id);
  const others = ids.filter((m) => m !== id);
  if (mine && !assembledHere && others.every((m) => [me, lc(account)].includes(lc(owners[ids.indexOf(m)])))) {
    button("Assemble here (one transaction)", async () => {
      toast(`Moving the other pieces into #${id}…`);
      if (!(await send(state.dep.faces, ABI.faces, "assembleSet", [BigInt(id)]))) return reload();
      // the last move delivers the bonus itself; claim only if the pool was short at that moment
      if (await read("seeder", "setBonusDue", [BigInt(id)]).catch(() => false)) await deliver("claimSetBonus", id);
      reload();
    });
  } else if (mine && !assembledHere) {
    const inside = others.filter((m) => where(ids.indexOf(m)).startsWith("inside #"));
    el.querySelector(".fine").insertAdjacentHTML("beforeend", inside.length
      ? ` To assemble here, first take the set apart on the Face that holds ${inside.map((m) => `#${m}`).join(", ")}.`
      : " Hold all four pieces in this wallet to assemble.");
  }
  if (control && assembledHere && !fused) {
    button("Fuse for good", () => {
      if (!confirm(`Fuse set #${setId} into Face #${id} for good?

The three pieces can never leave this Face again: the set will only ever change hands whole, and the whole face gets its fused frame. This can't be undone.`)) return;
      act(state.dep.seeder, ABI.seeder, "fuse", [BigInt(id)], reload);
    });
  }
  if (mine && assembledHere && !fused) {
    button("Take apart", () =>
      send(account, ABI.accountExec, "executeBatch", [
        others.map((m) => ({ target: state.dep.faces, value: 0n, data: encodeFunctionData({ abi: ABI.faces, functionName: "transferFrom", args: [account, state.account, BigInt(m)] }) })),
        0,
      ], reload),
    );
  }
  if (assembledHere && !Number(bonus[0])) button("Deliver the set bonus", () => deliver("claimSetBonus", id, reload));
  if (control && assembledHere) sayPanel(el, id, setId, act, reload).catch(() => {});
}

/** Polls asked to the assembled sets (NeonSetVotes), newest first, with their results. */
async function polls(limit = 3) {
  if (!state.dep?.setVotes) return [];
  const n = Number(await read("setVotes", "pollCount"));
  const out = [];
  for (let i = n - 1; i >= 0 && out.length < limit; i--) {
    const [question, choices, start, end, votes, counts] = await read("setVotes", "poll", [BigInt(i)]);
    const now = Date.now() / 1000;
    out.push({ id: i, question, choices, start: Number(start), end: Number(end), votes: Number(votes), counts: counts.map(Number), open: now >= Number(start) && now < Number(end) });
  }
  return out;
}

const pollHTML = (p, mineVote) =>
  `<div class="poll"><p><b>${esc(p.question)}</b><br><span class="fine">${p.open ? `open until ${fmtDate(p.end)} UTC` : `closed ${fmtDate(p.end)} UTC`} · ${p.votes} set${p.votes === 1 ? "" : "s"} voted</span></p>${p.choices
    .map((c, i) => {
      const pct = p.votes ? Math.round((100 * p.counts[i]) / p.votes) : 0;
      return `<div class="poll-row${mineVote === i ? " mine" : ""}"><span>${esc(c)}</span><b>${p.counts[i]}</b><i style="width:${pct}%"></i></div>`;
    })
    .join("")}</div>`;

async function setupSay() {
  const list = await polls();
  if (!list.length) return;
  $("#say-list").innerHTML =
    list.map((p) => pollHTML(p)).join("") +
    (list.some((p) => p.open) ? `<p class="fine">Hold an assembled set? Vote from the page of the Face that holds it.</p>` : "");
  $("#say").hidden = false;
}

/** On an assembled set you hold: vote in the open polls (the set votes; you can change it until the poll ends). */
async function sayPanel(el, id, setId, act, reload) {
  for (const p of (await polls()).filter((x) => x.open)) {
    const mineVote = Number(await read("setVotes", "voteOf", [BigInt(p.id), setId]));
    const box = document.createElement("div");
    box.className = "say";
    box.innerHTML = `<h4>The sets' say</h4>${pollHTML(p, mineVote)}<div class="face-actions"></div>`;
    for (const [i, c] of p.choices.entries()) {
      const b = document.createElement("button");
      b.className = mineVote === i ? "btn btn-ghost" : "btn btn-neon";
      b.textContent = mineVote === i ? `${c} (this set's vote)` : `Vote ${c}`;
      b.disabled = mineVote === i;
      b.onclick = () => act(state.dep.setVotes, ABI.setVotes, "vote", [BigInt(p.id), BigInt(id), BigInt(i)], reload);
      box.querySelector(".face-actions").appendChild(b);
    }
    el.appendChild(box);
  }
}

function usd(n) {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Dollar value of what the Face holds (Chainlink, live) and a 30-day line; refreshed every minute while open. */
async function showValue(account, rows, balRow) {
  const box = $("#face-value");
  if (!box || !state.dep.trader) return;
  const paint = async () => {
    const live = await liveValue(rows.filter((r) => r.bal > 0n));
    if (!live.rows.some((r) => r.usd != null)) return;
    const priced = new Map(live.rows.map((r) => [r.sym, r]));
    $("#face-balances").innerHTML = rows.map((r) => balRow(priced.get(r.sym) ?? r)).join("");
    const age = live.oldest ? Math.round((Date.now() / 1000 - live.oldest) / 3600) : null;
    box.querySelector(".v-total").innerHTML = `<b>${usd(live.total)}</b><span class="fine">at Chainlink prices${
      age != null && age >= 2 ? `, some last updated ${age < 48 ? `${age} h` : `${Math.round(age / 24)} days`} ago (stock markets closed)` : ", live"
    }</span>`;
  };
  box.hidden = false;
  box.innerHTML = `<h4>Value inside</h4><div class="v-total"><span class="fine">Reading Chainlink prices…</span></div><div class="v-chart"></div>`;
  await paint();
  clearInterval(box.dataset.timer); // one refresh loop, for the Face on screen
  const timer = setInterval(() => (location.pathname.startsWith("/face/") ? paint().catch(() => {}) : clearInterval(timer)), 60_000);
  box.dataset.timer = timer;
  const hist = await valueHistory(account, rows.filter((r) => r.bal > 0n));
  if (hist && hist.v.some((x) => x > 0)) {
    box.querySelector(".v-chart").innerHTML =
      sparkline(hist) + `<p class="fine">The tokens inside over the last 30 days, at each day's Chainlink price (ETH at today's amount). A record of prices, not a forecast.</p>`;
  }
}

/** What the whole assembled set holds: this Face's account plus the three pieces inside it, all of which change
 *  hands with this Face. Marketplaces only show the anchor's own balances. */
async function setTotal(el, accounts) {
  const tokens = [...new Set((await knownTokens()).map((t) => t.toLowerCase()))];
  const rows = (
    await Promise.all(
      tokens.map(async (t) => {
        const [bals, sym, dec] = await Promise.all([
          Promise.all(accounts.map((a) => readAt(t, "erc20", "balanceOf", [a]))),
          readAt(t, "erc20", "symbol").catch(() => "?"),
          readAt(t, "erc20", "decimals").catch(() => 18),
        ]);
        return { sym, v: bals.reduce((x, y) => x + y, 0n), dec };
      }),
    )
  ).filter((r) => r.v > 0n);
  const eth = (await Promise.all(accounts.map((a) => state.pub.getBalance({ address: a })))).reduce((x, y) => x + y, 0n);
  if (eth > 0n) rows.push({ sym: "ETH", v: eth, dec: 18 });
  if (!rows.length) return;
  el.innerHTML = `<h4>The whole set holds</h4><p class="fine">This Face and the three pieces inside it, each with its own basket: all of it changes hands with this Face.</p><div class="balances">${rows
    .map((b) => `<div class="bal"><span>${esc(b.sym)}</span><b>${Number(formatUnits(b.v, b.dec)).toLocaleString("en-US", { maximumFractionDigits: 6 })}</b></div>`)
    .join("")}</div>`;
  el.hidden = false;
}

/** Under pending deliveries: who delivers them, and that nobody has to wait for anyone. */
function keeperNote(el) {
  const p = document.createElement("p");
  p.className = "fine";
  p.textContent = "The keeper delivers this on its next round, usually within minutes; while stock markets are closed (weekends), when they reopen. Still pending after an hour on a trading day? Deliver it yourself here, in one transaction: if the pool is short, the seed vault buys what is missing in the same transaction.";
  el.appendChild(p);
}

/** A permissionless delivery (activate / fund / upgrade / claimSetBonus). When the pool holds the basket, the seeder
 *  delivers it. When it is short, free simulations find every missing token, then one transaction makes the seed vault
 *  buy them all (`restockAndDeliver`: anyone can, only what Faces are owed, at Chainlink-checked prices) and deliver:
 *  one signature, and never a transaction that would fail. */
const VIA_VAULT = { fund: 1, upgrade: 2, claimSetBonus: 3 };
async function deliver(fn, id, done) {
  try {
    if (!state.account) await doConnect();
    await ensureChain();
  } catch (e) {
    return e?.message !== "cancelled" && toast(errMsg(e));
  }
  const sim = (address, abi, functionName, args) => state.pub.simulateContract({ address, abi, functionName, args, account: state.account });
  const revertOf = (e) => e?.walk?.((x) => x.name === "ContractFunctionRevertedError")?.data;
  try {
    await sim(state.dep.seeder, ABI.seeder, fn, [BigInt(id)]);
    return send(state.dep.seeder, ABI.seeder, fn, [BigInt(id)], done);
  } catch (e) {
    if (revertOf(e)?.errorName !== "InsufficientPool" || !VIA_VAULT[fn] || !state.dep.seedVault) return toast(errMsg(e));
  }
  const paths = [];
  const fees = [];
  const names = [];
  for (let tries = 0; tries < 9; tries++) {
    const args = [VIA_VAULT[fn], BigInt(id), paths, fees];
    try {
      await sim(state.dep.seedVault, ABI.seedVault, "restockAndDeliver", args);
      toast(`The pool is short of ${names.join(", ")}: one transaction buys ${names.length > 1 ? "them" : "it"} and delivers.`);
      return send(state.dep.seedVault, ABI.seedVault, "restockAndDeliver", args, done);
    } catch (e) {
      const rev = revertOf(e);
      const t = rev?.errorName === "InsufficientPool" && tokenOf(rev.args[0]);
      if (!t || names.includes(t.symbol)) return toast(errMsg(e));
      const r = tradeRoute(state.dep, { symbol: "ETH" }, t);
      paths.push(r.path);
      fees.push(r.fees);
      names.push(t.symbol);
    }
  }
  toast("The pool is short of too many tokens at once: the keeper is on it, try again in a few minutes.");
}

async function send(address, abi, functionName, args, done) {
  try {
    if (!state.account) await doConnect();
    await ensureChain();
    const { request } = await state.pub.simulateContract({ address, abi, functionName, args, account: state.account });
    const hash = await state.wallet.writeContract(request);
    toast("Sent. Waiting for the chain…");
    const r = await state.pub.waitForTransactionReceipt({ hash });
    toast(r.status === "success" ? "Done." : "Reverted.");
    (r.status === "success" ? sound.success : sound.error)();
    done?.();
    return r.status === "success";
  } catch (e) {
    toast(errMsg(e));
    sound.error();
    return false;
  }
}

// after every declaration above (top-level await: earlier calls could reach consts still in their TDZ)
setupSay().catch(() => {});
