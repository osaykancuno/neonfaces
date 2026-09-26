// Site-wide effects: boot log, block-dissolve mosaic, text scramble, pixel reveals, cursor.
import { decode } from "../render.js";

// ------------------------------------------------------------------ boot sequence
export function boot() {
  const el = document.getElementById("boot");
  const log = document.getElementById("boot-log");
  const skip = () => el.classList.add("done");
  let seen = false;
  try { seen = sessionStorage.getItem("nf-boot") === "1"; sessionStorage.setItem("nf-boot", "1"); } catch {}
  if (seen || matchMedia("(prefers-reduced-motion: reduce)").matches) return skip();
  el.addEventListener("click", skip);
  const lines = [
    "> NEONFACES OS v1.0",
    "> connecting to robinhood chain ........ ok",
    "> market status ........................ OPEN (it never closes)",
    "> mounting 5555 faces from chain storage  ok",
    "> binding accounts (ERC-6551) .......... ok",
    "> blink reflex ......................... NOT FOUND",
    "",
    "  they don't blink.",
  ];
  let i = 0;
  let c = 0;
  const tick = () => {
    if (i >= lines.length) return setTimeout(skip, 350);
    const line = lines[i];
    c = Math.min(line.length, c + 4);
    log.textContent = lines.slice(0, i).join("\n") + (i ? "\n" : "") + line.slice(0, c) + "█";
    if (c >= line.length) { i++; c = 0; }
    setTimeout(tick, 14);
  };
  tick();
  setTimeout(skip, 4000); // never block the page
}

// ------------------------------------------------------------------ mosaic
// Faces drawn from on-chain records; every so often one tile dissolves block by block into another.

export function mosaic(root, records) {
  if (!records.length) return;
  const cols = window.innerWidth < 700 ? 5 : window.innerWidth < 1200 ? 8 : 11;
  root.style.setProperty("--cols", cols);
  const rows = Math.ceil((window.innerHeight / window.innerWidth) * cols) + 1;
  const S = 120;
  const tiles = [];
  for (let k = 0; k < cols * rows; k++) {
    const t = document.createElement("div");
    t.className = "tile";
    const cv = document.createElement("canvas");
    cv.width = cv.height = S;
    t.appendChild(cv);
    root.appendChild(t);
    const ctx = cv.getContext("2d");
    const face = decode(records[k % records.length]);
    paint(ctx, face, null);
    tiles.push({ ctx, face });
  }
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  function paint(ctx, face, only) {
    const s = S / face.g;
    const draw = (i) => {
      ctx.fillStyle = face.palette[face.cells[i]];
      ctx.fillRect(Math.floor((i % face.g) * s), Math.floor(Math.floor(i / face.g) * s), Math.ceil(s), Math.ceil(s));
    };
    if (only) only.forEach(draw);
    else for (let i = 0; i < face.cells.length; i++) draw(i);
  }

  const swap = () => {
    if (document.hidden || !tiles.length) return; // no tiles while the hero has no size
    const t = tiles[Math.floor(Math.random() * tiles.length)];
    const next = decode(records[Math.floor(Math.random() * records.length)]);
    // repaint the whole tile at the new grid size in random block order, flashing each block neon first
    const order = [...Array(next.cells.length).keys()].sort(() => Math.random() - 0.5);
    const s = S / next.g;
    let n = 0;
    const per = Math.ceil(order.length / 14);
    const step = () => {
      const batch = order.slice(n, n + per);
      n += per;
      t.ctx.fillStyle = "#ccff00";
      batch.forEach((i) => t.ctx.fillRect(Math.floor((i % next.g) * s), Math.floor(Math.floor(i / next.g) * s), Math.ceil(s), Math.ceil(s)));
      setTimeout(() => paint(t.ctx, next, batch), 70);
      if (n < order.length) requestAnimationFrame(step);
      else t.face = next;
    };
    step();
  };
  setInterval(swap, 240);
}

// ------------------------------------------------------------------ text scramble
const GLYPHS = "█▓▒░<>/\\#$%&01NEON";
export function scramble(el, { duration = 900 } = {}) {
  const final = el.dataset.text ?? el.textContent;
  el.dataset.text = final;
  const start = performance.now();
  const run = (now) => {
    const p = Math.min(1, (now - start) / duration);
    let out = "";
    for (let i = 0; i < final.length; i++) {
      const ch = final[i];
      if (ch === " " || i / final.length < p) out += ch;
      else out += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
    }
    el.textContent = out;
    if (p < 1) requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
}

// ------------------------------------------------------------------ reveals
export function reveals() {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add("in");
        e.target.querySelectorAll("[data-scramble]").forEach((s) => scramble(s));
        io.unobserve(e.target);
      }
    },
    // any height: a ratio threshold never fires on a section taller than ~8 screens (a long view on a phone held sideways)
    { threshold: 0, rootMargin: "0px 0px -10% 0px" },
  );
  document.querySelectorAll(".reveal, .trait").forEach((el) => io.observe(el));
  return io;
}

// ------------------------------------------------------------------ cursor
export function cursor() {
  const c = document.getElementById("cursor");
  if (!c) return;
  let x = -100, y = -100, cx = -100, cy = -100;
  window.addEventListener("pointermove", (e) => { x = e.clientX; y = e.clientY; }, { passive: true });
  document.addEventListener("pointerover", (e) => c.classList.toggle("hover", !!e.target.closest("a,button,summary,.g-item,input")));
  const loop = () => {
    cx += (x - cx) * 0.35;
    cy += (y - cy) * 0.35;
    // snap to an 6px grid: the cursor is pixelated too
    c.style.transform = `translate(${Math.round(cx / 6) * 6 - 9}px, ${Math.round(cy / 6) * 6 - 9}px)`;
    requestAnimationFrame(loop);
  };
  loop();
}

// ------------------------------------------------------------------ ticker tape
export function tape(el) {
  const words = ["TSLA", "NVDA", "AAPL", "AMZN", "MSFT", "GOOGL", "META", "SPY", "USDG", "■ 24/7", "THEY DON'T BLINK", "5555 FACES", "EVERY FACE IS AN ACCOUNT", "■ FULLY ON-CHAIN"];
  const html = words.map((w) => `<span>${w}</span>`).join("");
  el.innerHTML = html + html; // doubled for a seamless loop
}

// ------------------------------------------------------------------ toast
let toastTimer;
export function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}
