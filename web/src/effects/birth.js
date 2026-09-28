// The mint, staged: the art pane watches you sign, flickers through Faces while the chain writes, and the Faces
// minted are born on screen: each image resolves block by block, each account opens, each basket arrives, read live
// from the transaction. Then the neon strikes, like a tube: the screen flickers and stays lit, neon with black type,
// the way NEONCAM lit the page in the preview. Everything shown is what the chain returned; nothing is decorative data.
//
// Each size of mint has its own scene, all ending with the screen lit:
//   1  one tube strikes: the Face resolves slowly, alone
//   2  two tubes answer each other, left, right, left, until both hold
//   3  a triptych: three strikes in a row, then the three stare together
//   4  a quad: the tiles light clockwise, then close up into one face, like a set
//   5  the sign: NEONFACES lights letter by letter, then all five strike at once
import { decode } from "../render.js";
import { pixelEye } from "./eye.js";
import { scramble } from "./fx.js";
import { sound } from "./sound.js";

const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const wait = (ms) => new Promise((r) => setTimeout(r, still() ? 0 : ms));
// a phone often comes back from its wallet app while the transaction confirms: play the scene once the page is seen
const seen = () => (document.hidden ? new Promise((r) => document.addEventListener("visibilitychange", r, { once: true })) : Promise.resolve());

// ------------------------------------------------------------------ terminal lines, typed
export function terminal(el) {
  let queue = Promise.resolve();
  let gen = 0;
  const line = (text, cls = "") => {
    const g = gen;
    return (queue = queue.then(async () => {
      if (g !== gen) return;
      const p = document.createElement("div");
      if (cls) p.className = cls;
      el.appendChild(p);
      if (still()) return void (p.textContent = text);
      for (let c = 2; c < text.length + 2; c += 2) {
        if (g !== gen) return;
        p.textContent = text.slice(0, c) + (c < text.length ? "█" : "");
        await wait(12);
      }
    }));
  };
  return { line, clear: () => (gen++, (queue = Promise.resolve()), (el.innerHTML = "")), done: () => queue };
}

// ------------------------------------------------------------------ the art pane
/** Stage states on the mint art: idle (the gallery), sign (the eye watches), chain (Faces flicker). */
export function chamber(art, records) {
  const S = 480;
  const flick = document.createElement("canvas");
  flick.width = flick.height = S;
  flick.className = "chamber-flick";
  const eye = document.createElement("canvas");
  eye.width = 480;
  eye.height = 240;
  eye.className = "chamber-eye";
  const scan = document.createElement("div");
  scan.className = "chamber-scan";
  art.append(flick, eye, scan);
  pixelEye(eye, { cols: 48, rows: 24, fade: false });
  const ctx = flick.getContext("2d");
  let timer = null;

  // one Face dissolves into the next, block by block, a neon flash on each block first
  const flicker = () => {
    const face = decode(records[Math.floor(Math.random() * records.length)]);
    const order = [...Array(face.cells.length).keys()].sort(() => Math.random() - 0.5);
    const s = S / face.g;
    const cell = (i, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.floor((i % face.g) * s), Math.floor(Math.floor(i / face.g) * s), Math.ceil(s), Math.ceil(s));
    };
    const per = Math.ceil(order.length / 6);
    for (let n = 0; n < order.length; n += per) {
      const batch = order.slice(n, n + per);
      setTimeout(() => {
        if (art.dataset.stage !== "chain") return;
        batch.forEach((i) => cell(i, "#ccff00"));
        setTimeout(() => art.dataset.stage === "chain" && batch.forEach((i) => cell(i, face.palette[face.cells[i]])), 40);
      }, (n / per) * 45);
    }
  };
  const set = (stage) => {
    art.dataset.stage = stage;
    clearInterval(timer);
    if (stage === "chain" && records.length) {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, S, S);
      flicker();
      if (!still()) timer = setInterval(flicker, 420);
    }
  };
  set("idle");
  return { set };
}

// ------------------------------------------------------------------ pixel burst, from one or more points
function burst(cv, origins, { colors = ["#000000", "#1f2504"], count = 160, power = 14 } = {}) {
  if (still()) return;
  const ctx = cv.getContext("2d");
  const W = (cv.width = innerWidth);
  const H = (cv.height = innerHeight);
  const G = 12;
  const parts = [];
  for (const o of origins) {
    for (let k = 0; k < count / origins.length; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = 4 + Math.random() * power;
      parts.push({ x: o.x, y: o.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, c: Math.random() < 0.8 ? colors[0] : colors[1] });
    }
  }
  const tick = () => {
    ctx.clearRect(0, 0, W, H);
    let alive = 0;
    for (const p of parts) {
      if (p.life <= 0) continue;
      alive++;
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.95;
      p.vy = p.vy * 0.95 + 0.25;
      p.life -= 0.016;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.c;
      ctx.fillRect(Math.round(p.x / G) * G, Math.round(p.y / G) * G, G - 2, G - 2); // on the grid: pixels, not confetti
    }
    ctx.globalAlpha = 1;
    if (alive) requestAnimationFrame(tick);
  };
  tick();
}
const centerOf = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

// ------------------------------------------------------------------ a Face resolving
/** Load the on-chain image once; `draw(cv, blocks)` paints it at that many blocks across. */
function loadFace(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
function draw(cv, img, blocks) {
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  if (!img) return;
  const s = Math.min(blocks, cv.width);
  const tmp = document.createElement("canvas");
  tmp.width = tmp.height = s;
  tmp.getContext("2d").drawImage(img, 0, 0, s, s);
  ctx.drawImage(tmp, 0, 0, s, s, 0, 0, cv.width, cv.height);
}
/** Before a Face settles: a few Faces of the collection flash past, the way the art is still to be dealt. */
async function shuffle(cv, records, ms = 500) {
  if (!records?.length || still()) return;
  const ctx = cv.getContext("2d");
  const frames = Math.max(3, Math.round(ms / 70));
  for (let k = 0; k < frames; k++) {
    const f = decode(records[Math.floor(Math.random() * records.length)]);
    const s = cv.width / f.g;
    for (let i = 0; i < f.cells.length; i++) {
      ctx.fillStyle = k === frames - 1 && i % 3 === 0 ? "#ccff00" : f.palette[f.cells[i]];
      ctx.fillRect(Math.floor((i % f.g) * s), Math.floor(Math.floor(i / f.g) * s), Math.ceil(s), Math.ceil(s));
    }
    if (k % 2 === 0) sound.hover?.();
    await wait(70);
  }
}
async function dissolve(cv, img, ms = 1100) {
  sound.sweep();
  const steps = [2, 4, 8, 12, 16, 24, 32, 48, 64, cv.width];
  for (const s of steps) {
    draw(cv, img, s);
    await wait(ms / steps.length);
  }
  draw(cv, img, cv.width);
}

// ------------------------------------------------------------------ neon strikes
const STRIKE = [[50, 120], [30, 60], [90, 260], [40, 50], [60, 140]]; // a tube catching: uneven, then steady
const QUICK = [[40, 90], [30, 140], [70, 60]];

/** Flicker the "on" class of the elements with a strike pattern, with its buzz, and leave them on. */
async function strike(els, pattern = STRIKE) {
  const on = (v) => els.forEach((e) => e.classList.toggle("on", v));
  for (const [a, b] of pattern) {
    on(true);
    sound.buzz(a / 1000);
    await wait(a);
    on(false);
    await wait(b);
  }
  on(true);
  sound.buzz(0.12);
}

/** The whole screen lights up: neon, black type, the phone's bar neon too, as NEONCAM did. */
async function ignite(m) {
  const meta = document.querySelector('meta[name="theme-color"]');
  const before = meta?.content;
  const lit = (v) => {
    m.classList.toggle("lit", v);
    document.documentElement.classList.toggle("birth-lit", v);
    if (meta) meta.content = v ? "#ccff00" : before;
  };
  m.addEventListener("birth:close", () => {
    document.documentElement.classList.remove("birth-lit");
    if (meta) meta.content = before;
  }, { once: true });
  for (const [a, b] of STRIKE) {
    lit(true);
    sound.buzz(a / 1000);
    await wait(a);
    lit(false);
    await wait(b);
  }
  lit(true);
  sound.buzz(0.3);
}

// ------------------------------------------------------------------ the scenes
const SCENES = {
  // one tube, one Face, slowly
  async 1(tiles, grid, sign, records) {
    await strike([tiles[0].el], QUICK);
    await shuffle(tiles[0].cv, records, 1100);
    await dissolve(tiles[0].cv, tiles[0].img, 1600);
  },
  // two tubes answering each other
  async 2(tiles, grid, sign, records) {
    await Promise.all(tiles.map((t) => shuffle(t.cv, records, 700)));
    tiles.forEach((t) => draw(t.cv, t.img, t.cv.width));
    for (let k = 0; k < 7; k++) {
      const t = tiles[k % 2];
      t.el.classList.add("on");
      sound.buzz(0.05);
      await wait(90 + k * 25);
      if (k < 6) t.el.classList.remove("on");
      await wait(70);
    }
    tiles.forEach((t) => t.el.classList.add("on"));
    sound.buzz(0.15);
  },
  // a triptych: left to right, then the three stare at once
  async 3(tiles, grid, sign, records) {
    for (const t of tiles) {
      await strike([t.el], QUICK);
      await shuffle(t.cv, records, 400);
      await dissolve(t.cv, t.img, 600);
    }
    await wait(250);
    await strike(tiles.map((t) => t.el), [[60, 120]]);
  },
  // a quad: clockwise, then the gaps close into one face, like a set
  async 4(tiles, grid, sign, records) {
    for (const k of [0, 1, 3, 2]) {
      await strike([tiles[k].el], [[40, 70]]);
      await shuffle(tiles[k].cv, records, 300);
      await dissolve(tiles[k].cv, tiles[k].img, 450);
    }
    await wait(300);
    grid.classList.add("closed");
    sound.sweep();
    await wait(700);
  },
  // the sign: the name lights letter by letter, then all five strike together
  async 5(tiles, grid, sign, records) {
    sign.hidden = false;
    const shuffled = Promise.all(tiles.map((t) => shuffle(t.cv, records, 1300)));
    for (const ch of sign.children) {
      ch.classList.add("on");
      sound.buzz(0.04);
      await wait(110);
    }
    await shuffled;
    tiles.forEach((t) => draw(t.cv, t.img, t.cv.width));
    await wait(250);
    await strike(tiles.map((t) => t.el));
  },
};

// ------------------------------------------------------------------ the birth
/**
 * Full-screen birth of the Faces just minted.
 * faces: [{ id, image, account, funded, legs: [{ sym, amount }] }]; tx: { hash, block, link }
 * share(id) -> URL for a post; open(id) opens the Face's page; records: collection art for the shuffle.
 */
export async function birth(faces, tx, { share, open, records = [] }) {
  await seen();
  const n = Math.min(faces.length, 5);
  const m = document.createElement("div");
  m.className = "birth";
  m.dataset.n = n;
  m.setAttribute("role", "dialog");
  m.setAttribute("aria-label", `${faces.length} Face${faces.length > 1 ? "s" : ""} minted`);
  const size = n === 1 ? 480 : n <= 3 ? 320 : 240;
  m.innerHTML = `<canvas class="birth-burst" aria-hidden="true"></canvas>
    <div class="birth-box">
      <div class="birth-sign" hidden aria-hidden="true">${[..."NEONFACES"].map((c) => `<span>${c}</span>`).join("")}</div>
      <div class="birth-grid">${faces
        .slice(0, n)
        .map((f, k) => `<button class="birth-tile" data-k="${k}" aria-label="NEONFACES #${f.id}"><canvas width="${size}" height="${size}"></canvas><span>#${f.id}</span></button>`)
        .join("")}</div>
      <div class="birth-side">
        <div class="label">Born on Robinhood Chain · block ${tx.block.toLocaleString("en-US")}</div>
        <h2 class="birth-title"></h2>
        <div class="birth-log" aria-live="polite"></div>
        <div class="birth-acts"></div>
      </div>
    </div>
    <button class="btn btn-ghost birth-close">Close</button>`;
  document.body.appendChild(m);
  const key = (e) => e.key === "Escape" && close();
  const close = () => {
    m.dispatchEvent(new Event("birth:close"));
    m.remove();
    removeEventListener("keydown", key);
  };
  addEventListener("keydown", key);
  m.querySelector(".birth-close").onclick = close;
  setTimeout(() => m.classList.add("open"), 20);
  sound.open();

  const grid = m.querySelector(".birth-grid");
  const imgs = await Promise.all(faces.slice(0, n).map((f) => loadFace(f.image)));
  const tiles = [...grid.children].map((el, k) => ({ el, cv: el.querySelector("canvas"), img: imgs[k], face: faces[k] }));
  const title = m.querySelector(".birth-title");
  const log = terminal(m.querySelector(".birth-log"));
  const acts = m.querySelector(".birth-acts");

  // while the scene plays: what the chain returned, one line per Face
  title.textContent = n === 1 ? `NEONFACES #${faces[0].id}` : n === 5 ? "Five Faces" : `${n} Faces`;
  scramble(title, { duration: 700 });
  const acc = (f) => `${f.account.slice(0, 6)}…${f.account.slice(-4)}`;
  const got = (f) => f.funded && f.legs.length;
  if (n <= 2) {
    for (const f of faces) {
      log.line(`> #${f.id} born · account ${acc(f)} opened`);
      log.line(got(f) ? `    basket received: ${f.legs.map((l) => `${l.amount} ${l.sym}`).join(" · ")}` : "    basket pending: the keeper delivers it within minutes", got(f) ? "neon" : "dim");
    }
  } else {
    // one line per Face; the baskets in full on each Face's page
    for (const f of faces) log.line(`> #${f.id} born · account ${acc(f)} · basket ${got(f) ? "received" : "pending"}`);
    if (faces.some((f) => !got(f))) log.line("    pending baskets: the keeper delivers them within minutes", "dim");
  }
  log.line("> art ........ dealt at the reveal", "dim");
  log.line("> blink reflex ....... NOT FOUND");
  log.line("> neon ............... ON", "neon");

  await Promise.all([SCENES[n](tiles, grid, m.querySelector(".birth-sign"), records), log.done()]);
  if (!m.isConnected) return;
  await wait(300);
  await ignite(m);
  burst(m.querySelector(".birth-burst"), n === 4 ? [centerOf(grid)] : tiles.map((t) => centerOf(t.el)), { count: 120 + 40 * n, power: 10 + 2 * n });
  sound.success();

  // one Face in focus: its buttons; the others a tap away
  const focus = (k) => {
    const f = faces[k];
    tiles.forEach((t, j) => t.el.toggleAttribute("aria-current", j === k && n > 1));
    if (n > 1) title.textContent = title.dataset.text = `NEONFACES #${f.id}`;
    acts.innerHTML = "";
    const b = (label, cls, fn, href) => {
      const el = document.createElement(href ? "a" : "button");
      el.className = `btn ${cls}`;
      el.textContent = label;
      if (href) Object.assign(el, { href, target: "_blank", rel: "noopener" });
      else el.onclick = fn;
      acts.appendChild(el);
    };
    b(`Open #${f.id}`, "btn-neon", () => { close(); open(f.id); });
    b("Share on X ↗", "btn-ghost", null, share(f.id));
    if (tx.link) {
      const a = document.createElement("a");
      a.className = "fine birth-tx";
      Object.assign(a, { href: tx.link, target: "_blank", rel: "noopener", textContent: `Transaction ${tx.hash.slice(0, 10)}… ↗` });
      acts.appendChild(a);
    }
    if (n > 1) acts.insertAdjacentHTML("beforeend", `<p class="fine">Tap a Face to pick it.</p>`);
  };
  tiles.forEach((t, k) => (t.el.onclick = () => focus(k)));
  focus(0);
  return close;
}
