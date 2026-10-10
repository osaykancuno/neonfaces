// A NEONFACES eye rendered live in blocks. It follows the cursor. It never blinks; it can open, slowly (setOpen), for
// the NEONLIST check: the stare finds the wallet.
const PALETTE = ["#000000", "#1f2504", "#414d12", "#677920", "#94b21d", "#ccff00", "#f2ffc8"];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.47);

export function pixelEye(canvas, { cols = 48, rows = 24, fade = true, open = 1 } = {}) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;
  const cw = W / cols;
  const ch = H / rows;
  const target = { x: 0, y: 0 };
  const gaze = { x: 0, y: 0 };
  let saccade = { x: 0, y: 0, t: 0 };
  let visible = true;
  let lid = open; // 0 closed (a lash line), 1 wide open
  let lidTo = open;

  const onMove = (e) => {
    const r = canvas.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (window.innerWidth / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (window.innerHeight / 2);
    target.x = Math.max(-1, Math.min(1, dx * 1.4));
    target.y = Math.max(-1, Math.min(1, dy * 1.6));
  };
  window.addEventListener("pointermove", onMove, { passive: true });
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);

  function lum(u, v, gx, gy, t, lid) {
    // u in [-1,1] across, v in [-1,1] down
    let L = 1.0;
    // socket shadow, deeper at the inner corner (left)
    L -= 0.34 * Math.exp(-((u + 0.05) ** 2 / 0.5 + (v + 0.05) ** 2 / 0.35));
    L -= 0.25 * Math.exp(-((u + 0.95) ** 2 / 0.05 + (v - 0.1) ** 2 / 0.3));
    // brow
    const by = -0.72 - 0.12 * Math.sin(Math.PI * Math.min(1, Math.max(0, (u + 0.9) / 1.8)));
    if (Math.abs(v - by) < 0.13 * (1.2 - (u + 1) * 0.25) && u > -0.85 && u < 0.9) L *= 0.08;
    // crease
    const eh = 0.36 * lid;
    if (Math.abs(v - (-eh - 0.16 + 0.1 * u * u)) < 0.05 && Math.abs(u) < 0.75) L -= 0.25;
    // almond
    const w = 0.72;
    const dx = u / w;
    if (Math.abs(dx) < 1) {
      const up = -eh * Math.pow(1 - dx * dx, 0.8) - 0.03 * dx;
      const lo = eh * 0.8 * Math.pow(1 - dx * dx, 0.9) - 0.03 * dx;
      if (lid > 0.04 && v > up && v < lo) {
        L = 0.62 - 0.12 * (1 - Math.abs(dx));
        const ix = gx * w * 0.5;
        const iy = gy * eh * 0.35;
        const r = Math.hypot((u - ix) / 1.0, (v - iy) / 1.0);
        const R = 0.42;
        if (r < R) L = 0.1 + 0.1 * (r / R) + 0.04 * Math.sin(t * 2 + r * 30);
        if (r < R * 0.45) L = 0.0;
        if (Math.hypot(u - ix + 0.09, v - iy + 0.09) < R * 0.2) L = 1.0;
      }
      if (Math.abs(v - up) < 0.08 && v < up + 0.03) L = 0.0; // upper lid line
      if (Math.abs(v - lo) < 0.03) L *= 0.75;
    }
    // outer lash wedge
    if (u > w - 0.05 && u < w + 0.28 && Math.abs(v - (-0.08 - 0.6 * (u - w))) < 0.06) L = 0.02;
    // under-eye shadow + grain
    L -= 0.12 * Math.exp(-((u + 0.05) ** 2 / 0.3 + (v - 0.62) ** 2 / 0.02));
    L += Math.sin(u * 37.1 + v * 21.7) * 0.03;
    return L;
  }

  function frame(t) {
    requestAnimationFrame(frame);
    if (!visible) return;
    t /= 1000;
    // micro saccades: the stare never rests
    if (t > saccade.t) saccade = { x: (Math.random() - 0.5) * 0.18, y: (Math.random() - 0.5) * 0.12, t: t + 0.6 + Math.random() * 1.4 };
    gaze.x += (target.x + saccade.x - gaze.x) * 0.12;
    gaze.y += (target.y + saccade.y - gaze.y) * 0.12;
    lid += (lidTo - lid) * 0.07;

    ctx.clearRect(0, 0, W, H);
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const u = ((i + 0.5) / cols) * 2 - 1;
        const v = ((j + 0.5) / rows) * 2 - 1;
        let L = lum(u * 1.25, v * 1.25, gaze.x, gaze.y, t, lid);
        const d = BAYER[(j % 4) * 4 + (i % 4)];
        // fade to transparent at the frame edges (dithered)
        const edge = fade ? Math.min(1, (1 - Math.hypot(u * 0.92, v * 0.98)) * 3.4) : 1;
        if (edge + d * 0.9 < 0.5) continue;
        const k = Math.max(0, Math.min(6, Math.round(Math.max(0, Math.min(1, L)) * 5 + d * 0.7)));
        ctx.fillStyle = PALETTE[L >= 0.99 ? 6 : Math.min(k, 5)];
        ctx.fillRect(Math.floor(i * cw), Math.floor(j * ch), Math.ceil(cw), Math.ceil(ch));
      }
    }
  }
  requestAnimationFrame(frame);
  return { setOpen: (v) => (lidTo = Math.max(0, Math.min(1, v))) };
}
