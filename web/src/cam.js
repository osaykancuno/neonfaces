// NEONCAM, the camera tab (moved from the preview on 29 Sep so the links people share keep working after the launch).

let started = false;
/** Wire the Cam view once; main.js calls it the first time /cam opens. */
export function setupCam() {
  if (started) return;
  started = true;
  // NEONCAM: camera (or a photo) -> center square -> luminance, auto-levels -> 5 tones on a 24/32/48 grid (five, the
  // collection's number: the art's build_palette formula in render.py with 5 steps instead of 6),
  // the collection's grain and Gaze bloom. Local only: no upload, nothing stored.
  const PAL = [
    // black to the neon field, like the art (art/neonfaces/render.py): the brightest light becomes neon, never white
    ["#000000", "#272f07", "#53621a", "#88a220", "#ccff00"], // Standard
    ["#000000", "#242c07", "#4d5b18", "#7d971e", "#bcee00"], // Deep
    ["#000000", "#29300d", "#586425", "#90a533", "#d6ff1f"], // Hot
  ].map((p) => p.map((h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))));
  const $ = (id) => document.getElementById(id);
  const out = $("cam-out"), msg = $("cam-msg");
  const opt = { cells: 24, neon: 0, grain: 0, gaze: 0 };
  const small = document.createElement("canvas"), sctx = small.getContext("2d", { willReadFrequently: true });
  const cellCanvas = document.createElement("canvas"), cctx = cellCanvas.getContext("2d");
  const glow = document.createElement("canvas"), gctx = glow.getContext("2d");
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.setAttribute("playsinline", "");
  let stream = null, facing = "user", still = null, shot = null, raf = 0, last = 0, seed = 1;
  const say = (t) => (msg.textContent = t);
  const HERE = () => location.pathname === "/cam";
  // NEONCAM's light: while the camera is on (not for a photo), the page turns neon with black type, and so does the phone's
  // bar, so the screen lights the face like the films. It strikes like a tube, a few uneven flashes then steady; the
  // view is dark again when the camera stops or the view is left.
  let lit = false;
  const light = (on) => {
    if (on === lit) return;
    lit = on;
    const set = (v) => {
      document.documentElement.classList.toggle("neoncam", v);
      document.querySelector('meta[name="theme-color"]').content = v ? "#ccff00" : "#000000";
    };
    if (!on || matchMedia("(prefers-reduced-motion: reduce)").matches) return set(on);
    [[0, 1], [50, 0], [110, 1], [150, 0], [330, 1], [380, 0], [440, 1]].forEach(([t, v]) => setTimeout(() => lit && set(!!v), t));
  };
  const sync = () => light(HERE() && !document.hidden && !!stream); // the camera only: a photo keeps the page dark


  // one frame of the source (video or photo) -> the NEONFACES look, drawn on canvas `c` (size x size).
  // The same recipe as the collection (art/neonfaces/photo.py + render.py, Stair Step): levels between the 1st and
  // 99th percentile, print contrast 1.25 (density Mid), each cell the mean of 6 x 6 samples, then five tones: the
  // art's outer thresholds (black under 0.20, the neon field from 0.72, so the brightest light opens into neon as on
  // the Faces) and the band between them split in three.
  const OS = 6, CONTRAST = 1.25, SHIFT = -0.03, STEPS = [0.20, 0.37, 0.55, 0.72];
  function render(src, sw, sh, mirror, c, size) {
    const n = opt.cells, side = Math.min(sw, sh), m = n * OS;
    if (!side) return;
    small.width = small.height = m;
    sctx.save();
    if (mirror) { sctx.translate(m, 0); sctx.scale(-1, 1); }
    sctx.drawImage(src, (sw - side) / 2, (sh - side) / 2, side, side, 0, 0, m, m);
    sctx.restore();
    const px = sctx.getImageData(0, 0, m, m).data, lum = new Float32Array(m * m), hist = new Uint32Array(256);
    for (let i = 0; i < m * m; i++) {
      const y = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2];
      lum[i] = y; hist[y | 0]++;
    }
    let lo = 0, hi = 255, acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= m * m * 0.01) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc >= m * m * 0.01) { hi = v; break; } }
    const span = Math.max(24, hi - lo), pal = PAL[opt.neon];
    const img = cctx.createImageData(n, n), d = img.data;
    for (let r = 0; r < n; r++) {
      for (let q = 0; q < n; q++) {
        let sum = 0;
        for (let y = 0; y < OS; y++) {
          for (let x = 0; x < OS; x++) {
            const v = Math.min(1, Math.max(0, (lum[(r * OS + y) * m + q * OS + x] - lo) / span));
            sum += Math.min(1, Math.max(0, (v - 0.5) * CONTRAST + 0.5 + SHIFT));
          }
        }
        const v = (sum / (OS * OS)) ** 1.05;
        let k = 0;
        while (k < STEPS.length && v >= STEPS[k]) k++;
        const [R, G, B] = pal[k], i = (r * n + q) * 4;
        d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = 255;
      }
    }
    cellCanvas.width = cellCanvas.height = n;
    cctx.putImageData(img, 0, 0);
    const g = c.getContext("2d"), cell = size / n;
    g.imageSmoothingEnabled = false;
    g.globalCompositeOperation = "source-over"; g.globalAlpha = 1; g.filter = "none";
    g.drawImage(cellCanvas, 0, 0, size, size);
    if (opt.gaze) { // the Gaze: a blurred copy screened on top (renderer: 0.6 / 0.9 / 1.2 cells, slope .35 / .55 / .8)
      glow.width = glow.height = size;
      gctx.imageSmoothingEnabled = false;
      gctx.filter = `blur(${[0.6, 0.9, 1.2][opt.gaze - 1] * cell}px) brightness(${[0.35, 0.55, 0.8][opt.gaze - 1]})`;
      gctx.drawImage(cellCanvas, 0, 0, size, size);
      g.globalCompositeOperation = "screen";
      g.drawImage(glow, 0, 0);
      g.globalCompositeOperation = "source-over";
    }
    if (opt.grain === 1) { // Dusty: 90 specks, 70% dark, 30% light
      let r = seed;
      const rnd = () => (r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
      for (let i = 0; i < 90; i++) {
        const x = rnd() * size, y = rnd() * size, w = (0.08 + rnd() * 0.18) * cell;
        g.fillStyle = rnd() < 0.7 ? "rgba(0,0,0,.35)" : "rgba(204,255,0,.16)"; // light specks in neon, not white
        g.fillRect(x, y, w, w);
      }
    } else if (opt.grain === 2) { // Heavy Scan: a line every half cell, a light band, noise
      g.fillStyle = "rgba(0,0,0,.28)";
      for (let y = 0; y < size; y += cell / 2) g.fillRect(0, y, size, cell * 0.15);
      g.fillStyle = "rgba(204,255,0,.07)";
      g.fillRect(((seed % 97) / 97) * size * 0.9, 0, cell * (0.2 + (seed % 7) / 10), size);
      for (let i = 0; i < 700; i++) {
        g.fillStyle = `rgba(0,0,0,${(Math.random() * 0.25).toFixed(3)})`;
        g.fillRect(Math.random() * size, Math.random() * size, 2, 2);
      }
    }
  }

  function frame() {
    if (still) render(still, still.naturalWidth, still.naturalHeight, false, out, out.width);
    else if (video.readyState >= 2) render(video, video.videoWidth, video.videoHeight, facing === "user", out, out.width);
  }
  function loop(t) {
    raf = requestAnimationFrame(loop);
    if (t - last < 66) return; // about 15 frames a second: enough for the look, kind to phones
    last = t;
    frame();
  }

  async function startCam() {
    stopCam();
    if (!navigator.mediaDevices?.getUserMedia) return say("This browser can't open the camera here. Use a photo instead.");
    say("Asking for the camera…");
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 720 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      stream = null;
      return say(e?.name === "NotAllowedError" ? "Camera access was refused. Allow it in the browser settings, or use a photo." : "No camera available. Use a photo instead.");
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    still = null;
    ready();
    const cams = (await navigator.mediaDevices.enumerateDevices().catch(() => [])).filter((x) => x.kind === "videoinput");
    $("cam-flip").hidden = cams.length < 2;
    say("");
  }
  function stopCam() {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
    video.srcObject = null;
  }
  function ready() {
    $("cam-idle").hidden = true;
    $("cam-tools").hidden = false;
    seed = (Math.random() * 1e6) | 0;
    shot = null;
    buttons(false);
    if (!raf) raf = requestAnimationFrame(loop);
    sync();
  }
  // the system share sheet (phones: Instagram, X, WhatsApp…) only where it can carry the photo itself
  const canShareFiles = (() => {
    try { return !!navigator.canShare?.({ files: [new File([""], "neoncam.png", { type: "image/png" })] }); } catch { return false; }
  })();
  function buttons(taken) {
    $("cam-shot").hidden = taken;
    $("cam-save").hidden = $("cam-x").hidden = $("cam-again").hidden = !taken;
    $("cam-share").hidden = !taken || !canShareFiles;
    if (taken) $("cam-flip").hidden = true;
  }

  // the photo: 1080 x 1080, the face, then a thin band with the name and the site
  function takePhoto() {
    const c = document.createElement("canvas");
    c.width = c.height = 1080;
    if (still) render(still, still.naturalWidth, still.naturalHeight, false, c, 1080);
    else render(video, video.videoWidth, video.videoHeight, facing === "user", c, 1080);
    const g = c.getContext("2d");
    g.fillStyle = "#000"; g.fillRect(0, 1008, 1080, 72);
    g.fillStyle = "#ccff00"; g.fillRect(0, 1004, 1080, 4);
    g.textBaseline = "middle";
    g.font = '700 30px "Silkscreen", monospace'; g.fillText("NEONFACES", 28, 1045);
    g.font = '600 20px "JetBrains Mono", monospace'; g.fillStyle = "#c9d4a3"; g.textAlign = "right";
    g.fillText("NEONCAM · neonfaces.xyz", 1052, 1045);
    cancelAnimationFrame(raf);
    raf = 0;
    out.getContext("2d").drawImage(c, 0, 0, out.width, out.height); // the preview freezes on the photo
    c.toBlob((b) => { shot = b; buttons(true); say("Got it. Save it, or share it."); }, "image/png");
  }

  function save() {
    if (!shot) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(shot);
    a.download = "neoncam.png";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  // "/#cam" works on the preview and on the app (which sends it to /cam)
  const TEXT = "They don't blink. Neither do I. #NEONFACE by NEONFACES", LINK = "https://neonfaces.xyz/#cam";
  async function share() {
    if (!shot) return;
    const file = new File([shot], "neoncam.png", { type: "image/png" });
    try {
      await navigator.share({ files: [file], text: TEXT, url: LINK });
    } catch (e) {
      if (e?.name !== "AbortError") postX();
    }
  }
  // X can't receive a photo through a link: save it first, then open the post, ready to attach it
  function postX() {
    if (!shot) return;
    save();
    open(`https://x.com/intent/post?text=${encodeURIComponent(TEXT)}&url=${encodeURIComponent(LINK)}`, "_blank", "noopener");
    say("The photo is saved: attach it to the post that just opened.");
  }

  $("cam-start").addEventListener("click", startCam);
  $("cam-file").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => { stopCam(); still = img; $("cam-flip").hidden = true; ready(); say(""); };
    img.onerror = () => say("That file isn't an image this browser can read.");
    img.src = URL.createObjectURL(f);
    e.target.value = "";
  });
  $("cam-flip").addEventListener("click", () => { facing = facing === "user" ? "environment" : "user"; startCam(); });
  $("cam-shot").addEventListener("click", takePhoto);
  $("cam-save").addEventListener("click", save);
  $("cam-share").addEventListener("click", share);
  $("cam-x").addEventListener("click", postX);
  $("cam-again").addEventListener("click", () => { say(""); if (!still && !stream) startCam(); else ready(); });
  document.querySelectorAll("#cam-tools .cam-seg").forEach((seg) =>
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      seg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      opt[seg.dataset.opt] = Number(b.dataset.v);
      if (shot) { say(""); ready(); } else if (!raf) frame();
    }),
  );
  // leaving the view (or the browser tab) turns the camera off
  const off = () => {
    if (HERE() && !document.hidden) return sync();
    const was = !!stream;
    stopCam();
    cancelAnimationFrame(raf);
    raf = 0;
    if (was) { $("cam-idle").hidden = false; $("cam-tools").hidden = true; shot = null; }
    sync();
  };
  addEventListener("neon:route", off);
  document.addEventListener("visibilitychange", off);
}
