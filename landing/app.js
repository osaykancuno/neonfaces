const re = ["#000000", "#1f2504", "#414d12", "#677920", "#94b21d", "#ccff00", "#f2ffc8"], ae = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((e) => e / 16 - 0.47);
function X(e, { cols: n = 48, rows: t = 24, fade: a = !0 } = {}) {
  const i = e.getContext("2d"), s = e.width, c = e.height, o = s / n, u = c / t, d = { x: 0, y: 0 }, g = { x: 0, y: 0 };
  let r = { x: 0, y: 0, t: 0 }, f = !0;
  const m = (l) => {
    const h = e.getBoundingClientRect(), x = (l.clientX - (h.left + h.width / 2)) / (window.innerWidth / 2), S = (l.clientY - (h.top + h.height / 2)) / (window.innerHeight / 2);
    d.x = Math.max(-1, Math.min(1, x * 1.4)), d.y = Math.max(-1, Math.min(1, S * 1.6));
  };
  window.addEventListener("pointermove", m, { passive: !0 }), new IntersectionObserver(([l]) => f = l.isIntersecting).observe(e);
  function p(l, h, x, S, C) {
    let M = 1;
    M -= 0.34 * Math.exp(-((l + 0.05) ** 2 / 0.5 + (h + 0.05) ** 2 / 0.35)), M -= 0.25 * Math.exp(-((l + 0.95) ** 2 / 0.05 + (h - 0.1) ** 2 / 0.3));
    const v = -0.72 - 0.12 * Math.sin(Math.PI * Math.min(1, Math.max(0, (l + 0.9) / 1.8)));
    Math.abs(h - v) < 0.13 * (1.2 - (l + 1) * 0.25) && l > -0.85 && l < 0.9 && (M *= 0.08);
    const T = 0.36;
    Math.abs(h - (-T - 0.16 + 0.1 * l * l)) < 0.05 && Math.abs(l) < 0.75 && (M -= 0.25);
    const A = 0.72, w = l / A;
    if (Math.abs(w) < 1) {
      const I = -T * Math.pow(1 - w * w, 0.8) - 0.03 * w, D = T * 0.8 * Math.pow(1 - w * w, 0.9) - 0.03 * w;
      if (h > I && h < D) {
        M = 0.62 - 0.12 * (1 - Math.abs(w));
        const j = x * A * 0.5, G = S * T * 0.35, $ = Math.hypot((l - j) / 1, (h - G) / 1), N = 0.42;
        $ < N && (M = 0.1 + 0.1 * ($ / N) + 0.04 * Math.sin(C * 2 + $ * 30)), $ < N * 0.45 && (M = 0), Math.hypot(l - j + 0.09, h - G + 0.09) < N * 0.2 && (M = 1);
      }
      Math.abs(h - I) < 0.08 && h < I + 0.03 && (M = 0), Math.abs(h - D) < 0.03 && (M *= 0.75);
    }
    return l > A - 0.05 && l < A + 0.28 && Math.abs(h - (-0.08 - 0.6 * (l - A))) < 0.06 && (M = 0.02), M -= 0.12 * Math.exp(-((l + 0.05) ** 2 / 0.3 + (h - 0.62) ** 2 / 0.02)), M += Math.sin(l * 37.1 + h * 21.7) * 0.03, M;
  }
  function y(l) {
    if (requestAnimationFrame(y), !!f) {
      l /= 1e3, l > r.t && (r = { x: (Math.random() - 0.5) * 0.18, y: (Math.random() - 0.5) * 0.12, t: l + 0.6 + Math.random() * 1.4 }), g.x += (d.x + r.x - g.x) * 0.12, g.y += (d.y + r.y - g.y) * 0.12, i.clearRect(0, 0, s, c);
      for (let h = 0; h < t; h++)
        for (let x = 0; x < n; x++) {
          const S = (x + 0.5) / n * 2 - 1, C = (h + 0.5) / t * 2 - 1;
          let M = p(S * 1.25, C * 1.25, g.x, g.y, l);
          const v = ae[h % 4 * 4 + x % 4];
          if ((a ? Math.min(1, (1 - Math.hypot(S * 0.92, C * 0.98)) * 3.4) : 1) + v * 0.9 < 0.5) continue;
          const A = Math.max(0, Math.min(6, Math.round(Math.max(0, Math.min(1, M)) * 5 + v * 0.7)));
          i.fillStyle = re[M >= 0.99 ? 6 : Math.min(A, 5)], i.fillRect(Math.floor(x * o), Math.floor(h * u), Math.ceil(o), Math.ceil(u));
        }
    }
  }
  requestAnimationFrame(y);
}
function ie(e, { strict: n = !0 } = {}) {
  return !e || typeof e != "string" ? !1 : n ? /^0x[0-9a-fA-F]*$/.test(e) : e.startsWith("0x");
}
function V(e) {
  return ie(e, { strict: !1 }) ? Math.ceil((e.length - 2) / 2) : e.length;
}
const J = "2.56.8";
let U = {
  getDocsUrl: ({ docsBaseUrl: e, docsPath: n = "", docsSlug: t }) => n ? `${e ?? "https://viem.sh"}${n}${t ? `#${t}` : ""}` : void 0,
  version: `viem@${J}`
};
class P extends Error {
  constructor(n, t = {}) {
    const a = t.cause instanceof P ? t.cause.details : t.cause?.message ? t.cause.message : t.details, i = t.cause instanceof P && t.cause.docsPath || t.docsPath, s = U.getDocsUrl?.({ ...t, docsPath: i }), c = [
      n || "An error occurred.",
      "",
      ...t.metaMessages ? [...t.metaMessages, ""] : [],
      ...s ? [`Docs: ${s}`] : [],
      ...a ? [`Details: ${a}`] : [],
      ...U.version ? [`Version: ${U.version}`] : []
    ].join(`
`);
    super(c, t.cause ? { cause: t.cause } : void 0), Object.defineProperty(this, "details", {
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
    }), this.details = a, this.docsPath = i, this.metaMessages = t.metaMessages, this.name = t.name ?? this.name, this.shortMessage = n, this.version = J;
  }
  walk(n) {
    return Q(this, n);
  }
}
function Q(e, n) {
  return n?.(e) ? e : e && typeof e == "object" && "cause" in e && e.cause !== void 0 ? Q(e.cause, n) : n ? null : e;
}
class ee extends P {
  constructor({ size: n, targetSize: t, type: a }) {
    super(`${a.charAt(0).toUpperCase()}${a.slice(1).toLowerCase()} size (${n}) exceeds padding size (${t}).`, { name: "SizeExceedsPaddingSizeError" });
  }
}
function se(e, { dir: n, size: t = 32 } = {}) {
  return typeof e == "string" ? ce(e, { dir: n, size: t }) : le(e, { dir: n, size: t });
}
function ce(e, { dir: n, size: t = 32 } = {}) {
  if (t === null)
    return e;
  const a = e.replace("0x", "");
  if (a.length > t * 2)
    throw new ee({
      size: Math.ceil(a.length / 2),
      targetSize: t,
      type: "hex"
    });
  return `0x${a[n === "right" ? "padEnd" : "padStart"](t * 2, "0")}`;
}
function le(e, { dir: n, size: t = 32 } = {}) {
  if (t === null)
    return e;
  if (e.length > t)
    throw new ee({
      size: e.length,
      targetSize: t,
      type: "bytes"
    });
  const a = new Uint8Array(t);
  for (let i = 0; i < t; i++) {
    const s = n === "right";
    a[s ? i : t - i - 1] = e[s ? i : e.length - i - 1];
  }
  return a;
}
class ue extends P {
  constructor({ givenSize: n, maxSize: t }) {
    super(`Size cannot exceed ${t} bytes. Given size: ${n} bytes.`, { name: "SizeOverflowError" });
  }
}
function fe(e, { size: n }) {
  if (V(e) > n)
    throw new ue({
      givenSize: V(e),
      maxSize: n
    });
}
const L = {
  zero: 48,
  nine: 57,
  A: 65,
  F: 70,
  a: 97,
  f: 102
};
function W(e) {
  if (e >= L.zero && e <= L.nine)
    return e - L.zero;
  if (e >= L.A && e <= L.F)
    return e - (L.A - 10);
  if (e >= L.a && e <= L.f)
    return e - (L.a - 10);
}
function de(e, n = {}) {
  let t = e;
  n.size && (fe(t, { size: n.size }), t = se(t, { dir: "right", size: n.size }));
  let a = t.slice(2);
  a.length % 2 && (a = `0${a}`);
  const i = a.length / 2, s = new Uint8Array(i);
  for (let c = 0, o = 0; c < i; c++) {
    const u = W(a.charCodeAt(o++)), d = W(a.charCodeAt(o++));
    if (u === void 0 || d === void 0)
      throw new P(`Invalid byte sequence ("${a[o - 2]}${a[o - 1]}" in "${a}").`);
    s[c] = u * 16 + d;
  }
  return s;
}
const he = ["Crop", "Density", "Neon", "Edge", "Grain", "Light", "Expression", "Accessory", "Block", "Anomaly", "Face"], me = [
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
], pe = [
  ["#000000", "#1f2504", "#414d12", "#677920", "#94b21d", "#ccff00", "#f2ffc8", "#ffffff"],
  ["#000000", "#1c2304", "#3c4811", "#5f701e", "#89a61b", "#bcee00", "#f2ffc8", "#ffffff"],
  ["#000000", "#202609", "#454e1b", "#6d7b2d", "#9cb432", "#d6ff1f", "#f2ffc8", "#ffffff"]
], ge = 12, ye = (e) => typeof e == "string" ? de(e) : e;
function Y(e) {
  const n = ye(e), t = n[0], a = new Uint8Array(t * t);
  let i = 0;
  for (let c = ge; c < n.length; c++) {
    const o = n[c] >> 5, u = (n[c] & 31) + 1;
    a.fill(o, i, i + u), i += u;
  }
  const s = he.map((c, o) => ({ trait_type: c, value: me[o][n[1 + o]] })).filter((c) => c.value);
  return { g: t, cells: a, palette: pe[n[3]], traits: s, grain: n[5] };
}
function Me() {
  const e = document.getElementById("boot"), n = document.getElementById("boot-log"), t = () => e.classList.add("done");
  let a = !1;
  try {
    a = sessionStorage.getItem("nf-boot") === "1", sessionStorage.setItem("nf-boot", "1");
  } catch {
  }
  if (a || matchMedia("(prefers-reduced-motion: reduce)").matches) return t();
  e.addEventListener("click", t);
  const i = [
    "> NEONFACES OS v1.0",
    "> connecting to robinhood chain ........ ok",
    "> market status ........................ OPEN (it never closes)",
    "> mounting 5555 faces from chain storage  ok",
    "> binding accounts (ERC-6551) .......... ok",
    "> blink reflex ......................... NOT FOUND",
    "",
    "  they don't blink."
  ];
  let s = 0, c = 0;
  const o = () => {
    if (s >= i.length) return setTimeout(t, 350);
    const u = i[s];
    c = Math.min(u.length, c + 4), n.textContent = i.slice(0, s).join(`
`) + (s ? `
` : "") + u.slice(0, c) + "█", c >= u.length && (s++, c = 0), setTimeout(o, 14);
  };
  o(), setTimeout(t, 4e3);
}
function we(e, n) {
  if (!n.length) return;
  const t = window.innerWidth < 700 ? 5 : window.innerWidth < 1200 ? 8 : 11;
  e.style.setProperty("--cols", t);
  const a = Math.ceil(window.innerHeight / window.innerWidth * t) + 1, i = 120, s = [];
  for (let u = 0; u < t * a; u++) {
    const d = document.createElement("div");
    d.className = "tile";
    const g = document.createElement("canvas");
    g.width = g.height = i, d.appendChild(g), e.appendChild(d);
    const r = g.getContext("2d"), f = Y(n[u % n.length]);
    c(r, f, null), s.push({ ctx: r, face: f });
  }
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  function c(u, d, g) {
    const r = i / d.g, f = (m) => {
      u.fillStyle = d.palette[d.cells[m]], u.fillRect(Math.floor(m % d.g * r), Math.floor(Math.floor(m / d.g) * r), Math.ceil(r), Math.ceil(r));
    };
    if (g) g.forEach(f);
    else for (let m = 0; m < d.cells.length; m++) f(m);
  }
  setInterval(() => {
    if (document.hidden || !s.length) return;
    const u = s[Math.floor(Math.random() * s.length)], d = Y(n[Math.floor(Math.random() * n.length)]), g = [...Array(d.cells.length).keys()].sort(() => Math.random() - 0.5), r = i / d.g;
    let f = 0;
    const m = Math.ceil(g.length / 14), p = () => {
      const y = g.slice(f, f + m);
      f += m, u.ctx.fillStyle = "#ccff00", y.forEach((l) => u.ctx.fillRect(Math.floor(l % d.g * r), Math.floor(Math.floor(l / d.g) * r), Math.ceil(r), Math.ceil(r))), setTimeout(() => c(u.ctx, d, y), 70), f < g.length ? requestAnimationFrame(p) : u.face = d;
    };
    p();
  }, 240);
}
const Z = "█▓▒░<>/\\#$%&01NEON";
function te(e, { duration: n = 900 } = {}) {
  const t = e.dataset.text ?? e.textContent;
  e.dataset.text = t;
  const a = performance.now(), i = (s) => {
    const c = Math.min(1, (s - a) / n);
    let o = "";
    for (let u = 0; u < t.length; u++) {
      const d = t[u];
      d === " " || u / t.length < c ? o += d : o += Z[Math.floor(Math.random() * Z.length)];
    }
    e.textContent = o, c < 1 && requestAnimationFrame(i);
  };
  requestAnimationFrame(i);
}
function be() {
  const e = new IntersectionObserver(
    (n) => {
      for (const t of n)
        t.isIntersecting && (t.target.classList.add("in"), t.target.querySelectorAll("[data-scramble]").forEach((a) => te(a)), e.unobserve(t.target));
    },
    // any height: a ratio threshold never fires on a section taller than ~8 screens (a long view on a phone held sideways)
    { threshold: 0, rootMargin: "0px 0px -10% 0px" }
  );
  return document.querySelectorAll(".reveal, .trait").forEach((n) => e.observe(n)), e;
}
function xe() {
  const e = document.getElementById("cursor");
  if (!e) return;
  let n = -100, t = -100, a = -100, i = -100;
  window.addEventListener("pointermove", (c) => {
    n = c.clientX, t = c.clientY;
  }, { passive: !0 }), document.addEventListener("pointerover", (c) => e.classList.toggle("hover", !!c.target.closest("a,button,summary,.g-item,input")));
  const s = () => {
    a += (n - a) * 0.35, i += (t - i) * 0.35, e.style.transform = `translate(${Math.round(a / 6) * 6 - 9}px, ${Math.round(i / 6) * 6 - 9}px)`, requestAnimationFrame(s);
  };
  s();
}
function ve(e) {
  const t = ["TSLA", "NVDA", "AAPL", "AMZN", "MSFT", "GOOGL", "META", "SPY", "USDG", "■ 24/7", "THEY DON'T BLINK", "5555 FACES", "EVERY FACE IS AN ACCOUNT", "■ FULLY ON-CHAIN"].map((a) => `<span>${a}</span>`).join("");
  e.innerHTML = t + t;
}
const ne = "neonfaces:sound";
let b = null, F = null, R = null, k = !1;
try {
  k = localStorage.getItem(ne) === "on";
} catch {
}
function H() {
  if (!b) {
    const e = window.AudioContext || window.webkitAudioContext;
    if (!e) return null;
    b = new e(), F = b.createGain(), F.gain.value = 0.6, F.connect(b.destination);
  }
  return b.state === "suspended" && b.resume(), b;
}
function E(e, { dur: n = 0.05, type: t = "square", vol: a = 0.05, slide: i = 0, delay: s = 0 } = {}) {
  if (!k || !H()) return;
  const c = b.currentTime + s, o = b.createOscillator(), u = b.createGain();
  o.type = t, o.frequency.setValueAtTime(e, c), i && o.frequency.exponentialRampToValueAtTime(Math.max(40, e + i), c + n), u.gain.setValueAtTime(0, c), u.gain.linearRampToValueAtTime(a, c + 4e-3), u.gain.exponentialRampToValueAtTime(1e-4, c + n), o.connect(u).connect(F), o.start(c), o.stop(c + n + 0.02);
}
function oe() {
  if (R || !H()) return;
  const e = b.createOscillator(), n = b.createOscillator(), t = b.createBiquadFilter(), a = b.createGain(), i = b.createOscillator(), s = b.createGain();
  e.type = "sawtooth", e.frequency.value = 60, n.type = "square", n.frequency.value = 120, t.type = "lowpass", t.frequency.value = 340, a.gain.value = 0, a.gain.linearRampToValueAtTime(0.012, b.currentTime + 1.2), i.frequency.value = 0.37, s.gain.value = 4e-3, i.connect(s).connect(a.gain), e.connect(t), n.connect(t), t.connect(a).connect(F), [e, n, i].forEach((c) => c.start()), R = { g: a, nodes: [e, n, i] };
}
function Ae() {
  if (!R) return;
  const { g: e, nodes: n } = R;
  e.gain.cancelScheduledValues(b.currentTime), e.gain.linearRampToValueAtTime(0, b.currentTime + 0.3), n.forEach((t) => t.stop(b.currentTime + 0.35)), R = null;
}
let _ = 0;
const B = {
  get on() {
    return k;
  },
  set(e) {
    k = e;
    try {
      localStorage.setItem(ne, e ? "on" : "off");
    } catch {
    }
    e ? (H(), oe(), E(220, { dur: 0.08, slide: 660, vol: 0.05 }), E(880, { dur: 0.06, delay: 0.09, vol: 0.04 })) : Ae();
  },
  hover() {
    const e = performance.now();
    e - _ < 70 || (_ = e, E(1760, { dur: 0.018, vol: 0.018 }));
  },
  click: () => (E(660, { dur: 0.03, vol: 0.04 }), E(990, { dur: 0.04, delay: 0.035, vol: 0.035 })),
  open: () => E(330, { dur: 0.12, slide: 700, vol: 0.04, type: "triangle" }),
  close: () => E(900, { dur: 0.1, slide: -600, vol: 0.035, type: "triangle" }),
  success: () => [523, 659, 784, 1047].forEach((e, n) => E(e, { dur: 0.07, delay: n * 0.07, vol: 0.04 })),
  error: () => (E(140, { dur: 0.18, vol: 0.05, type: "sawtooth" }), E(110, { dur: 0.22, delay: 0.12, vol: 0.05, type: "sawtooth" })),
  sweep: () => E(180, { dur: 0.45, slide: 1400, vol: 0.025, type: "sawtooth" }),
  // a Face resolving block by block
  buzz: (e = 0.06) => (E(120, { dur: e, vol: 0.035, type: "sawtooth" }), E(240, { dur: e, vol: 0.012, type: "square" }))
  // a neon tube striking
};
function Ee(e) {
  const n = () => {
    e.setAttribute("aria-pressed", String(k)), e.title = k ? "Sound on" : "Sound off", e.classList.toggle("on", k);
  };
  n(), e.addEventListener("click", () => {
    B.set(!k), n();
  }), k && addEventListener("pointerdown", () => oe(), { once: !0 }), document.addEventListener("pointerover", (t) => t.target.closest?.("a, .btn, button, summary") && B.hover()), document.addEventListener("click", (t) => t.target.closest?.("a, .btn, button, summary") && t.target.closest("button") !== e && B.click());
}
const q = 768, z = 384;
function K(e, n) {
  const t = n / 1080;
  e.fillStyle = "#000", e.fillRect(0, Math.round(1008 * t), n, n - Math.round(1008 * t)), e.fillStyle = "#ccff00", e.fillRect(0, Math.round(1004 * t), n, Math.max(1, Math.round(4 * t))), e.textBaseline = "middle", e.textAlign = "left", e.font = `700 ${Math.round(30 * t)}px "Silkscreen", monospace`, e.fillText("NEONFACES", Math.round(28 * t), Math.round(1045 * t)), e.font = `600 ${Math.round(20 * t)}px "JetBrains Mono", monospace`, e.fillStyle = "#c9d4a3", e.textAlign = "right", e.fillText("NEONCAM · neonfaces.xyz", Math.round(1052 * t), Math.round(1045 * t)), e.textAlign = "left";
}
function Se() {
  if (typeof MediaRecorder > "u") return null;
  for (const e of ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"])
    try {
      if (MediaRecorder.isTypeSupported(e)) return e;
    } catch {
    }
  return null;
}
function Le(e) {
  const n = document.createElement("canvas");
  n.width = n.height = q;
  const t = n.getContext("2d"), a = document.createElement("canvas");
  a.width = a.height = z;
  const i = a.getContext("2d", { willReadFrequently: !0 }), s = Se(), c = typeof n.captureStream == "function";
  let o = null, u = [], d = 0, g = 0, r = 0, f = null, m = !1, p = [], y = null, l = [], h = [];
  const x = {
    get recording() {
      return m;
    },
    supported: !0,
    // the GIF needs nothing special; the video needs MediaRecorder + captureStream
    video: !!(s && c),
    frame() {
      m && (t.imageSmoothingEnabled = !1, t.drawImage(e, 0, 0, q, q), K(t, q), h.push(performance.now()), i.imageSmoothingEnabled = !1, i.drawImage(e, 0, 0, z, z), K(i, z), C(i.getImageData(0, 0, z, z).data));
    },
    start({ seconds: v = 5, onTick: T, onDone: A }) {
      if (x.cancel(), u = [], p = [], y = null, l = [], h = [], m = !0, f = A, r = performance.now(), x.frame(), x.video)
        try {
          o = new MediaRecorder(n.captureStream(15), { mimeType: s, videoBitsPerSecond: 8e6 }), o.ondataavailable = (w) => w.data?.size && u.push(w.data), o.onstop = S, o.start(250);
        } catch {
          o = null;
        }
      T?.(v), g = setInterval(() => T?.(Math.max(0, Math.ceil(v - (performance.now() - r) / 1e3))), 200), d = setTimeout(x.stop, v * 1e3);
    },
    stop() {
      m && (m = !1, clearTimeout(d), clearInterval(g), o && o.state !== "inactive" ? o.stop() : S());
    },
    cancel() {
      m = !1, clearTimeout(d), clearInterval(g), f = null, o && o.state !== "inactive" && (o.onstop = null, o.stop()), o = null;
    },
    async gif() {
      if (!l.length) throw new Error("no frames");
      y || M();
      const v = l.length, T = l.map((w, I) => Math.max(2, Math.round(((h[I + 1] ?? h[I] + 70) - h[I]) / 10))), A = l.map((w, I) => I);
      for (let w = v - 2; w > 0; w--) A.push(w);
      return Ce(z, z, y.bytes, A.map((w) => l[w]), A.map((w) => T[Math.min(w, v - 2)] ?? 7));
    }
  };
  function S() {
    const v = f;
    f = null, !y && p.length && M();
    const T = s ? s.startsWith("video/mp4") ? "mp4" : "webm" : null, A = u.length ? new Blob(u, { type: s.split(";")[0] }) : null;
    o = null, v?.({ video: A, ext: A ? T : null });
  }
  function C(v) {
    if (y) return l.push(y.map(v));
    p.push(v.slice()), p.length >= 4 && M();
  }
  function M() {
    y = Te(p), l.push(...p.map((v) => y.map(v))), p = [];
  }
  return x;
}
function Te(e) {
  const n = new Uint32Array(32768), t = new Float64Array(32768), a = new Float64Array(32768), i = new Float64Array(32768);
  for (const r of e)
    for (let f = 0; f < r.length; f += 4) {
      const m = r[f] >> 3 << 10 | r[f + 1] >> 3 << 5 | r[f + 2] >> 3;
      n[m]++, t[m] += r[f], a[m] += r[f + 1], i[m] += r[f + 2];
    }
  const s = [];
  for (let r = 0; r < 32768; r++) n[r] && s.push(r);
  s.sort((r, f) => n[f] - n[r]);
  const c = s.slice(0, 256), o = c.map((r) => [Math.round(t[r] / n[r]), Math.round(a[r] / n[r]), Math.round(i[r] / n[r])]);
  for (const r of [[0, 0, 0], [204, 255, 0], [201, 212, 163]]) {
    const f = r[0] >> 3 << 10 | r[1] >> 3 << 5 | r[2] >> 3, m = c.indexOf(f);
    m >= 0 ? o[m] = r : o.length < 256 ? o.push(r) : o[o.length - 1] = r;
  }
  const u = new Uint8Array(768);
  o.forEach((r, f) => u.set(r, f * 3));
  const d = new Int16Array(32768).fill(-1), g = (r, f, m, p) => {
    let y = 0, l = 1 / 0;
    for (let h = 0; h < o.length; h++) {
      const x = o[h][0] - f, S = o[h][1] - m, C = o[h][2] - p, M = 2 * x * x + 4 * S * S + C * C;
      M < l && (l = M, y = h);
    }
    return d[r] = y;
  };
  return {
    bytes: u,
    map(r) {
      const f = r.length >> 2, m = new Uint8Array(f);
      for (let p = 0; p < f; p++) {
        const y = r[p * 4] >> 3 << 10 | r[p * 4 + 1] >> 3 << 5 | r[p * 4 + 2] >> 3, l = d[y];
        m[p] = l >= 0 ? l : g(y, r[p * 4], r[p * 4 + 1], r[p * 4 + 2]);
      }
      return m;
    }
  };
}
async function Ce(e, n, t, a, i) {
  const s = [], c = [..."GIF89a"].map((o) => o.charCodeAt(0));
  c.push(e & 255, e >> 8, n & 255, n >> 8, 247, 0, 0), s.push(new Uint8Array(c), t), s.push(new Uint8Array([33, 255, 11, ...[..."NETSCAPE2.0"].map((o) => o.charCodeAt(0)), 3, 1, 0, 0, 0]));
  for (let o = 0; o < a.length; o++) {
    const u = i[o];
    s.push(new Uint8Array([
      33,
      249,
      4,
      4,
      u & 255,
      u >> 8,
      0,
      0,
      44,
      0,
      0,
      0,
      0,
      e & 255,
      e >> 8,
      n & 255,
      n >> 8,
      0
    ])), s.push(Ie(a[o])), o % 8 === 7 && await new Promise((d) => setTimeout(d));
  }
  return s.push(new Uint8Array([59])), new Blob(s, { type: "image/gif" });
}
function Ie(e) {
  let i = 9, s = 258, c = /* @__PURE__ */ new Map();
  const o = [];
  let u = 0, d = 0;
  const g = (p) => {
    for (u |= p << d, d += i; d >= 8; )
      o.push(u & 255), u >>>= 8, d -= 8;
  };
  g(256);
  let r = e[0];
  for (let p = 1; p < e.length; p++) {
    const y = e[p], l = r << 8 | y, h = c.get(l);
    if (h !== void 0) {
      r = h;
      continue;
    }
    g(r), s === 4096 ? (g(256), s = 258, i = 9, c = /* @__PURE__ */ new Map()) : (s >= 1 << i && i++, c.set(l, s++)), r = y;
  }
  g(r), g(257), d > 0 && o.push(u & 255);
  const f = new Uint8Array(1 + o.length + Math.ceil(o.length / 255) + 1);
  let m = 0;
  f[m++] = 8;
  for (let p = 0; p < o.length; p += 255) {
    const y = Math.min(255, o.length - p);
    f[m++] = y;
    for (let l = 0; l < y; l++) f[m++] = o[p + l];
  }
  return f[m++] = 0, f.subarray(0, m);
}
const O = (e) => document.querySelector(e);
Me();
xe();
Ee(O("#sound-btn"));
ve(O("#tape"));
X(O("#eye"));
X(O("#nav-eye"), { cols: 24, rows: 12, fade: !1 });
fetch("data/gallery.json").then((e) => e.json()).then((e) => we(O("#mosaic"), (e.faces ?? []).map((n) => n.record))).catch((e) => console.warn("mosaic:", e));
be();
document.querySelectorAll(".hero [data-scramble]").forEach((e) => te(e, { duration: 1400 }));
export {
  Le as camRecorder,
  B as sound
};
