// First sight (agreed 29 Sep, built 14 Oct): the moment a holder sees a Face's art for the first time, once per Face
// on each device, after the reveal. The sealed image the Face carried through the mint, a shuffle of the collection,
// then its real art resolving block by block while its traits are typed; the neon strikes as hard as its tier (a
// Glance catches like a tube, a Watch strikes and bursts, a Heavy Stare lights the whole screen); a set piece shows its
// place among the four; then Share on X and Save image. Everything shown is what the chain returned.
import { decode } from "../render.js";
import { terminal, burst, centerOf, loadFace, draw, shuffle, dissolve, strike, ignite, QUICK, STRIKE, wait, seen } from "./birth.js";
import { scramble } from "./fx.js";
import { sound } from "./sound.js";

const KEY = "nf-first-sight"; // the Faces already seen on this device (a convenience: losing it only replays the scene)
const PIECES = ["Left Eye", "Right Eye", "Left Mouth", "Right Mouth"];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export function seenIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) || "[]").map(Number));
  } catch {
    return new Set();
  }
}
function markSeen(ids) {
  try {
    const s = seenIds();
    ids.forEach((id) => s.add(Number(id)));
    localStorage.setItem(KEY, JSON.stringify([...s]));
  } catch {}
}

const attr = (f, k) => f.attrs.find((a) => a.trait_type === k)?.value;
const row = (k, v) => `  ${k} ${".".repeat(Math.max(2, 13 - k.length))} ${v}`;

/** The Face as a picture to keep: its art from the on-chain record, a neon band with its number and tier. */
function poster(f) {
  const W = 1080;
  const H = 1350;
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  if (f.record) {
    const face = decode(f.record);
    const s = W / face.g;
    for (let i = 0; i < face.cells.length; i++) {
      ctx.fillStyle = face.palette[face.cells[i]];
      ctx.fillRect(Math.floor((i % face.g) * s), Math.floor(Math.floor(i / face.g) * s), Math.ceil(s), Math.ceil(s));
    }
  }
  ctx.fillStyle = "#ccff00";
  ctx.fillRect(0, W, W, 6);
  const css = getComputedStyle(document.documentElement);
  const pixel = css.getPropertyValue("--pixel").trim() || "monospace";
  const mono = css.getPropertyValue("--mono").trim() || "monospace";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ccff00";
  ctx.font = `64px ${pixel}`;
  ctx.fillText(`NEONFACES #${f.id}`, 48, W + 112);
  ctx.fillStyle = "#e8ffd0";
  ctx.font = `30px ${mono}`;
  const set = attr(f, "Set");
  ctx.fillText([attr(f, "Stare"), attr(f, "Crop"), set ? `Set #${set}` : null].filter(Boolean).join(" · ").toUpperCase(), 48, W + 172);
  ctx.fillStyle = "#88a220";
  ctx.font = `26px ${mono}`;
  ctx.fillText("FIRST SIGHT · NEONFACES.XYZ", 48, H - 48);
  return cv;
}

function save(f) {
  const cv = poster(f);
  cv.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `neonface-${f.id}-first-sight.png`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
  }, "image/png");
}

/** Where this piece sits in its set: its own corner lit, the holder's other pieces dim, the missing ones dark. */
function setBox(f, owned) {
  const set = attr(f, "Set");
  if (!set) return "";
  const mine = PIECES.indexOf(attr(f, "Crop"));
  const have = owned.get(Number(set)) ?? new Set();
  const cells = PIECES.map((p, q) =>
    q === mine
      ? `<i class="fs-piece on"><img src="${esc(f.image)}" alt=""></i>`
      : have.has(q)
        ? `<i class="fs-piece yours" title="${esc(p)}: yours"><b>yours</b></i>`
        : `<i class="fs-piece" title="${esc(p)}"><b>?</b></i>`,
  ).join("");
  const missing = 3 - [...have].filter((q) => q !== mine).length;
  return `<div class="fs-set"><div class="fs-set-grid">${cells}</div><p class="fine">${
    missing ? `Set #${esc(set)}: ${missing === 1 ? "one piece is" : `${missing} pieces are`} out there. Hold all four and the Face shows the whole face.` : `Set #${esc(set)}: all four pieces are yours. Assemble them on the Face's page.`
  }</p></div>`;
}

/**
 * faces: [{ id, image, attrs, record, topup }] (attrs = tokenURI attributes; record = NeonArt's artData; topup = text
 * or ""); sealed: the collection's sealed image; owned: Map(setId -> Set(piece index)) of the holder's set pieces.
 */
export async function firstSight(faces, { records = [], share, open, sealed, owned = new Map() }) {
  if (!faces.length) return;
  await seen();
  const m = document.createElement("div");
  m.className = "birth first-sight";
  m.dataset.n = 1;
  m.setAttribute("role", "dialog");
  m.setAttribute("aria-label", "First sight");
  m.innerHTML = `<canvas class="birth-burst" aria-hidden="true"></canvas>
    <div class="birth-box">
      <div class="birth-grid"><button class="birth-tile" aria-label=""><canvas width="480" height="480"></canvas><span></span></button></div>
      <div class="birth-side">
        <div class="label fs-label">First sight</div>
        <h2 class="birth-title"></h2>
        <div class="birth-log" aria-live="polite"></div>
        <div class="fs-set-slot"></div>
        <div class="birth-acts"></div>
      </div>
    </div>
    <button class="btn btn-ghost birth-close">Close</button>`;
  document.body.appendChild(m);
  const meta = document.querySelector('meta[name="theme-color"]');
  const theme = meta?.content;
  const unlight = () => {
    m.classList.remove("lit");
    document.documentElement.classList.remove("birth-lit");
    if (meta) meta.content = theme;
  };
  let done = false;
  const close = () => {
    if (done) return;
    done = true;
    unlight();
    m.dispatchEvent(new Event("birth:close"));
    m.remove();
    removeEventListener("keydown", key);
  };
  const key = (e) => e.key === "Escape" && close();
  addEventListener("keydown", key);
  m.querySelector(".birth-close").onclick = close;
  setTimeout(() => m.classList.add("open"), 20);
  sound.open();

  const tile = m.querySelector(".birth-tile");
  const cv = tile.querySelector("canvas");
  const tag = tile.querySelector("span");
  const label = m.querySelector(".fs-label");
  const title = m.querySelector(".birth-title");
  const log = terminal(m.querySelector(".birth-log"));
  const slot = m.querySelector(".fs-set-slot");
  const acts = m.querySelector(".birth-acts");
  const sealedImg = sealed ? await loadFace(sealed) : null;

  for (let k = 0; k < faces.length && !done; k++) {
    const f = faces[k];
    const tier = attr(f, "Stare") ?? "";
    unlight();
    tile.classList.remove("on");
    tile.setAttribute("aria-label", `NEONFACES #${f.id}`);
    tag.textContent = `#${f.id}`;
    label.textContent = faces.length > 1 ? `First sight · ${k + 1} of ${faces.length}` : "First sight";
    title.textContent = title.dataset.text = `NEONFACES #${f.id}`;
    scramble(title, { duration: 600 });
    log.clear();
    slot.innerHTML = "";
    acts.innerHTML = "";
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (sealedImg) draw(cv, sealedImg, cv.width);
    const img = await loadFace(f.image);

    log.line(`> #${f.id} · sealed since its mint`, "dim");
    log.line("> reveal seed ..... on-chain");
    await strike([tile], QUICK);
    await shuffle(cv, records, 1100);
    await dissolve(cv, img, 1500);
    if (done) break;

    log.line(`> art #${attr(f, "Art ID") ?? "?"}`);
    log.line(row("stare", tier.toUpperCase()), "neon");
    log.line(row("crop", attr(f, "Crop")));
    if (attr(f, "Set")) log.line(row("face", attr(f, "Face")));
    log.line(row("neon", attr(f, "Neon")));
    log.line(row("expression", attr(f, "Expression")));
    for (const t of ["Accessory", "Anomaly"]) if (attr(f, t) && attr(f, t) !== "None") log.line(row(t.toLowerCase(), attr(f, t)), "neon");
    if (attr(f, "Set")) log.line(row("set", `#${attr(f, "Set")} · ${attr(f, "Crop")}`));
    if (f.topup) log.line(row("top-up", f.topup), "neon");
    await log.done();
    if (done) break;

    // the neon strikes as hard as the tier
    if (tier === "Heavy Stare") {
      await strike([tile], STRIKE);
      await ignite(m);
      burst(m.querySelector(".birth-burst"), [centerOf(tile)], { count: 320, power: 18 });
      sound.success();
    } else if (tier === "Watch") {
      await strike([tile], STRIKE);
      burst(m.querySelector(".birth-burst"), [centerOf(tile)], { colors: ["#ccff00", "#1f2504"], count: 160, power: 12 });
      sound.success();
    } else {
      await strike([tile], QUICK);
    }
    markSeen([f.id]);
    slot.innerHTML = setBox(f, owned);

    const next = new Promise((resolve) => {
      const b = (text, cls, fn, href) => {
        const el = document.createElement(href ? "a" : "button");
        el.className = `btn ${cls}`;
        el.textContent = text;
        if (href) Object.assign(el, { href, target: "_blank", rel: "noopener" });
        else el.onclick = fn;
        acts.appendChild(el);
        return el;
      };
      if (k < faces.length - 1) b(`Next: #${faces[k + 1].id}`, "btn-neon", () => resolve());
      b("Share on X ↗", k < faces.length - 1 ? "btn-ghost" : "btn-neon", null, share(f, tier));
      b("Save image", "btn-ghost", () => save(f));
      b(`Open #${f.id}`, "btn-ghost", () => { close(); open(f.id); });
      if (k < faces.length - 2) b("Skip to the end", "btn-ghost fs-skip", () => { markSeen(faces.map((x) => x.id)); close(); });
      m.addEventListener("birth:close", resolve, { once: true });
    });
    await next;
    await wait(80);
  }
}
