// NEONCAM clips (1 Oct 2026): up to 5 seconds of the live camera, saved as a video or as a GIF. Shared by the preview
// (landing/, through app.js) and the web app's Cam view. Everything happens on the device: the frames never leave it.
//
// While recording, every NEONCAM frame is drawn into a square with the photo's band (NEONFACES, NEONCAM · the site):
// the video is that canvas through MediaRecorder (MP4 where the browser can, WebM otherwise); the GIF is built from
// the same frames at 384 px, each with its own timing, played forward then backward so it loops without a jump.

// the cam's own canvas is 768 px: 24, 32 and 48 cells are 32, 24 and 16 px, so the video keeps the cells exact (and
// even, which the video's colour sampling needs), and the GIF at half size keeps them square too
const SIZE = 768; // the video
const GIF_SIZE = 384;
const BAND = 0.0667; // the band's height, as in the 1080 px photo (72 px)

/** The photo's band, scaled to a square of side `s`. */
export function camBand(g, s) {
  const k = s / 1080;
  g.fillStyle = "#000";
  g.fillRect(0, Math.round(1008 * k), s, s - Math.round(1008 * k));
  g.fillStyle = "#ccff00";
  g.fillRect(0, Math.round(1004 * k), s, Math.max(1, Math.round(4 * k)));
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.font = `700 ${Math.round(30 * k)}px "Silkscreen", monospace`;
  g.fillText("NEONFACES", Math.round(28 * k), Math.round(1045 * k));
  g.font = `600 ${Math.round(20 * k)}px "JetBrains Mono", monospace`;
  g.fillStyle = "#c9d4a3";
  g.textAlign = "right";
  g.fillText("NEONCAM · neonfaces.xyz", Math.round(1052 * k), Math.round(1045 * k));
  g.textAlign = "left";
}

function videoType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"]) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t;
    } catch {
      /* next */
    }
  }
  return null;
}

/**
 * A recorder for the NEONCAM canvas `out`. Call `frame()` after every NEONCAM render while `recording`.
 *   start({ seconds, onTick(left), onDone(clip) })   clip = { video: Blob|null, ext: "mp4"|"webm"|null }
 *   stop()      ends early (the clip keeps what was recorded)
 *   cancel()    drops everything (leaving the view, hiding the tab)
 *   gif()       Promise<Blob> of the last clip, forward then backward
 */
export function camRecorder(out) {
  const rc = document.createElement("canvas");
  rc.width = rc.height = SIZE;
  const rg = rc.getContext("2d");
  const gc = document.createElement("canvas");
  gc.width = gc.height = GIF_SIZE;
  const gg = gc.getContext("2d", { willReadFrequently: true });
  const type = videoType();
  const canCapture = typeof rc.captureStream === "function";
  let rec = null, chunks = [], timer = 0, tick = 0, t0 = 0, done = null, active = false;
  let raw = [], pal = null, frames = [], times = [];

  const self = {
    get recording() { return active; },
    supported: true, // the GIF needs nothing special; the video needs MediaRecorder + captureStream
    video: !!(type && canCapture),
    frame() {
      if (!active) return;
      rg.imageSmoothingEnabled = false;
      rg.drawImage(out, 0, 0, SIZE, SIZE);
      camBand(rg, SIZE);
      times.push(performance.now());
      gg.imageSmoothingEnabled = false; // the cells exactly halved, the band drawn at its own size (sharp type)
      gg.drawImage(out, 0, 0, GIF_SIZE, GIF_SIZE);
      camBand(gg, GIF_SIZE);
      keep(gg.getImageData(0, 0, GIF_SIZE, GIF_SIZE).data);
    },
    start({ seconds = 5, onTick, onDone }) {
      self.cancel();
      chunks = []; raw = []; pal = null; frames = []; times = [];
      active = true; done = onDone; t0 = performance.now();
      self.frame();
      if (self.video) {
        try {
          rec = new MediaRecorder(rc.captureStream(15), { mimeType: type, videoBitsPerSecond: 8_000_000 });
          rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
          rec.onstop = finish;
          rec.start(250);
        } catch {
          rec = null;
        }
      }
      onTick?.(seconds);
      tick = setInterval(() => onTick?.(Math.max(0, Math.ceil(seconds - (performance.now() - t0) / 1000))), 200);
      timer = setTimeout(self.stop, seconds * 1000);
    },
    stop() {
      if (!active) return;
      active = false;
      clearTimeout(timer); clearInterval(tick);
      if (rec && rec.state !== "inactive") rec.stop();
      else finish();
    },
    cancel() {
      active = false;
      clearTimeout(timer); clearInterval(tick);
      done = null;
      if (rec && rec.state !== "inactive") { rec.onstop = null; rec.stop(); }
      rec = null;
    },
    async gif() {
      if (!frames.length) throw new Error("no frames");
      if (!pal) fixPalette();
      // forward, then backward without repeating the two ends: a loop with no jump; each frame keeps its own timing
      const n = frames.length;
      const hold = frames.map((_, i) => Math.max(2, Math.round(((times[i + 1] ?? times[i] + 70) - times[i]) / 10)));
      const order = frames.map((_, i) => i);
      for (let i = n - 2; i > 0; i--) order.push(i);
      return encodeGif(GIF_SIZE, GIF_SIZE, pal.bytes, order.map((i) => frames[i]), order.map((i) => hold[Math.min(i, n - 2)] ?? 7));
    },
  };

  function finish() {
    const cb = done;
    done = null;
    if (!pal && raw.length) fixPalette();
    const ext = type ? (type.startsWith("video/mp4") ? "mp4" : "webm") : null;
    const video = chunks.length ? new Blob(chunks, { type: type.split(";")[0] }) : null;
    rec = null;
    cb?.({ video, ext: video ? ext : null });
  }

  // colours: the first frames decide the palette (NEONCAM draws few: five tones, the Gaze's glow, the grain, the band),
  // then every frame is mapped to it as it comes, so memory stays small
  function keep(px) {
    if (pal) return frames.push(pal.map(px));
    raw.push(px.slice());
    if (raw.length >= 4) fixPalette();
  }
  function fixPalette() {
    pal = palette(raw);
    frames.push(...raw.map((px) => pal.map(px)));
    raw = [];
  }
  return self;
}

/** Up to 256 colours by popularity over 15-bit colour, each the exact mean of what fell in it (so the cam's five tones
 *  come out as they are, not rounded), and a cached nearest-colour map. */
function palette(list) {
  const count = new Uint32Array(32768), sr = new Float64Array(32768), sg = new Float64Array(32768), sb = new Float64Array(32768);
  for (const px of list) {
    for (let i = 0; i < px.length; i += 4) {
      const k = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
      count[k]++; sr[k] += px[i]; sg[k] += px[i + 1]; sb[k] += px[i + 2];
    }
  }
  const keys = [];
  for (let k = 0; k < 32768; k++) if (count[k]) keys.push(k);
  keys.sort((a, b) => count[b] - count[a]);
  const top = keys.slice(0, 256);
  const cols = top.map((k) => [Math.round(sr[k] / count[k]), Math.round(sg[k] / count[k]), Math.round(sb[k] / count[k])]);
  // the exact ink of the band and the neon, whatever the frames held
  for (const c of [[0, 0, 0], [204, 255, 0], [201, 212, 163]]) {
    const k = ((c[0] >> 3) << 10) | ((c[1] >> 3) << 5) | (c[2] >> 3);
    const at = top.indexOf(k);
    if (at >= 0) cols[at] = c;
    else if (cols.length < 256) cols.push(c);
    else cols[cols.length - 1] = c;
  }
  const bytes = new Uint8Array(768);
  cols.forEach((c, i) => bytes.set(c, i * 3));
  const near = new Int16Array(32768).fill(-1);
  const find = (k, r, g, b) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i < cols.length; i++) {
      const dr = cols[i][0] - r, dg = cols[i][1] - g, db = cols[i][2] - b;
      const d = 2 * dr * dr + 4 * dg * dg + db * db;
      if (d < bd) { bd = d; best = i; }
    }
    return (near[k] = best);
  };
  return {
    bytes,
    map(px) {
      const n = px.length >> 2, idx = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        const k = ((px[i * 4] >> 3) << 10) | ((px[i * 4 + 1] >> 3) << 5) | (px[i * 4 + 2] >> 3);
        const v = near[k];
        idx[i] = v >= 0 ? v : find(k, px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      }
      return idx;
    },
  };
}

/** GIF89a, looping forever: a global 256-colour palette, one image per frame, `delays` in hundredths of a second. */
export async function encodeGif(w, h, palBytes, frames, delays) {
  const parts = [];
  const head = [..."GIF89a"].map((c) => c.charCodeAt(0));
  head.push(w & 255, w >> 8, h & 255, h >> 8, 0xf7, 0, 0);
  parts.push(new Uint8Array(head), palBytes);
  parts.push(new Uint8Array([0x21, 0xff, 0x0b, ...[..."NETSCAPE2.0"].map((c) => c.charCodeAt(0)), 3, 1, 0, 0, 0]));
  for (let f = 0; f < frames.length; f++) {
    const delay = delays[f];
    parts.push(new Uint8Array([0x21, 0xf9, 4, 0x04, delay & 255, delay >> 8, 0, 0,
      0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0])); // lzw() starts with the minimum code size
    parts.push(lzw(frames[f]));
    if (f % 8 === 7) await new Promise((r) => setTimeout(r)); // keep the page responsive on phones
  }
  parts.push(new Uint8Array([0x3b]));
  return new Blob(parts, { type: "image/gif" });
}

/** LZW with 8-bit indices, packed in sub-blocks of 255 bytes (the GIF variant, as in omggif). */
function lzw(index) {
  const minSize = 8, clear = 256, eoi = 257;
  let size = minSize + 1, next = eoi + 1, table = new Map();
  const bytes = [];
  let cur = 0, shift = 0;
  const emit = (code) => {
    cur |= code << shift;
    shift += size;
    while (shift >= 8) { bytes.push(cur & 255); cur >>>= 8; shift -= 8; }
  };
  emit(clear);
  let prefix = index[0];
  for (let i = 1; i < index.length; i++) {
    const k = index[i], key = (prefix << 8) | k, code = table.get(key);
    if (code !== undefined) { prefix = code; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      next = eoi + 1; size = minSize + 1; table = new Map();
    } else {
      if (next >= 1 << size) size++;
      table.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (shift > 0) bytes.push(cur & 255);
  const outp = new Uint8Array(1 + bytes.length + Math.ceil(bytes.length / 255) + 1);
  let p = 0;
  outp[p++] = minSize;
  for (let i = 0; i < bytes.length; i += 255) {
    const n = Math.min(255, bytes.length - i);
    outp[p++] = n;
    for (let j = 0; j < n; j++) outp[p++] = bytes[i + j];
  }
  outp[p++] = 0;
  return outp.subarray(0, p);
}
