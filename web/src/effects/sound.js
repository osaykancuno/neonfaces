// Sound in the NEONFACES style: no music and no audio files, only tiny synthesized cues built in the browser
// (WebAudio). The hum of a neon tube, 8-bit blips, a scan sweep. Off by default; the choice is remembered.
const KEY = "neonfaces:sound";
let ctx = null;
let master = null;
let hum = null;
let on = false;
try {
  on = localStorage.getItem(KEY) === "on";
} catch {}

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.6;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

/** One square/triangle blip with a fast pixel-like envelope. */
function tone(freq, { dur = 0.05, type = "square", vol = 0.05, slide = 0, delay = 0 } = {}) {
  if (!on || !audio()) return;
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** The neon tube: a quiet 60 Hz buzz with a little flicker. */
function startHum() {
  if (hum || !audio()) return;
  const o = ctx.createOscillator();
  const o2 = ctx.createOscillator();
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  const lfo = ctx.createOscillator();
  const lfoGain = ctx.createGain();
  o.type = "sawtooth";
  o.frequency.value = 60;
  o2.type = "square";
  o2.frequency.value = 120;
  f.type = "lowpass";
  f.frequency.value = 340;
  g.gain.value = 0;
  g.gain.linearRampToValueAtTime(0.012, ctx.currentTime + 1.2);
  lfo.frequency.value = 0.37;
  lfoGain.gain.value = 0.004;
  lfo.connect(lfoGain).connect(g.gain);
  o.connect(f);
  o2.connect(f);
  f.connect(g).connect(master);
  [o, o2, lfo].forEach((x) => x.start());
  hum = { g, nodes: [o, o2, lfo] };
}
function stopHum() {
  if (!hum) return;
  const { g, nodes } = hum;
  g.gain.cancelScheduledValues(ctx.currentTime);
  g.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
  nodes.forEach((n) => n.stop(ctx.currentTime + 0.35));
  hum = null;
}

let lastHover = 0;
export const sound = {
  get on() {
    return on;
  },
  set(v) {
    on = v;
    try {
      localStorage.setItem(KEY, v ? "on" : "off");
    } catch {}
    if (v) {
      audio();
      startHum();
      tone(220, { dur: 0.08, slide: 660, vol: 0.05 }); // power on
      tone(880, { dur: 0.06, delay: 0.09, vol: 0.04 });
    } else stopHum();
  },
  hover() {
    const now = performance.now();
    if (now - lastHover < 70) return;
    lastHover = now;
    tone(1760, { dur: 0.018, vol: 0.018 });
  },
  click: () => (tone(660, { dur: 0.03, vol: 0.04 }), tone(990, { dur: 0.04, delay: 0.035, vol: 0.035 })),
  open: () => tone(330, { dur: 0.12, slide: 700, vol: 0.04, type: "triangle" }),
  close: () => tone(900, { dur: 0.1, slide: -600, vol: 0.035, type: "triangle" }),
  success: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, { dur: 0.07, delay: i * 0.07, vol: 0.04 })),
  error: () => (tone(140, { dur: 0.18, vol: 0.05, type: "sawtooth" }), tone(110, { dur: 0.22, delay: 0.12, vol: 0.05, type: "sawtooth" })),
  sweep: () => tone(180, { dur: 0.45, slide: 1400, vol: 0.025, type: "sawtooth" }), // a Face resolving block by block
};

/** Wire a toggle button and the ambient cues (hover and click on links and buttons). */
export function soundToggle(btn) {
  const paint = () => {
    btn.setAttribute("aria-pressed", String(on));
    btn.title = on ? "Sound on" : "Sound off";
    btn.classList.toggle("on", on);
  };
  paint();
  btn.addEventListener("click", () => {
    sound.set(!on);
    paint();
  });
  // browsers only allow audio after a gesture: resume the hum on the first one if sound was left on
  if (on) addEventListener("pointerdown", () => startHum(), { once: true });
  document.addEventListener("pointerover", (e) => e.target.closest?.("a, .btn, button, summary") && sound.hover());
  document.addEventListener("click", (e) => e.target.closest?.("a, .btn, button, summary") && e.target.closest("button") !== btn && sound.click());
}
