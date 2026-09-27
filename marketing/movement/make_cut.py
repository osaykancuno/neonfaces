"""The five movement videos, 9:16 (1080x1920, 24 fps), cut from the generated clips and stills and the
collection's own art. Captions in the collection's pixel font, for muted autoplay.

    python marketing/movement/make_cut.py            # all five -> out/v1.mp4 ... out/v5.mp4 (+ 4:5 crops)
    python marketing/movement/make_cut.py v2 v5      # only these

Needs raw/<id>.mp4 (gen_clips.py) and frames/<id>.png (gen_frames.py). The grammar is the same in every video,
so real and pixel shots read as one world:
  real   a person in front, looking at the phone (its screen faces them, never us), lime light on the face
  ots    over the shoulder: the screen as they see it, with their own Face on it (a still, slow camera move)
  turn   their real face falls into cells and toned to the six colours of the art, then becomes their Face:
         how the collection was made (portraits of people who don't exist, through the pixel pipeline)
  art    the collection's own images: faces, the eye, the pieces, the Gaze, the card
Every frame gets the same film grain; the art gets the soft bloom of a screen.
"""
import json
import random
import subprocess
import sys
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ART = ROOT / "art" / "output"
TEASERS = ROOT / "marketing" / "teasers"
sys.path.insert(0, str(ROOT / "marketing" / "posts"))
sys.path.insert(0, str(HERE))
from make_posts import FONT, INK, NEON, DIM, PALE, draw_text, text_width  # noqa: E402
from make_frames import corners, screen_mask  # noqa: E402

W, H, FPS = 1080, 1920, 24
OUT = HERE / "out"
TONES = np.array([(0, 0, 0), (31, 37, 4), (65, 77, 18), (103, 121, 32), (148, 178, 29), (204, 255, 0)], np.float32)
STEPS = [0.20, 0.34, 0.47, 0.60, 0.72]  # the art's thresholds (NEONCAM uses the same)
DEEP = (40, 48, 10)
YUNET = ROOT / "art" / "models" / "face_detection_yunet_2023mar.onnx"
FONT.update({  # digits for DAY 30 / 90 / 365, in the same 5x7 hand
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
})
_rng = np.random.default_rng(7)
GRAIN = [_rng.normal(0, 5.0, (H, W, 1)).astype(np.float32) for _ in range(6)]


# ---------------------------------------------------------------- basics

def ease(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def finish(fr: np.ndarray, i: int, art: bool = False) -> np.ndarray:
    f = fr.astype(np.float32)
    if art:  # a screen's bloom on the neon, like the stills' pasted screens
        glow = cv2.GaussianBlur(f, (0, 0), 9) * 0.28
        f = 255 - (255 - f) * (255 - glow) / 255
    f += GRAIN[i % len(GRAIN)]
    return np.clip(f, 0, 255).astype(np.uint8)


def caption(img: Image.Image, text: str | None, y: int = 1470, cell: int = 6, color=PALE):
    """Centred lines in the pixel font on a black band; wraps to fit 960 px."""
    if not text:
        return
    words, lines, cur = text.split(), [], ""
    for w_ in words:
        t = (cur + " " + w_).strip()
        if text_width(t, cell) > 960 and cur:
            lines.append(cur)
            cur = w_
        else:
            cur = t
    lines.append(cur)
    lh = 11 * cell
    wmax = max(text_width(l_, cell) for l_ in lines) + 8 * cell
    band = Image.new("RGB", (wmax, lh * len(lines) + 4 * cell), INK)
    img.paste(band, ((W - wmax) // 2, y - 3 * cell))
    for k, l_ in enumerate(lines):
        draw_text(img, l_, W // 2, y + k * lh, cell, color, "center")


def with_caption(fr: np.ndarray, text: str | None, **kw) -> np.ndarray:
    if not text:
        return fr
    im = Image.fromarray(fr)
    caption(im, text, **kw)
    return np.asarray(im)


def clip_frames(cid: str, t0: float, t1: float):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t0}", "-t", f"{t1 - t0}", "-i", str(HERE / "raw" / f"{cid}.mp4"),
                          "-vf", f"scale={W}:{H}:flags=lanczos,fps={FPS}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)


def frame_at(cid: str, t: float) -> np.ndarray:
    return clip_frames(cid, t, t + 1.0 / FPS)[0]


def flash(fr: np.ndarray) -> np.ndarray:
    """A cut's flash toward the neon (not toward grey)."""
    return (fr.astype(np.float32) * 0.6 + np.float32(NEON) * 0.4).astype(np.uint8)


def face_img(name: str, size: int) -> Image.Image:
    """A Face or piece at `size`, nearest neighbour (the cells stay square). set-337 is the whole face of the
    four pieces (the site's image)."""
    p = ROOT / "landing" / "img" / "set-337.png" if name == "set-337" else HERE / "refs" / f"{name}.png"
    return Image.open(p).convert("RGB").resize((size, size), Image.NEAREST)


def detect(fr: np.ndarray):
    det = cv2.FaceDetectorYN.create(str(YUNET), "", (fr.shape[1], fr.shape[0]), 0.6, 0.3, 5000)
    _, faces = det.detect(cv2.cvtColor(fr, cv2.COLOR_RGB2BGR))
    if faces is None or len(faces) == 0:
        raise SystemExit("no face found for the turn")
    return max(faces, key=lambda f: f[2] * f[3])


# ---------------------------------------------------------------- segments (each yields frames)

def real(cid, t0, t1, text=None):
    for fr in clip_frames(cid, t0, t1):
        yield with_caption(fr, text)


def ots(shot, dur, z1=1.18, focus=None, text=None, into_screen=False):
    """A still over the shoulder with a slow push-in (toward the screen); into_screen: all the way in, until the
    screen fills the frame (V3 goes through it)."""
    src = Image.open(HERE / "frames" / f"{shot}.png").convert("RGB")
    sw, sh = src.size
    if focus is None or into_screen:
        q = corners(screen_mask(np.asarray(Image.open(HERE / "raw" / f"{shot}.png").convert("RGB"))))
        q = q * (sw / Image.open(HERE / "raw" / f"{shot}.png").size[0])
        c = q.mean(0)
        focus = (c[0] / sw, c[1] / sh)
        screen_h = max(np.linalg.norm(q[3] - q[0]), np.linalg.norm(q[2] - q[1]))
    n = int(round(dur * FPS))
    for i in range(n):
        t = i / max(1, n - 1)
        if into_screen:
            z = 1.0 * (1 - ease(t) ** 2) + (sh / screen_h * 0.8) * ease(t) ** 2
        else:
            z = 1.0 + (z1 - 1.0) * t
        cw, ch = sw / z, sh / z
        k = min(1.0, (z - 1) / max(0.001, z1 - 1)) if not into_screen else ease(t)
        cx = sw / 2 + (focus[0] * sw - sw / 2) * k + 3 * np.sin(i / 11)  # a hand-held breath
        cy = sh / 2 + (focus[1] * sh - sh / 2) * k + 3 * np.cos(i / 13)
        cx = min(max(cx, cw / 2), sw - cw / 2)
        cy = min(max(cy, ch / 2), sh - ch / 2)
        box = (cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2)
        fr = np.asarray(src.resize((W, H), Image.LANCZOS, box=box))
        yield with_caption(finish(fr, i), text)


def tone(sq: np.ndarray, lo: float, hi: float) -> np.ndarray:
    lum = sq.astype(np.float32) @ np.float32([0.299, 0.587, 0.114])
    t = np.clip((lum - lo) / max(hi - lo, 1), 0, 1) ** 1.05
    idx = np.searchsorted(STEPS, t)
    return TONES[idx]


def turn(cid, t, face, dur=3.0, text=None):
    """Their real face -> cells in the art's six tones -> their own Face (exact on-chain image)."""
    fr = frame_at(cid, t)
    x, y, w, h = detect(fr)[:4]
    side = 1.75 * w
    cx, cy = x + w / 2, y + h * 0.52
    # a black margin around the frame, so a face close to the lens can still be framed
    pad = W
    img = Image.fromarray(np.pad(fr, ((pad, pad), (pad, pad), (0, 0))))
    cx, cy = cx + pad, cy + pad
    sq_box = (cx - side / 2, cy - side / 2, cx + side / 2, cy + side / 2)
    square = np.asarray(img.resize((W, W), Image.LANCZOS, box=sq_box)).astype(np.float32)
    lum = square @ np.float32([0.299, 0.587, 0.114])
    lo, hi = np.percentile(lum, [5, 97])
    art = np.asarray(face_img(face, W)).astype(np.float32)
    top = (H - W) // 2
    n = int(round(dur * FPS))
    na, nb, nc = int(n * 0.2), int(n * 0.62), int(n * 0.8)
    sizes = [2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 22, 27]
    for i in range(n):
        out = np.zeros((H, W, 3), np.float32)
        if i < na:  # the camera closes in on the face; around it the world goes dark
            e = ease(i / na)
            # window: from the whole frame to the one whose middle band is the square
            zw = W + (side - W) * e
            zh = zw * H / W
            ccx = pad + W / 2 + (cx - pad - W / 2) * e
            ccy = pad + H / 2 + (cy - pad - H / 2) * e
            box = (ccx - zw / 2, ccy - zh / 2, ccx + zw / 2, ccy + zh / 2)
            out = np.asarray(img.resize((W, H), Image.LANCZOS, box=box)).astype(np.float32)
            out[:top] *= 1 - e
            out[top + W:] *= 1 - e
        elif i < nb:  # cells grow to the Face's own grid (40 x 40), the colours fall into the six tones
            p = (i - na) / (nb - na)
            s = sizes[min(len(sizes) - 1, int(p * len(sizes)))]
            m = W // s * s
            blk = cv2.resize(square[:m, :m], (m // s, m // s), interpolation=cv2.INTER_AREA)
            blk = np.clip(blk, 0, 255)
            toned = tone(blk, lo, hi)
            mix = blk * (1 - ease(p * 1.3)) + toned * ease(p * 1.3)
            cellimg = cv2.resize(mix, (m, m), interpolation=cv2.INTER_NEAREST)
            out[top:top + m, :m] = cellimg
        elif i < nc:  # the toned cells of the real face become the Face itself
            p = (i - nb) / (nc - nb)
            blk = cv2.resize(square, (40, 40), interpolation=cv2.INTER_AREA)
            toned = cv2.resize(tone(blk, lo, hi), (W, W), interpolation=cv2.INTER_NEAREST)
            out[top:top + W] = toned * (1 - p) + art * p
            if i == nb:
                out = out * 0.4
        else:
            out[top:top + W] = art
            if i == nc:
                out = np.minimum(out * 1.3, 255)
        yield with_caption(finish(out, i, art=i >= na), text)


def grid(lead, dur=3.5, text=None, seed=54):
    """The lead Face shrinks into a wall of 16 Faces, which light up one by one."""
    arts = json.loads((ART / "art.json").read_text())
    sets = [a["set"] for a in arts if "set" in a and a["piece"] == 0]
    rng = random.Random(seed)
    rng.shuffle(sets)
    lead_set = int(lead[1:])
    others = [s for s in sets if s != lead_set][:15]
    tile, cols, rows = 270, 4, 4
    y0 = (H - rows * tile) // 2
    slots = [(c * tile, y0 + r * tile) for r in range(rows) for c in range(cols)]
    home = slots.index((tile, y0 + tile))
    order = [s for s in range(16) if s != home]
    rng.shuffle(order)
    tiles = {home: np.asarray(face_img(lead, tile))}
    for s, n in zip(order, others):
        tiles[s] = np.asarray(Image.open(ART / "images" / f"set-{n}.png").convert("RGB").resize((tile, tile), Image.NEAREST))
    big = np.asarray(face_img(lead, W)).astype(np.float32)
    n = int(round(dur * FPS))
    shrink = int(0.6 * FPS)
    for i in range(n):
        out = np.zeros((H, W, 3), np.float32)
        if i < shrink:
            e = ease(i / shrink)
            size = int(W + (tile - W) * e)
            x = int(0 + (slots[home][0] - 0) * e)
            y = int((H - W) // 2 + (slots[home][1] - (H - W) // 2) * e)
            out[y:y + size, x:x + size] = cv2.resize(big, (size, size), interpolation=cv2.INTER_NEAREST)
        else:
            lit = int((i - shrink) / (n - shrink - 6) * len(order)) if n - shrink > 6 else len(order)
            on = [home] + order[:lit]
            for s in on:
                x, y = slots[s]
                v = tiles[s].astype(np.float32)
                if s != home and s == order[min(lit, len(order)) - 1] and i % 2:  # the newest one flickers on
                    v = v * 0.45
                out[y:y + tile, x:x + tile] = v
        yield with_caption(finish(out, i, art=True), text)


def cells(d, x0, y0, rows, colours, cell):
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch != ".":
                x, y = x0 + c * cell, y0 + r * cell
                d.rectangle([x, y, x + cell - 1, y + cell - 1], fill=colours[ch])


GOLD = ["..nnnnnnnn..", ".nppnnnnnnd.", "nnnnnnnnnndd", "dddddddddddd"]
SILVER = ["..pppppppp..", ".ppppppppdd.", "ppppppppppdd", "dddddddddddd"]
COIN = ["...nnnn...", ".nnddddnn.", ".ndnnnndn.", "ndnnnnnndn", "ndnnnnnndn", "ndnnnnnndn", ".ndnnnndn.",
        ".nnddddnn.", "...nnnn..."]
COLS = {"n": NEON, "d": DIM, "p": PALE, "k": DEEP}


def chamber(t: float, objects: bool, bars: float, cell=20) -> Image.Image:
    """Inside the pupil: a stepped olive ring, rising chart bars (bars = 0..1 grown), and with objects the basket's
    other kinds: a plain coin, a gold and a silver bar (no symbols, no text)."""
    f = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(f)
    cx, cy, r = W // 2, H // 2 - 80, 470 + 12 * np.sin(t * 2.2)
    for gy in range(0, H, cell):
        for gx in range(0, W, cell):
            dist = ((gx + cell / 2 - cx) ** 2 + (gy + cell / 2 - cy) ** 2) ** 0.5
            if r + 50 < dist <= r + 100:
                d.rectangle([gx, gy, gx + cell - 1, gy + cell - 1], fill=DIM)
            elif r < dist <= r + 50 or r + 100 < dist <= r + 170:
                d.rectangle([gx, gy, gx + cell - 1, gy + cell - 1], fill=DEEP)
    heights = [2, 4, 3, 6, 5, 8]  # a market that goes up and down, and up
    base_y = cy + 150
    for k, hgt in enumerate(heights):
        grown = int(round(hgt * min(1.0, max(0.0, bars * len(heights) - k))))
        x = cx - 330 + k * 3 * cell
        for j in range(grown):
            d.rectangle([x, base_y - (j + 1) * cell, x + 2 * cell - 1, base_y - j * cell - 1], fill=NEON)
    d.rectangle([cx - 350, base_y, cx - 330 + 6 * 3 * cell, base_y + cell - 1], fill=DIM)
    if objects:
        bob = lambda ph: int(10 * np.sin(t * 2.6 + ph))  # noqa: E731
        cells(d, cx + 110, cy - 320 + bob(0), COIN, COLS, cell)
        cells(d, cx + 110, cy - 20 + bob(2.1), SILVER, COLS, cell)
        cells(d, cx + 70, cy + 200 + bob(1.3), GOLD, COLS, cell)
    for x, y in [(cx - 260, cy - 300), (cx + 330, cy - 60), (cx - 380, cy + 40), (cx - 60, cy + 330), (cx + 300, cy + 300)]:
        yy = int(y + 8 * np.sin(t * 1.7 + x))
        d.rectangle([x, yy, x + cell - 1, yy + cell - 1], fill=DIM)
    return f


def eye(face, dur=3.5, text=None):
    """Into the eye of a Face (nearest-neighbour zoom), then inside: bars rising in the pupil."""
    img = face_img(face, 1200)
    ex, ey = eye_point(face)
    n = int(round(dur * FPS))
    zoom_n = int(1.3 * FPS)
    for i in range(n):
        if i < zoom_n:
            e = ease(i / zoom_n) ** 1.6
            side = 1200 * (1 - e) + 330 * e
            x0 = 600 + (ex - 600) * e - side / 2
            y0 = 600 + (ey - 600) * e - side / 2
            sq = img.resize((W, W), Image.NEAREST, box=(x0, y0, x0 + side, y0 + side))
            fr = Image.new("RGB", (W, H), INK)
            fr.paste(sq, (0, (H - W) // 2))
            out = np.asarray(fr)
        else:
            t = (i - zoom_n) / FPS
            out = np.asarray(chamber(t, objects=False, bars=min(1.0, t / 1.6)))
            if i - zoom_n < 2:
                out = flash(out)
        yield with_caption(finish(out, i, art=True), text)


EYES = {"f385": (780.0, 400.0)}  # the open eye of each Face used here, in its 1200 px image (read by eye)


def eye_point(face):
    return EYES[face]


def inside(dur=4.5, text=None):
    n = int(round(dur * FPS))
    for i in range(n):
        t = i / FPS
        out = np.asarray(chamber(t, objects=t > 0.5, bars=min(1.0, t / 1.2)))
        if i < 2:
            out = flash(out)
        yield with_caption(finish(out, i, art=True), text)


def assembly(dur=3.5, text=None):
    """The four pieces of set #337 slide in from the corners and lock into one face."""
    size = 480
    pieces = [face_img(f"piece-337-{q}", size) for q in range(4)]
    x0, y0 = (W - 2 * size) // 2, (H - 2 * size) // 2
    home = [(x0, y0), (x0 + size, y0), (x0, y0 + size), (x0 + size, y0 + size)]
    away = [(-700, -900), (700, -900), (-700, 900), (700, 900)]
    n = int(round(dur * FPS))
    lock = int(n * 0.55)
    for i in range(n):
        e = 1 - (1 - min(1.0, i / lock)) ** 3
        fr = Image.new("RGB", (W, H), INK)
        for q in range(4):
            fr.paste(pieces[q], (int(home[q][0] + away[q][0] * (1 - e)), int(home[q][1] + away[q][1] * (1 - e))))
        out = np.asarray(fr)
        if lock <= i < lock + 3:  # the click
            out = np.minimum(out.astype(np.int32) * 1.35, 255).astype(np.uint8)
        yield with_caption(finish(out, i, art=True), text)


LEVELS = [(None, None, None), ("STEADY", 0.6, 0.35), ("FIXED", 0.9, 0.55), ("PIERCING", 1.2, 0.8)]


def gaze(face, dur=4.8, text=None):
    """A Face through the Gaze levels: the neon blooms as in the renderer (blur in cells, slope, screen blend)."""
    base = np.asarray(face_img(face, W)).astype(np.float32)
    cell = W / 40
    n = int(round(dur * FPS))
    per = n // 4
    for i in range(n):
        k = min(3, i // per)
        name, sd, slope = LEVELS[k]
        im = base.copy()
        if sd:
            glow = cv2.GaussianBlur(im, (0, 0), sd * cell) * slope
            im = 255 - (255 - im) * (255 - glow) / 255
        out = np.zeros((H, W, 3), np.float32)
        top = (H - W) // 2 - 120
        out[top:top + W] = im
        if i % per < 2 and k:  # a flicker as the level changes
            out *= 0.5
        fr = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))
        if name:
            draw_text(fr, name, W // 2, top + W + 90, 12, NEON, "center")
        yield with_caption(finish(np.asarray(fr), i, art=True), text)


def card(face, line, dur=3.0):
    base = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(base)
    for k in range(6):
        d.rectangle([60 + k, 400 + k, W - 61 - k, H - 401 - k], outline=NEON)  # inside the 4:5 crop
    base.paste(face_img(face, 560), ((W - 560) // 2, 470))
    draw_text(base, "NEONFACES", W // 2, 1100, 14, NEON, "center")
    caption(base, line, y=1290, cell=6, color=PALE)
    dark = Image.eval(base, lambda v: v // 6)
    flick = [0, 1, 0, 0, 1, 1, 0, 1]
    n = int(round(dur * FPS))
    for i in range(n):
        fr = base if i >= len(flick) or flick[i] else dark
        yield finish(np.asarray(fr), i, art=True)


# ---------------------------------------------------------------- the five videos
# Each: a list of (seconds, generator) and the sounds: (file, from, to, at, volume, fade in, fade out).
# Clip sound: every real shot keeps its own; an ots still carries the sound of the same place, softer.

def raw(c):
    return HERE / "raw" / f"{c}.mp4"


T1, T2, T3, T5 = (TEASERS / f"{n}.mp4" for n in ("1-signal", "2-watching", "3-eyes", "5-soon"))


def v1():
    parts = [
        (4.0, lambda: real("v1-a", 0.2, 4.2, "EVERYONE HAS A SCREEN.")),
        (3.0, lambda: ots("h1", 3.0, text="SOME SCREENS STARE BACK.")),
        (3.5, lambda: real("v1-b", 1.5, 5.0)),
        (3.2, lambda: real("v1-c", 0.2, 3.4)),
        (3.0, lambda: turn("v1-c", 3.3, "f419", 3.0, "5555 FACES. EACH ONE SOMEONE.")),
        (3.5, lambda: grid("f419", 3.5, "FULLY ON-CHAIN.")),
        (3.0, lambda: card("f419", "THEY DON'T BLINK.")),
    ]
    sounds = [(raw("v1-a"), 0.2, 4.2, 0.0, 1.0, 0.0, 0.15), (raw("v1-a"), 0.0, 3.0, 4.0, 0.6, 0.1, 0.2),
              (raw("v1-b"), 1.5, 5.0, 7.0, 1.0, 0.05, 0.15), (raw("v1-c"), 0.2, 3.4, 10.5, 1.6, 0.05, 0.1),
              (T1, 0.0, 1.5, 13.7, 1.0, 0.0, 0.3), (T3, 0.0, 2.8, 14.2, 2.4, 0.1, 0.3),
              (T5, 1.2, 7.9, 17.8, 1.0, 0.3, 0.8)]
    return parts, sounds


def v2():
    parts = [
        (4.5, lambda: real("v2-a", 0.2, 4.7, "5:50 AM.")),
        (2.5, lambda: ots("h2", 2.5, text="STILL WATCHING.")),
        (4.0, lambda: real("v2-b", 0.8, 4.8)),
        (3.3, lambda: real("v2-c", 1.5, 4.8, "THE MARKET NEVER CLOSES.")),
        (3.0, lambda: turn("v2-c", 4.6, "f385", 3.0, "NEITHER DO THEY.")),
        (3.5, lambda: eye("f385", 3.5, "THE CHART LIVES IN THE EYE.")),
        (3.0, lambda: card("f385", "THE MARKET NEVER CLOSES. NEITHER DO THEY.")),
    ]
    sounds = [(raw("v2-a"), 0.2, 4.7, 0.0, 1.0, 0.0, 0.15), (raw("v2-a"), 0.0, 2.5, 4.5, 0.6, 0.1, 0.2),
              (raw("v2-b"), 0.8, 4.8, 7.0, 1.0, 0.05, 0.15), (raw("v2-c"), 1.5, 4.8, 11.0, 1.0, 0.05, 0.1),
              (T3, 3.6, 5.4, 11.4, 1.3, 0.05, 0.2), (T1, 0.0, 1.5, 14.3, 1.0, 0.0, 0.3),
              (T3, 0.0, 3.0, 14.8, 2.0, 0.1, 0.3), (T3, 5.4, 8.0, 17.3, 1.4, 0.2, 0.4),
              (T5, 3.6, 7.9, 20.6, 1.0, 0.05, 0.8)]
    return parts, sounds


def v3():
    parts = [
        (4.5, lambda: real("v3-a", 0.2, 4.7, "LOOK CLOSER.")),
        (3.5, lambda: ots("h3", 3.5, text="EVERY FACE IS A WALLET.", into_screen=True)),
        (5.0, lambda: inside(5.0, "A SMALL PIECE OF THE MARKET INSIDE.")),
        (4.6, lambda: real("v3-d", 0.2, 4.8, "IT GOES WHERE YOU GO.")),
        (3.5, lambda: card("f286", "EVERY FACE IS A WALLET.", 3.5)),
    ]
    sounds = [(raw("v3-a"), 0.2, 4.7, 0.0, 1.0, 0.0, 0.15), (T1, 6.1, 7.2, 0.3, 1.3, 0.02, 0.2),
              (raw("v3-a"), 0.0, 3.5, 4.5, 0.5, 0.1, 0.3), (T1, 0.0, 1.6, 7.3, 1.2, 0.02, 0.3),
              (T3, 0.0, 5.0, 8.0, 1.6, 0.1, 0.4), (raw("v3-d"), 0.2, 4.8, 13.0, 1.0, 0.1, 0.2),
              (T5, 3.6, 7.9, 17.4, 1.0, 0.05, 0.8)]
    return parts, sounds


def v4():
    parts, sounds, at = [], [], 0.0
    lines = ["SOME FACES ARE ONE OF FOUR.", "SOME FACES ARE ONE OF FOUR.", "FOUR HOLDERS.", "FOUR HOLDERS."]
    for k, (c, p) in enumerate(zip(["v4-a", "v4-b", "v4-c", "v4-d"], ["p1", "p2", "p3", "p4"])):
        parts.append((1.3, lambda p=p, k=k: ots(p, 1.3, z1=1.08, text=lines[k])))
        parts.append((2.9, lambda c=c, k=k: real(c, 1.0, 3.9, lines[k])))
        sounds.append((raw(c), 0.0, 1.3, at, 0.6, 0.05, 0.1))
        sounds.append((raw(c), 1.0, 3.9, at + 1.3, 1.0, 0.03, 0.1))
        at += 4.2
    parts.append((3.5, lambda: assembly(3.5, "ONE FACE.")))
    parts.append((3.0, lambda: card("set-337", "ONE FACE. FOUR PIECES.")))
    sounds += [(T5, 1.2, 7.9, at + 1.1, 1.0, 0.3, 0.8)]  # the riser under the pieces, the line on the card
    return parts, sounds


def v5():
    parts = [
        (4.3, lambda: real("v5-a", 0.3, 4.6, "DAY 30.")),
        (4.3, lambda: real("v5-b", 0.3, 4.6, "DAY 90.")),
        (3.0, lambda: ots("h5", 3.0, text="DAY 365.")),
        (3.0, lambda: real("v5-c", 0.4, 3.4, "DAY 365.")),
        (3.0, lambda: turn("v5-c", 3.3, "f198", 3.0)),
        (4.8, lambda: gaze("f198", 4.8)),
        (3.0, lambda: card("f198", "THE LONGER IT STAYS, THE HARDER IT STARES.")),
    ]
    sounds = [(raw("v5-a"), 0.3, 4.6, 0.0, 1.0, 0.0, 0.15), (raw("v5-b"), 0.3, 4.6, 4.3, 1.0, 0.05, 0.15),
              (raw("v5-c"), 0.0, 3.0, 8.6, 0.6, 0.1, 0.1), (raw("v5-c"), 0.4, 3.4, 11.6, 1.0, 0.05, 0.1),
              (T1, 0.0, 1.5, 14.6, 1.0, 0.0, 0.3), (T2, 2.8, 5.0, 14.8, 1.3, 0.05, 0.2),
              (T2, 5.0, 8.0, 17.0, 1.2, 0.2, 0.6), (T5, 1.2, 7.9, 20.0, 1.0, 0.3, 0.8)]
    return parts, sounds


VIDEOS = {"v1": v1, "v2": v2, "v3": v3, "v4": v4, "v5": v5}


# ---------------------------------------------------------------- render

def render(name: str):
    parts, sounds = VIDEOS[name]()
    length = sum(d for d, _ in parts)
    OUT.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as t:
        silent = Path(t) / "video.mp4"
        enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                                "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-crf", "21", "-preset", "slow",
                                "-pix_fmt", "yuv420p", str(silent)], stdin=subprocess.PIPE)
        count = 0
        for dur, make in parts:
            want = int(round(dur * FPS))
            got = 0
            last = None
            for fr in make():
                if got == want:
                    break
                enc.stdin.write(np.ascontiguousarray(fr, np.uint8).tobytes())
                last = fr
                got += 1
            while got < want:  # a clip a frame short: hold its last frame
                enc.stdin.write(np.ascontiguousarray(last, np.uint8).tobytes())
                got += 1
            count += got
        enc.stdin.close()
        enc.wait()
        inputs, chains, labels = [], [], []
        for k, (src, a, b, at, vol, fi, fo) in enumerate(sounds):
            inputs += ["-i", str(src)]
            d = b - a
            chains.append(f"[{k + 1}:a]atrim={a}:{b},asetpts=PTS-STARTPTS,volume={vol},afade=t=in:d={fi},"
                          f"afade=t=out:st={max(0.0, d - fo):.3f}:d={fo},adelay={int(at * 1000)}|{int(at * 1000)}[s{k}]")
            labels.append(f"[s{k}]")
        mix = ";".join(chains) + ";" + "".join(labels) + \
            f"amix=inputs={len(labels)}:normalize=0,atrim=0:{length},loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[a]"
        master = OUT / f"{name}.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(silent), *inputs, "-filter_complex", mix,
                        "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", f"{length}",
                        str(master)], check=True)
        # 4:5 for feeds: the middle of the frame (captions sit inside it)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(master), "-vf", "crop=1080:1350:0:360",
                        "-c:v", "libx264", "-crf", "21", "-preset", "slow", "-c:a", "copy", str(OUT / f"{name}-4x5.mp4")],
                       check=True)
    print(f"out/{name}.mp4  {length:.1f} s, {count} frames (+ out/{name}-4x5.mp4)")


if __name__ == "__main__":
    for v in sys.argv[1:] or list(VIDEOS):
        render(v)
