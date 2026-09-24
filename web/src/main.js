import { formatEther, formatUnits, parseEther, parseEventLogs, toFunctionSelector } from "viem";
import { ABI, PHASES, TIERS, state, loadDeployment, read, readAt, wallets, connect, ensureChain, short, explorer, metadata } from "./chain.js";
import { pixelEye } from "./effects/eye.js";
import { decode, svgDataURI } from "./render.js";
import { boot, mosaic, reveals, cursor, tape, scramble, toast } from "./effects/fx.js";

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let gallery = []; // [{ artId, stare, record }] — on-chain pixel records
let placeholder = null;
let rarity = null;
const faceURI = (f) => svgDataURI(f.artId, f.record);

// =====================================================================================
// boot
// =====================================================================================
boot();
cursor();
tape($("#tape"));
pixelEye($("#eye"));
pixelEye($("#nav-eye"), { cols: 24, rows: 12, fade: false });

const [_, g, r] = await Promise.all([
  loadDeployment(),
  fetch("/data/gallery.json").then((x) => x.json()).catch(() => ({})),
  fetch("/data/rarity.json").then((x) => x.json()).catch(() => null),
]);
gallery = g.faces ?? [];
placeholder = g.placeholder;
rarity = r;
await liveRecords();

mosaic($("#mosaic"), gallery.map((f) => f.record));
renderGallery();
renderTraits();
renderSplit();
renderFooter();
reveals();
document.querySelectorAll(".hero [data-scramble]").forEach((el) => scramble(el, { duration: 1400 }));
setupMint();
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
// routing: "/" (home, with #sections) and "/face/:id"
// =====================================================================================
function route() {
  const m = location.pathname.match(/^\/face\/(\d+)/) || location.hash.match(/^#\/face\/(\d+)/);
  $("#home").hidden = !!m;
  $("#face-page").hidden = !m;
  if (m) {
    window.scrollTo(0, 0);
    showFace(Number(m[1]));
  } else if (location.hash.length > 1) {
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: "smooth" });
  }
}

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
        <span class="g-meta">${esc(attr(f, "Crop"))} · ${esc(f.stare)}</span></button>`,
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
    { pct: 40, name: "Seed vault", desc: "Buys Stock Tokens / USDG that refill the seed pool. The product promise." },
    { pct: 25, name: "Treasury", desc: "Multisig: art, site, market making." },
    { pct: 20, name: "Team", desc: "Streams through a 6-month linear vesting contract. No floor dumps." },
    { pct: 15, name: "Growth", desc: "Collabs and growth." },
  ];
  if (!state.preview) {
    try {
      const [accounts] = await read("minter", "payees");
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
      return `<li><b>${p.pct}%</b><div><span><strong>${p.name}</strong> — ${p.desc}</span>${addr}</div></li>`;
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
  const items = [["Faces", d.faces], ["Minter", d.minter], ["Seeder", d.seeder], ["Art", d.art], ["Renderer", d.renderer]];
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
  if (state.preview) return toast("Mint is not live yet. They're watching the chain.");
  const provider = await pickWallet();
  await connect(provider);
  await ensureChain();
}

$("#connect").addEventListener("click", () => doConnect().catch((e) => e.message !== "cancelled" && toast(errMsg(e))));
window.addEventListener("neon:account", () => {
  $("#connect").textContent = state.account ? short(state.account) : "Connect";
  refreshMint();
  if (!$("#face-page").hidden) route();
});

const FRIENDLY = {
  SaleNotActive: "Mint is closed right now.",
  NotAllowlisted: "This wallet is not on the list for this phase.",
  WalletLimit: "This wallet has reached its limit for this phase.",
  PhaseSoldOut: "This phase is sold out.",
  MintIsPaused: "Mint is paused.",
  ExceedsPublicAllocation: "Sold out.",
  WrongPayment: "Wrong ETH amount — refresh and try again.",
  InvalidQuantity: "Choose between 1 and 10.",
  MintIsClosed: "Mint is over.",
  AccountIsLocked: "This Face's account is locked.",
  InvalidLock: "A lock can only be extended, up to 365 days.",
  InvalidAgentConfig: "Check the agent address, expiry and calls (the account itself can't be a target).",
  InsufficientPool: "The seed pool is being refilled — try again later.",
  NotUpgradeable: "Nothing to upgrade for this Face.",
  Unauthorized: "Only the holder can do this.",
};

function errMsg(e) {
  const name = e?.cause?.data?.errorName ?? e?.walk?.((x) => x?.data?.errorName)?.data?.errorName;
  if (name && FRIENDLY[name]) return FRIENDLY[name];
  const m = e?.shortMessage || e?.details || e?.message || String(e);
  if (/User rejected|denied/i.test(m)) return "Transaction rejected.";
  const custom = m.match(/reverted with the following reason:\s*(.*)|error (\w+)\(/);
  return custom ? custom[1] || custom[2] : m.slice(0, 180);
}

// =====================================================================================
// mint
// =====================================================================================
const mintState = { phase: 0, cfg: null, allowance: 0, proof: [], remaining: 0 };
const allowlists = {};

function setupMint() {
  const pick = () => gallery[Math.floor(Math.random() * gallery.length)];
  $("#mint-preview").src = gallery.length ? faceURI(pick()) : svgDataURI(5555, placeholder);
  setInterval(() => gallery.length && ($("#mint-preview").src = faceURI(pick())), 1600);

  const qty = $("#qty");
  const clamp = () => (qty.value = Math.max(1, Math.min(Number(qty.value) || 1, Math.max(1, Math.min(10, mintState.remaining || 10)))));
  $("#qty-minus").onclick = () => { qty.value = Number(qty.value) - 1; clamp(); updatePrice(); };
  $("#qty-plus").onclick = () => { qty.value = Number(qty.value) + 1; clamp(); updatePrice(); };
  qty.onchange = () => { clamp(); updatePrice(); };
  $("#mint-btn").onclick = () => onMint().catch((e) => setMsg(errMsg(e), "err"));

  if (state.preview) {
    $("#phase-pill").textContent = "Coming soon";
    $("#progress-text").textContent = "0 / 5555";
    $("#mint-btn").textContent = "Mint opens soon";
    return;
  }
  refreshMint();
  setInterval(refreshMint, 12_000);
}

function updatePrice() {
  if (!mintState.cfg) return;
  const q = BigInt(Number($("#qty").value) || 1);
  const p = mintState.cfg.price * q;
  $("#phase-price").textContent = mintState.cfg.price === 0n ? "FREE" : `${formatEther(p)} ETH`;
}

function setMsg(t, cls = "") {
  const m = $("#mint-msg");
  m.textContent = t;
  m.className = `msg ${cls}`;
}

async function refreshMint() {
  if (state.preview) return;
  try {
    const [phase, supply, funded, closed] = await Promise.all([read("minter", "phase"), read("faces", "totalSupply"), read("seeder", "fundedCount"), read("faces", "mintClosed")]);
    const [price, maxPerWallet, supplyCap, minted] = await read("minter", "phaseConfig", [phase]);
    mintState.phase = Number(phase);
    mintState.cfg = { price, maxPerWallet, supplyCap, minted };
    const name = PHASES[mintState.phase];
    const live = !closed && mintState.phase >= 1 && mintState.phase <= 3;
    $("#phase-pill").textContent = live ? `${name} · live` : closed ? "Mint over" : name === "Finished" ? "Sold out / closed" : "Closed";
    $("#phase-pill").classList.toggle("live", live);
    $("#progress-text").textContent = `${supply} / 5555`;
    $("#progress-bar").style.width = `${(Number(supply) / 5555) * 100}%`;
    $("#phase-cap").textContent = supplyCap ? `phase: ${minted} / ${supplyCap}` : "";
    document.querySelectorAll('[data-stat="minted"]').forEach((e) => (e.textContent = supply.toString()));
    document.querySelectorAll('[data-stat="seeded"]').forEach((e) => (e.textContent = funded.toString()));
    updatePrice();

    const btn = $("#mint-btn");
    if (!live) { btn.disabled = true; btn.textContent = "Mint closed"; $("#al-status").textContent = ""; return; }
    if (!state.account) { btn.disabled = false; btn.textContent = "Connect wallet"; $("#al-status").textContent = ""; return; }

    const already = Number(await read("minter", "mintedBy", [phase, state.account]));
    if (name === "Public") {
      mintState.allowance = Number(maxPerWallet);
      mintState.proof = [];
      $("#al-status").textContent = `Public mint · ${already}/${maxPerWallet} used by this wallet`;
    } else {
      const key = name.toLowerCase();
      allowlists[key] ??= await fetch(`/allowlist/${key}.json`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
      const entry = allowlists[key]?.entries?.[state.account.toLowerCase()];
      if (!entry) {
        mintState.allowance = 0;
        $("#al-status").textContent = `${short(state.account)} is not on the ${name} list.`;
      } else {
        mintState.allowance = entry.allowance;
        mintState.proof = entry.proof;
        $("#al-status").textContent = `On the ${name} list ✓ · ${already}/${entry.allowance} used`;
      }
    }
    mintState.remaining = Math.max(0, mintState.allowance - already);
    btn.disabled = mintState.remaining === 0;
    btn.textContent = mintState.remaining === 0 ? "Nothing left to mint" : "Mint";
  } catch (e) {
    setMsg(`Chain read failed: ${errMsg(e)}`, "err");
  }
}

async function onMint() {
  if (!state.account) { await doConnect(); return refreshMint(); }
  await ensureChain();
  const q = BigInt(Math.min(Number($("#qty").value) || 1, mintState.remaining));
  const value = mintState.cfg.price * q;
  const name = PHASES[mintState.phase];
  const args = [q, BigInt(name === "Public" ? 0 : mintState.allowance), mintState.proof];
  setMsg("Simulating…");
  const { request } = await state.pub.simulateContract({ address: state.dep.minter, abi: ABI.minter, functionName: "mint", args, value, account: state.account });
  setMsg("Confirm in your wallet…");
  const hash = await state.wallet.writeContract(request);
  setMsg(`Minting… ${short(hash)}`);
  const receipt = await state.pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("transaction reverted");
  const [ev] = parseEventLogs({ abi: ABI.minter, logs: receipt.logs, eventName: "Minted" });
  const first = Number(ev.args.firstId);
  const ids = Array.from({ length: Number(ev.args.quantity) }, (_, i) => first + i);
  setMsg(`Minted ${ids.length} Face${ids.length > 1 ? "s" : ""}. Each one already has its account.`, "ok");
  $("#mint-result").innerHTML = ids.map((id) => `<a href="/face/${id}" data-link>#${id} →</a>`).join("");
  refreshMint();
}

// =====================================================================================
// face page
// =====================================================================================
// selectors that let an agent move assets out of the Face: the panel asks for confirmation
const RISKY = {
  "0xa9059cbb": "transfer — lets the agent send tokens anywhere",
  "0x23b872dd": "transferFrom — lets the agent move tokens",
  "0x095ea7b3": "approve — lets the agent approve ANY spender, including itself",
  "0x39509351": "increaseAllowance — same risk as approve",
  "0xa22cb465": "setApprovalForAll — hands over whole NFT collections",
  "0x42842e0e": "safeTransferFrom — moves NFTs out",
  "0xd505accf": "permit — signature-based approvals",
};

const fmtDate = (sec) => new Date(Number(sec) * 1000).toISOString().slice(0, 16).replace("T", " ");

async function showFace(id) {
  $("#face-title").textContent = `NEONFACES #${id}`;
  $("#face-img").src = placeholder ? svgDataURI(5555, placeholder) : "";
  ["#face-owner", "#face-account", "#face-balances", "#face-traits", "#face-agent", "#face-links", "#face-actions"].forEach((s) => ($(s).innerHTML = ""));
  $("#face-holder")?.remove();
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
    const show = (a) => (a.display_type === "date" ? new Date(a.value * 1000).toISOString().slice(0, 10) : a.value);
    $("#face-traits").innerHTML = meta.attributes.map((a) => `<div><span>${esc(a.trait_type)}</span>${esc(show(a))}</div>`).join("");

    // balances: every seed token (base + top-up) + ETH
    const tokens = [...new Set([...seed.legs, ...seed.upgradeLegs].map((l) => l.token))];
    const deployed = !!(await state.pub.getCode({ address: seed.account }));
    const eth = await state.pub.getBalance({ address: seed.account });
    const rows = await Promise.all(
      tokens.map(async (t) => {
        const [bal, sym, dec] = await Promise.all([
          readAt(t, "erc20", "balanceOf", [seed.account]),
          readAt(t, "erc20", "symbol").catch(() => "?"),
          readAt(t, "erc20", "decimals").catch(() => 18),
        ]);
        return { sym, v: formatUnits(bal, dec) };
      }),
    );
    rows.push({ sym: "ETH", v: formatEther(eth) });
    $("#face-balances").innerHTML = rows.map((b) => `<div class="bal"><span>${esc(b.sym)}</span><b>${Number(b.v).toLocaleString("en-US", { maximumFractionDigits: 6 })}</b></div>`).join("");

    // permissionless actions: anyone can push a pending seed or a top-up
    const act = (label, fn) => {
      const btn = document.createElement("button");
      btn.className = "btn btn-neon";
      btn.textContent = label;
      btn.onclick = () => send(state.dep.seeder, ABI.seeder, fn, [BigInt(id)], () => showFace(id));
      $("#face-actions").appendChild(btn);
    };
    if (!seed.activated) act("Activate this Face", "activate");
    else if (!seed.funded) act("Seed pending — deliver it", "fund");
    if (seed.tier >= 2 && !seed.upgraded) act(`Deliver the ${TIERS[seed.tier]} top-up`, "upgrade");

    // agent + lock
    let agentInfo = null;
    let lockedUntil = 0n;
    if (deployed) {
      agentInfo = await readAt(seed.account, "account", "agentConfig");
      lockedUntil = await readAt(seed.account, "account", "lockedUntil");
    }
    const lockedNow = Number(lockedUntil) * 1000 > Date.now();
    const [agent, , expiry, active, allowance] = agentInfo ?? [];
    $("#face-agent").innerHTML =
      (!deployed
        ? `<b>agent</b>account not deployed yet`
        : active
          ? `<b>agent</b>${agent}<br><b>until</b>${fmtDate(expiry)} · <b>ETH budget</b>${formatEther(allowance)}`
          : `<b>agent</b>none active`) +
      (lockedNow ? `<br><b>locked until</b><span class="neon">${fmtDate(lockedUntil)}</span> — nothing can leave this account` : "");

    const links = [];
    const tl = explorer(`token/${state.dep.faces}/instance/${id}`);
    if (tl) links.push(`<a href="${tl}" target="_blank" rel="noopener">Blockscout ↗</a>`);
    if (state.dep.chain.opensea) links.push(`<a href="${state.dep.chain.opensea}/${state.dep.faces}/${id}" target="_blank" rel="noopener">OpenSea ↗</a>`);
    links.push(`<a href="${meta.image}" download="neonface-${id}.svg">Download SVG</a>`);
    $("#face-links").innerHTML = links.join("");

    if (state.account && state.account.toLowerCase() === owner.toLowerCase() && deployed) holderPanel(id, seed.account, lockedNow);
  } catch (e) {
    $("#face-owner").innerHTML = `<b>status</b>${/nonexistent|ERC721NonexistentToken/i.test(String(e)) ? "not minted yet" : esc(errMsg(e))}`;
  }
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
    done?.();
  } catch (e) {
    toast(errMsg(e));
  }
}

/** "0xTarget functionName(types)" lines -> permissions, plus warnings for risky selectors. */
function parsePermissions(text) {
  const perms = [];
  const warnings = [];
  for (const raw of text.split(/\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [target, ...rest] = line.split(/\s+/);
    const sig = rest.join("");
    if (!/^0x[0-9a-fA-F]{40}$/.test(target) || !sig) throw new Error(`bad line: "${line}" (expected: 0xContract functionName(types))`);
    const selector = /^0x[0-9a-fA-F]{8}$/.test(sig) ? sig.toLowerCase() : toFunctionSelector(sig.startsWith("function") ? sig : `function ${sig}`);
    if (RISKY[selector]) warnings.push(`${sig} on ${short(target)}: ${RISKY[selector]}`);
    perms.push({ target, selector });
  }
  return { perms, warnings };
}

function holderPanel(id, account, lockedNow) {
  const box = document.createElement("div");
  box.id = "face-holder";
  box.className = "holder-panel";
  box.innerHTML = `
    <h3>Your Face · controls</h3>
    <p class="fine">Only the holder can use these. They act on this Face's own account.</p>
    <details open><summary>Delegate an agent</summary>
      <label>Agent address<input id="ag-addr" placeholder="0x…" autocomplete="off"></label>
      <label>Valid for (days)<input id="ag-days" type="number" min="1" value="30"></label>
      <label>ETH it may spend (total)<input id="ag-eth" type="number" min="0" step="0.001" value="0"></label>
      <label>Allowed calls — one per line: <code>0xContract functionName(types)</code>
        <textarea id="ag-perms" rows="4" placeholder="0x… swap(address,address,uint256)"></textarea></label>
      <div id="ag-warn" class="msg err"></div>
      <div class="row">
        <button class="btn btn-neon" id="ag-set">Delegate (replaces the current agent)</button>
        <button class="btn btn-ghost" id="ag-add">Add these calls</button>
        <button class="btn btn-ghost" id="ag-del">Remove these calls</button>
      </div>
      <div class="row">
        <button class="btn btn-ghost" id="ag-budget">Update ETH budget</button>
        <button class="btn btn-ghost" id="ag-revoke">Revoke agent</button>
      </div>
    </details>
    <details><summary>Lock the account (before listing)</summary>
      <p class="fine">While locked, nothing can leave the account — not you, not your agent, no signature. The lock survives a sale, so a buyer gets exactly what they see. It can only be extended (max 365 days). Revoke old token approvals first: allowances granted before locking stay valid at the token level.</p>
      <label>Lock for (days)<input id="lk-days" type="number" min="1" max="365" value="7"></label>
      <button class="btn btn-neon" id="lk-set">${lockedNow ? "Extend lock" : "Lock"}</button>
    </details>`;
  $("#face-links").after(box);
  const reload = () => showFace(id);
  const permsConfirmed = () => {
    const { perms, warnings } = parsePermissions($("#ag-perms").value);
    $("#ag-warn").textContent = warnings.length ? "Careful: " + warnings.join(" · ") : "";
    if (warnings.length && !confirm(`These permissions can move assets out of your Face:\n\n${warnings.join("\n")}\n\nContinue?`)) throw new Error("cancelled");
    return perms;
  };
  const guard = (fn) => () => {
    try {
      fn();
    } catch (e) {
      if (e.message !== "cancelled") toast(e.message);
    }
  };
  $("#ag-set").onclick = guard(() => {
    const agent = $("#ag-addr").value.trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(agent)) throw new Error("Enter the agent address.");
    const expiry = BigInt(Math.floor(Date.now() / 1000) + Number($("#ag-days").value) * 86400);
    send(account, ABI.account, "setAgent", [agent, expiry, permsConfirmed(), parseEther(String($("#ag-eth").value || "0"))], reload);
  });
  $("#ag-add").onclick = guard(() => send(account, ABI.account, "setAgentPermissions", [permsConfirmed(), true], reload));
  $("#ag-del").onclick = guard(() => send(account, ABI.account, "setAgentPermissions", [parsePermissions($("#ag-perms").value).perms, false], reload));
  $("#ag-budget").onclick = guard(() => send(account, ABI.account, "setAgentValueAllowance", [parseEther(String($("#ag-eth").value || "0"))], reload));
  $("#ag-revoke").onclick = guard(() => send(account, ABI.account, "revokeAgent", [], reload));
  $("#lk-set").onclick = guard(() => {
    const until = BigInt(Math.floor(Date.now() / 1000) + Number($("#lk-days").value) * 86400);
    send(account, ABI.account, "lock", [until], reload);
  });
}
