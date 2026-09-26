const te = ["#000000", "#1f2504", "#414d12", "#677920", "#94b21d", "#ccff00", "#f2ffc8"], ne = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((e) => e / 16 - 0.47);
function K(e, { cols: n = 48, rows: t = 24, fade: o = !0 } = {}) {
  const r = e.getContext("2d"), a = e.width, i = e.height, u = a / n, s = i / t, l = { x: 0, y: 0 }, h = { x: 0, y: 0 };
  let m = { x: 0, y: 0, t: 0 }, p = !0;
  const y = (c) => {
    const f = e.getBoundingClientRect(), b = (c.clientX - (f.left + f.width / 2)) / (window.innerWidth / 2), A = (c.clientY - (f.top + f.height / 2)) / (window.innerHeight / 2);
    l.x = Math.max(-1, Math.min(1, b * 1.4)), l.y = Math.max(-1, Math.min(1, A * 1.6));
  };
  window.addEventListener("pointermove", y, { passive: !0 }), new IntersectionObserver(([c]) => p = c.isIntersecting).observe(e);
  function k(c, f, b, A, O) {
    let g = 1;
    g -= 0.34 * Math.exp(-((c + 0.05) ** 2 / 0.5 + (f + 0.05) ** 2 / 0.35)), g -= 0.25 * Math.exp(-((c + 0.95) ** 2 / 0.05 + (f - 0.1) ** 2 / 0.3));
    const q = -0.72 - 0.12 * Math.sin(Math.PI * Math.min(1, Math.max(0, (c + 0.9) / 1.8)));
    Math.abs(f - q) < 0.13 * (1.2 - (c + 1) * 0.25) && c > -0.85 && c < 0.9 && (g *= 0.08);
    const C = 0.36;
    Math.abs(f - (-C - 0.16 + 0.1 * c * c)) < 0.05 && Math.abs(c) < 0.75 && (g -= 0.25);
    const v = 0.72, E = c / v;
    if (Math.abs(E) < 1) {
      const R = -C * Math.pow(1 - E * E, 0.8) - 0.03 * E, D = C * 0.8 * Math.pow(1 - E * E, 0.9) - 0.03 * E;
      if (f > R && f < D) {
        g = 0.62 - 0.12 * (1 - Math.abs(E));
        const j = b * v * 0.5, V = A * C * 0.35, F = Math.hypot((c - j) / 1, (f - V) / 1), N = 0.42;
        F < N && (g = 0.1 + 0.1 * (F / N) + 0.04 * Math.sin(O * 2 + F * 30)), F < N * 0.45 && (g = 0), Math.hypot(c - j + 0.09, f - V + 0.09) < N * 0.2 && (g = 1);
      }
      Math.abs(f - R) < 0.08 && f < R + 0.03 && (g = 0), Math.abs(f - D) < 0.03 && (g *= 0.75);
    }
    return c > v - 0.05 && c < v + 0.28 && Math.abs(f - (-0.08 - 0.6 * (c - v))) < 0.06 && (g = 0.02), g -= 0.12 * Math.exp(-((c + 0.05) ** 2 / 0.3 + (f - 0.62) ** 2 / 0.02)), g += Math.sin(c * 37.1 + f * 21.7) * 0.03, g;
  }
  function T(c) {
    if (requestAnimationFrame(T), !!p) {
      c /= 1e3, c > m.t && (m = { x: (Math.random() - 0.5) * 0.18, y: (Math.random() - 0.5) * 0.12, t: c + 0.6 + Math.random() * 1.4 }), h.x += (l.x + m.x - h.x) * 0.12, h.y += (l.y + m.y - h.y) * 0.12, r.clearRect(0, 0, a, i);
      for (let f = 0; f < t; f++)
        for (let b = 0; b < n; b++) {
          const A = (b + 0.5) / n * 2 - 1, O = (f + 0.5) / t * 2 - 1;
          let g = k(A * 1.25, O * 1.25, h.x, h.y, c);
          const q = ne[f % 4 * 4 + b % 4];
          if ((o ? Math.min(1, (1 - Math.hypot(A * 0.92, O * 0.98)) * 3.4) : 1) + q * 0.9 < 0.5) continue;
          const v = Math.max(0, Math.min(6, Math.round(Math.max(0, Math.min(1, g)) * 5 + q * 0.7)));
          r.fillStyle = te[g >= 0.99 ? 6 : Math.min(v, 5)], r.fillRect(Math.floor(b * u), Math.floor(f * s), Math.ceil(u), Math.ceil(s));
        }
    }
  }
  requestAnimationFrame(T);
}
function oe(e, { strict: n = !0 } = {}) {
  return !e || typeof e != "string" ? !1 : n ? /^0x[0-9a-fA-F]*$/.test(e) : e.startsWith("0x");
}
function B(e) {
  return oe(e, { strict: !1 }) ? Math.ceil((e.length - 2) / 2) : e.length;
}
const X = "2.56.8";
let I = {
  getDocsUrl: ({ docsBaseUrl: e, docsPath: n = "", docsSlug: t }) => n ? `${e ?? "https://viem.sh"}${n}${t ? `#${t}` : ""}` : void 0,
  version: `viem@${X}`
};
class S extends Error {
  constructor(n, t = {}) {
    const o = t.cause instanceof S ? t.cause.details : t.cause?.message ? t.cause.message : t.details, r = t.cause instanceof S && t.cause.docsPath || t.docsPath, a = I.getDocsUrl?.({ ...t, docsPath: r }), i = [
      n || "An error occurred.",
      "",
      ...t.metaMessages ? [...t.metaMessages, ""] : [],
      ...a ? [`Docs: ${a}`] : [],
      ...o ? [`Details: ${o}`] : [],
      ...I.version ? [`Version: ${I.version}`] : []
    ].join(`
`);
    super(i, t.cause ? { cause: t.cause } : void 0), Object.defineProperty(this, "details", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: void 0
    }), Object.defineProperty(this, "docsPath", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: void 0
    }), Object.defineProperty(this, "metaMessages", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: void 0
    }), Object.defineProperty(this, "shortMessage", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: void 0
    }), Object.defineProperty(this, "version", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: void 0
    }), Object.defineProperty(this, "name", {
      enumerable: !0,
      configurable: !0,
      writable: !0,
      value: "BaseError"
    }), this.details = o, this.docsPath = r, this.metaMessages = t.metaMessages, this.name = t.name ?? this.name, this.shortMessage = n, this.version = X;
  }
  walk(n) {
    return Z(this, n);
  }
}
function Z(e, n) {
  return n?.(e) ? e : e && typeof e == "object" && "cause" in e && e.cause !== void 0 ? Z(e.cause, n) : n ? null : e;
}
class J extends S {
  constructor({ size: n, targetSize: t, type: o }) {
    super(`${o.charAt(0).toUpperCase()}${o.slice(1).toLowerCase()} size (${n}) exceeds padding size (${t}).`, { name: "SizeExceedsPaddingSizeError" });
  }
}
function ie(e, { dir: n, size: t = 32 } = {}) {
  return typeof e == "string" ? re(e, { dir: n, size: t }) : ae(e, { dir: n, size: t });
}
function re(e, { dir: n, size: t = 32 } = {}) {
  if (t === null)
    return e;
  const o = e.replace("0x", "");
  if (o.length > t * 2)
    throw new J({
      size: Math.ceil(o.length / 2),
      targetSize: t,
      type: "hex"
    });
  return `0x${o[n === "right" ? "padEnd" : "padStart"](t * 2, "0")}`;
}
function ae(e, { dir: n, size: t = 32 } = {}) {
  if (t === null)
    return e;
  if (e.length > t)
    throw new J({
      size: e.length,
      targetSize: t,
      type: "bytes"
    });
  const o = new Uint8Array(t);
  for (let r = 0; r < t; r++) {
    const a = n === "right";
    o[a ? r : t - r - 1] = e[a ? r : e.length - r - 1];
  }
  return o;
}
class se extends S {
  constructor({ givenSize: n, maxSize: t }) {
    super(`Size cannot exceed ${t} bytes. Given size: ${n} bytes.`, { name: "SizeOverflowError" });
  }
}
function ce(e, { size: n }) {
  if (B(e) > n)
    throw new se({
      givenSize: B(e),
      maxSize: n
    });
}
const w = {
  zero: 48,
  nine: 57,
  A: 65,
  F: 70,
  a: 97,
  f: 102
};
function G(e) {
  if (e >= w.zero && e <= w.nine)
    return e - w.zero;
  if (e >= w.A && e <= w.F)
    return e - (w.A - 10);
  if (e >= w.a && e <= w.f)
    return e - (w.a - 10);
}
function le(e, n = {}) {
  let t = e;
  n.size && (ce(t, { size: n.size }), t = ie(t, { dir: "right", size: n.size }));
  let o = t.slice(2);
  o.length % 2 && (o = `0${o}`);
  const r = o.length / 2, a = new Uint8Array(r);
  for (let i = 0, u = 0; i < r; i++) {
    const s = G(o.charCodeAt(u++)), l = G(o.charCodeAt(u++));
    if (s === void 0 || l === void 0)
      throw new S(`Invalid byte sequence ("${o[u - 2]}${o[u - 1]}" in "${o}").`);
    a[i] = s * 16 + l;
  }
  return a;
}
const ue = ["Crop", "Density", "Neon", "Edge", "Grain", "Light", "Expression", "Accessory", "Block", "Anomaly", "Face"], fe = [
  ["Eye", "Nose", "Brow", "Cheek", "Temple", "Mouth", "Profile Edge", "Left Eye", "Right Eye", "Left Mouth", "Right Mouth"],
  ["Sparse", "Mid", "Heavy"],
  ["Standard", "Deep", "Hot"],
  ["Stair Step", "Hard Cut", "Bleed Dither"],
  ["Clean Print", "Dusty", "Heavy Scan"],
  ["Left", "Right", "Top"],
  ["Flat", "Squint", "Glare", "Wide", "Tense"],
  ["None", "Mole", "Scar", "Stud", "Tape", "Visor"],
  ["Standard", "Fine", "Coarse"],
  ["None", "Dead Pixel", "Inverted Blocks", "Extra-Wide Crop", "Double-Eye Fragment"],
  ["", "Woman", "Man"]
], de = [
  ["#000000", "#1f2504", "#414d12", "#677920", "#94b21d", "#ccff00", "#f2ffc8", "#ffffff"],
  ["#000000", "#1c2304", "#3c4811", "#5f701e", "#89a61b", "#bcee00", "#f2ffc8", "#ffffff"],
  ["#000000", "#202609", "#454e1b", "#6d7b2d", "#9cb432", "#d6ff1f", "#f2ffc8", "#ffffff"]
], he = 12, me = (e) => typeof e == "string" ? le(e) : e;
function U(e) {
  const n = me(e), t = n[0], o = new Uint8Array(t * t);
  let r = 0;
  for (let i = he; i < n.length; i++) {
    const u = n[i] >> 5, s = (n[i] & 31) + 1;
    o.fill(u, r, r + s), r += s;
  }
  const a = ue.map((i, u) => ({ trait_type: i, value: fe[u][n[1 + u]] })).filter((i) => i.value);
  return { g: t, cells: o, palette: de[n[3]], traits: a, grain: n[5] };
}
function ge() {
  const e = document.getElementById("boot"), n = document.getElementById("boot-log"), t = () => e.classList.add("done");
  let o = !1;
  try {
    o = sessionStorage.getItem("nf-boot") === "1", sessionStorage.setItem("nf-boot", "1");
  } catch {
  }
  if (o || matchMedia("(prefers-reduced-motion: reduce)").matches) return t();
  e.addEventListener("click", t);
  const r = [
    "> NEONFACES OS v1.0",
    "> connecting to robinhood chain ........ ok",
    "> market status ........................ OPEN (it never closes)",
    "> mounting 5555 faces from chain storage  ok",
    "> binding accounts (ERC-6551) .......... ok",
    "> blink reflex ......................... NOT FOUND",
    "",
    "  they don't blink."
  ];
  let a = 0, i = 0;
  const u = () => {
    if (a >= r.length) return setTimeout(t, 350);
    const s = r[a];
    i = Math.min(s.length, i + 4), n.textContent = r.slice(0, a).join(`
`) + (a ? `
` : "") + s.slice(0, i) + "█", i >= s.length && (a++, i = 0), setTimeout(u, 14);
  };
  u(), setTimeout(t, 4e3);
}
function pe(e, n) {
  if (!n.length) return;
  const t = window.innerWidth < 700 ? 5 : window.innerWidth < 1200 ? 8 : 11;
  e.style.setProperty("--cols", t);
  const o = Math.ceil(window.innerHeight / window.innerWidth * t) + 1, r = 120, a = [];
  for (let s = 0; s < t * o; s++) {
    const l = document.createElement("div");
    l.className = "tile";
    const h = document.createElement("canvas");
    h.width = h.height = r, l.appendChild(h), e.appendChild(l);
    const m = h.getContext("2d"), p = U(n[s % n.length]);
    i(m, p, null), a.push({ ctx: m, face: p });
  }
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  function i(s, l, h) {
    const m = r / l.g, p = (y) => {
      s.fillStyle = l.palette[l.cells[y]], s.fillRect(Math.floor(y % l.g * m), Math.floor(Math.floor(y / l.g) * m), Math.ceil(m), Math.ceil(m));
    };
    if (h) h.forEach(p);
    else for (let y = 0; y < l.cells.length; y++) p(y);
  }
  setInterval(() => {
    if (document.hidden || !a.length) return;
    const s = a[Math.floor(Math.random() * a.length)], l = U(n[Math.floor(Math.random() * n.length)]), h = [...Array(l.cells.length).keys()].sort(() => Math.random() - 0.5), m = r / l.g;
    let p = 0;
    const y = Math.ceil(h.length / 14), k = () => {
      const T = h.slice(p, p + y);
      p += y, s.ctx.fillStyle = "#ccff00", T.forEach((c) => s.ctx.fillRect(Math.floor(c % l.g * m), Math.floor(Math.floor(c / l.g) * m), Math.ceil(m), Math.ceil(m))), setTimeout(() => i(s.ctx, l, T), 70), p < h.length ? requestAnimationFrame(k) : s.face = l;
    };
    k();
  }, 240);
}
const W = "█▓▒░<>/\\#$%&01NEON";
function Q(e, { duration: n = 900 } = {}) {
  const t = e.dataset.text ?? e.textContent;
  e.dataset.text = t;
  const o = performance.now(), r = (a) => {
    const i = Math.min(1, (a - o) / n);
    let u = "";
    for (let s = 0; s < t.length; s++) {
      const l = t[s];
      l === " " || s / t.length < i ? u += l : u += W[Math.floor(Math.random() * W.length)];
    }
    e.textContent = u, i < 1 && requestAnimationFrame(r);
  };
  requestAnimationFrame(r);
}
function ye() {
  const e = new IntersectionObserver(
    (n) => {
      for (const t of n)
        t.isIntersecting && (t.target.classList.add("in"), t.target.querySelectorAll("[data-scramble]").forEach((o) => Q(o)), e.unobserve(t.target));
    },
    // any height: a ratio threshold never fires on a section taller than ~8 screens (a long view on a phone held sideways)
    { threshold: 0, rootMargin: "0px 0px -10% 0px" }
  );
  return document.querySelectorAll(".reveal, .trait").forEach((n) => e.observe(n)), e;
}
function Me() {
  const e = document.getElementById("cursor");
  if (!e) return;
  let n = -100, t = -100, o = -100, r = -100;
  window.addEventListener("pointermove", (i) => {
    n = i.clientX, t = i.clientY;
  }, { passive: !0 }), document.addEventListener("pointerover", (i) => e.classList.toggle("hover", !!i.target.closest("a,button,summary,.g-item,input")));
  const a = () => {
    o += (n - o) * 0.35, r += (t - r) * 0.35, e.style.transform = `translate(${Math.round(o / 6) * 6 - 9}px, ${Math.round(r / 6) * 6 - 9}px)`, requestAnimationFrame(a);
  };
  a();
}
function be(e) {
  const t = ["TSLA", "NVDA", "AAPL", "AMZN", "MSFT", "GOOGL", "META", "SPY", "USDG", "■ 24/7", "THEY DON'T BLINK", "5555 FACES", "EVERY FACE IS AN ACCOUNT", "■ FULLY ON-CHAIN"].map((o) => `<span>${o}</span>`).join("");
  e.innerHTML = t + t;
}
const _ = "neonfaces:sound";
let d = null, L = null, P = null, x = !1;
try {
  x = localStorage.getItem(_) === "on";
} catch {
}
function H() {
  if (!d) {
    const e = window.AudioContext || window.webkitAudioContext;
    if (!e) return null;
    d = new e(), L = d.createGain(), L.gain.value = 0.6, L.connect(d.destination);
  }
  return d.state === "suspended" && d.resume(), d;
}
function M(e, { dur: n = 0.05, type: t = "square", vol: o = 0.05, slide: r = 0, delay: a = 0 } = {}) {
  if (!x || !H()) return;
  const i = d.currentTime + a, u = d.createOscillator(), s = d.createGain();
  u.type = t, u.frequency.setValueAtTime(e, i), r && u.frequency.exponentialRampToValueAtTime(Math.max(40, e + r), i + n), s.gain.setValueAtTime(0, i), s.gain.linearRampToValueAtTime(o, i + 4e-3), s.gain.exponentialRampToValueAtTime(1e-4, i + n), u.connect(s).connect(L), u.start(i), u.stop(i + n + 0.02);
}
function ee() {
  if (P || !H()) return;
  const e = d.createOscillator(), n = d.createOscillator(), t = d.createBiquadFilter(), o = d.createGain(), r = d.createOscillator(), a = d.createGain();
  e.type = "sawtooth", e.frequency.value = 60, n.type = "square", n.frequency.value = 120, t.type = "lowpass", t.frequency.value = 340, o.gain.value = 0, o.gain.linearRampToValueAtTime(0.012, d.currentTime + 1.2), r.frequency.value = 0.37, a.gain.value = 4e-3, r.connect(a).connect(o.gain), e.connect(t), n.connect(t), t.connect(o).connect(L), [e, n, r].forEach((i) => i.start()), P = { g: o, nodes: [e, n, r] };
}
function we() {
  if (!P) return;
  const { g: e, nodes: n } = P;
  e.gain.cancelScheduledValues(d.currentTime), e.gain.linearRampToValueAtTime(0, d.currentTime + 0.3), n.forEach((t) => t.stop(d.currentTime + 0.35)), P = null;
}
let Y = 0;
const z = {
  get on() {
    return x;
  },
  set(e) {
    x = e;
    try {
      localStorage.setItem(_, e ? "on" : "off");
    } catch {
    }
    e ? (H(), ee(), M(220, { dur: 0.08, slide: 660, vol: 0.05 }), M(880, { dur: 0.06, delay: 0.09, vol: 0.04 })) : we();
  },
  hover() {
    const e = performance.now();
    e - Y < 70 || (Y = e, M(1760, { dur: 0.018, vol: 0.018 }));
  },
  click: () => (M(660, { dur: 0.03, vol: 0.04 }), M(990, { dur: 0.04, delay: 0.035, vol: 0.035 })),
  open: () => M(330, { dur: 0.12, slide: 700, vol: 0.04, type: "triangle" }),
  close: () => M(900, { dur: 0.1, slide: -600, vol: 0.035, type: "triangle" }),
  success: () => [523, 659, 784, 1047].forEach((e, n) => M(e, { dur: 0.07, delay: n * 0.07, vol: 0.04 })),
  error: () => (M(140, { dur: 0.18, vol: 0.05, type: "sawtooth" }), M(110, { dur: 0.22, delay: 0.12, vol: 0.05, type: "sawtooth" })),
  sweep: () => M(180, { dur: 0.45, slide: 1400, vol: 0.025, type: "sawtooth" })
  // a Face resolving block by block
};
function xe(e) {
  const n = () => {
    e.setAttribute("aria-pressed", String(x)), e.title = x ? "Sound on" : "Sound off", e.classList.toggle("on", x);
  };
  n(), e.addEventListener("click", () => {
    z.set(!x), n();
  }), x && addEventListener("pointerdown", () => ee(), { once: !0 }), document.addEventListener("pointerover", (t) => t.target.closest?.("a, .btn, button, summary") && z.hover()), document.addEventListener("click", (t) => t.target.closest?.("a, .btn, button, summary") && t.target.closest("button") !== e && z.click());
}
const $ = (e) => document.querySelector(e);
ge();
Me();
xe($("#sound-btn"));
be($("#tape"));
K($("#eye"));
K($("#nav-eye"), { cols: 24, rows: 12, fade: !1 });
fetch("data/gallery.json").then((e) => e.json()).then((e) => pe($("#mosaic"), (e.faces ?? []).map((n) => n.record))).catch((e) => console.warn("mosaic:", e));
ye();
document.querySelectorAll(".hero [data-scramble]").forEach((e) => Q(e, { duration: 1400 }));
export {
  z as sound
};
