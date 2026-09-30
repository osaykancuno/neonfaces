"""The launch-week pieces (second batch, 28 Sep), 9:16 + 4:5, in the movement's grammar (make_cut.py): the new clips,
the collection's own art and short instrumental beds (gen_music.py). Captions in the pixel font, for muted autoplay.

    python marketing/movement/make_launch.py              # all -> out/l-*.mp4 (+ -4x5.mp4)
    python marketing/movement/make_launch.py wall cam     # only these
    python marketing/movement/make_launch.py --site announce howto today   # plan B: the mint on neonfaces.xyz -> l-*-site.mp4
    python marketing/movement/make_launch.py --neutral announce            # no venue: "all at neonfaces.xyz" -> l-*-neutral.mp4

No date in: wall, tiers, chain, facts, cam, list, open, public. Dated (docs/LAUNCH-RUNBOOK.md, moved forward on 28 Sep):
announce, howto, tomorrow, today. Thu 1 Oct 18:00 UTC on OpenSea, the list first for 24 hours (0.013 ETH, up to 3),
then everyone from Fri 2 Oct 18:00 UTC (0.018 ETH, up to 5 per wallet in total).
"""
import json
import os
import random
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path[:0] = [str(HERE), str(ROOT / "art")]
import make_cut as mc  # noqa: E402
from make_cut import (ART, FPS, H, INK, NEON, PALE, DIM, SCORE, T1, T3, T5, W, bed, card, caption, clip_frames, score,  # noqa: E402
                      draw_text, ease, face_img, finish, flash, music, raw, real, turn, with_caption)
from export_brand import eye_image, gaze_path  # noqa: E402

ARTS = json.loads((ART / "art.json").read_text())
SITE = "--site" in sys.argv  # plan B (28 Sep): the mint happens on neonfaces.xyz, through SeaDrop, not on OpenSea's page
NEUTRAL = "--neutral" in sys.argv  # 29 Sep: announced before the venue is settled; the site says where
mc.FONT["?"] = ["01110", "10001", "00001", "00010", "00100", "00000", "00100"]
mc.FONT["#"] = ["01010", "01010", "11111", "01010", "11111", "01010", "01010"]
# everything that matters sits inside the 4:5 crop (y 360 to 1710)


def art_img(aid, size):
    return Image.open(ART / "images" / f"{aid}.png").convert("RGB").resize((size, size), Image.NEAREST)


def wall_bg(seed=7, tile=180, dim=0.11):
    """A dim wall of the collection's faces, behind text."""
    rng = random.Random(seed)
    ids = rng.sample(range(5555), (W // tile) * (H // tile + 1))
    im = Image.new("RGB", (W, H), INK)
    k = 0
    for y in range(0, H, tile):
        for x in range(0, W, tile):
            im.paste(art_img(ids[k], tile), (x, y))
            k += 1
    return (np.asarray(im).astype(np.float32) * dim).astype(np.uint8)


def lines_img(bg, lines):
    """Centred lines [(text, cell, colour)] on a background, stacked around the middle."""
    im = Image.fromarray(bg.copy())
    hs = [11 * c for _, c, _ in lines]
    y = (H - sum(hs)) // 2
    for (t, c, col), h in zip(lines, hs):
        if t:
            draw_text(im, t, W // 2, y, c, col, "center")
        y += h
    return np.asarray(im)


# ---------------------------------------------------------------- segments

def counter(dur, text=None):
    """5555 faces flash by, faster and faster, with a counter up to 5555."""
    rng = random.Random(5555)
    ids = list(range(5555))
    rng.shuffle(ids)
    n = int(round(dur * FPS))
    side, top = 960, 520
    for i in range(n):
        v = max(1, int(round(5555 * ease(i / (n - 1)) ** 1.6)))
        out = np.zeros((H, W, 3), np.uint8)
        out[top:top + side, 60:60 + side] = np.asarray(art_img(ids[v - 1], side))
        fr = Image.fromarray(out)
        draw_text(fr, f"{v:04d}", W // 2, top + side + 40, 11, NEON, "center")
        yield with_caption(finish(np.asarray(fr), i, art=True), text, y=420)


def the_eye(dur, text=None, seed=5555, cell=22, y=None):
    """The site's eye, big, looking around; it never blinks."""
    n = int(round(dur * FPS))
    path = gaze_path(n, seed)
    for i in range(n):
        e = eye_image(48, 24, cell, *path[i], i * 0.08)
        out = np.zeros((H, W, 3), np.uint8)
        yy = (H - e.height) // 2 - 120 if y is None else y
        out[yy:yy + e.height, (W - e.width) // 2:(W - e.width) // 2 + e.width] = np.asarray(e)
        yield with_caption(finish(out, i, art=True), text)


def cards(seq, seed=11):
    """Text cards on a dim wall: seq = [(seconds, [(text, cell, colour), ...])]; each flickers on."""
    bg = wall_bg(seed)
    k = 0
    for dur, lines in seq:
        base = lines_img(bg, lines)
        dark = (base.astype(np.float32) * 0.25).astype(np.uint8)
        n = int(round(dur * FPS))
        for i in range(n):
            fr = dark if i in (0, 2) else base
            yield finish(mc.drift(fr, i, n, 0.05), k, art=True)
            k += 1


def tier(t, label, count, dur):
    """A 3 x 3 wall of one tier's faces, changing one tile at a time; the tier's name and count."""
    ids = [a["artId"] for a in ARTS if a["tier"] == t]
    rng = random.Random(t)
    tile = 340
    x0, y0 = (W - 3 * tile) // 2, 380
    shown = rng.sample(ids, 9)
    n = int(round(dur * FPS))
    for i in range(n):
        if i and i % 3 == 0:
            shown[rng.randrange(9)] = rng.choice(ids)
        out = np.zeros((H, W, 3), np.uint8)
        for k, aid in enumerate(shown):
            x, y = x0 + (k % 3) * tile, y0 + (k // 3) * tile
            out[y + 4:y + tile - 4, x + 4:x + tile - 4] = np.asarray(art_img(aid, tile - 8))
        fr = Image.fromarray(out)
        draw_text(fr, label, W // 2, y0 + 3 * tile + 70, 11, NEON, "center")
        draw_text(fr, count, W // 2, y0 + 3 * tile + 190, 7, PALE, "center")
        if i < 2:
            fr = Image.fromarray(flash(np.asarray(fr)))
        yield finish(mc.drift(np.asarray(fr), i, n, 0.06), i, art=True)


def video_square(path, dur, text=None, t0=0.0):
    """A square pixel clip (the list's banners) at twice its size, cropped to the width."""
    frames = clip_frames_any(path, t0, dur, 1200)
    top = 400
    for i, f in enumerate(frames):
        out = np.zeros((H, W, 3), np.uint8)
        out[top:top + W] = f[60:1140, 60:1140]
        yield with_caption(finish(out, i, art=True), text)


def clip_frames_any(path, t0, dur, side):
    import subprocess
    raw_ = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t0}", "-t", f"{dur}", "-i", str(path),
                           "-vf", f"scale={side}:{side}:flags=neighbor,fps={FPS}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                          capture_output=True, check=True).stdout
    return np.frombuffer(raw_, np.uint8).reshape(-1, side, side, 3)


# NEONCAM, as in landing/index.html: levels 1st-99th percentile, contrast 1.25, shift -0.03, 6 x 6 samples per cell,
# v ** 1.05, five tones (Standard) at 0.20 / 0.37 / 0.55 / 0.72
CAM_PAL = np.array([(0, 0, 0), (0x27, 0x2f, 0x07), (0x53, 0x62, 0x1a), (0x88, 0xa2, 0x20), (0xcc, 0xff, 0x00)], np.float32)


def neoncam(img: Image.Image, n=24) -> np.ndarray:
    side = min(img.size)
    sq = img.convert("RGB").crop(((img.width - side) // 2, (img.height - side) // 2,
                                  (img.width + side) // 2, (img.height + side) // 2)).resize((n * 6, n * 6), Image.BILINEAR)
    a = np.asarray(sq).astype(np.float32)
    lum = a @ np.float32([0.2126, 0.7152, 0.0722])
    lo, hi = np.percentile(lum, [1, 99])
    v = np.clip((lum - lo) / max(24, hi - lo), 0, 1)
    v = np.clip((v - 0.5) * 1.25 + 0.5 - 0.03, 0, 1)
    cells = v.reshape(n, 6, n, 6).mean(axis=(1, 3)) ** 1.05
    return CAM_PAL[np.searchsorted([0.20, 0.37, 0.55, 0.72], cells, side="right")]


def cam_photo(img: Image.Image, n=32) -> np.ndarray:
    """The NEONCAM photo: 1080 x 1080, the face, a thin band with the name and the site (32 cells, one of its options)."""
    cells = neoncam(img, n)
    ph = cv2.resize(cells, (1080, 1080), interpolation=cv2.INTER_NEAREST).astype(np.uint8)
    ph[1004:1008] = NEON
    ph[1008:] = 0
    im = Image.fromarray(ph)
    draw_text(im, "NEONFACES", 28, 1030, 4, NEON)
    draw_text(im, "NEONCAM  NEONFACES.XYZ", 1052 - mc.text_width("NEONCAM  NEONFACES.XYZ", 3), 1034, 3, (201, 212, 163))
    return np.asarray(im)


def cam_turn(face_src: Image.Image, dur=3.0, text=None):
    """The portrait falls into cells, the cells into NEONCAM's five tones, then the photo with its band."""
    side = min(face_src.size)
    sq = np.asarray(face_src.convert("RGB").crop(((face_src.width - side) // 2, (face_src.height - side) // 2,
                                                  (face_src.width + side) // 2, (face_src.height + side) // 2))
                    .resize((W, W), Image.LANCZOS)).astype(np.float32)
    photo = cam_photo(face_src).astype(np.float32)
    top = 380
    n = int(round(dur * FPS))
    sizes = [3, 4, 6, 8, 12, 16, 20, 24, 28, 32]
    for i in range(n):
        p = i / (n - 1)
        out = np.zeros((H, W, 3), np.float32)
        if p < 0.55:
            s = sizes[min(len(sizes) - 1, int(p / 0.55 * len(sizes)))]
            s = max(s, 3)
            blk = cv2.resize(sq, (s * 6, s * 6), interpolation=cv2.INTER_AREA)
            toned = neoncam(Image.fromarray(np.clip(blk, 0, 255).astype(np.uint8)), s)
            mix = cv2.resize(blk, (s, s), interpolation=cv2.INTER_AREA) * (1 - ease(p / 0.55)) + toned * ease(p / 0.55)
            out[top:top + W] = cv2.resize(mix, (W, W), interpolation=cv2.INTER_NEAREST)
        else:
            out[top:top + W] = photo
            if int((p - 0.55) * n) < 2:
                out = np.minimum(out * 1.3, 255)
        yield with_caption(finish(mc.drift(out.astype(np.uint8), i, n, 0.05), i, art=True), text, y=1500)


def still(arr: np.ndarray, dur, text=None, top=None):
    n = int(round(dur * FPS))
    y = 380 if top is None else top
    for i in range(n):
        out = np.zeros((H, W, 3), np.uint8)
        out[y:y + arr.shape[0], :arr.shape[1]] = arr
        yield with_caption(finish(mc.drift(out, i, n, 0.06), i, art=True), text, y=1500)


def tiles(ids, dur, text=None):
    """Nine people in a 3 x 3 grid, each at the end of their clip (the moment they look up), lighting up one by one."""
    tw, th = W // 3, H // 3
    n = int(round(dur * FPS))
    clips = []
    for c in ids:
        fr = clip_frames(c, 1.0, 4.0)
        clips.append([cv2.resize(f, (tw, th), interpolation=cv2.INTER_AREA).astype(np.float32) for f in fr])
    order = [4, 0, 8, 2, 6, 1, 7, 3, 5]
    for i in range(n):
        out = np.zeros((H, W, 3), np.uint8)
        lit = min(9, 1 + int(i / (n * 0.6) * 9))
        for k in order[:lit]:
            pos = i * (len(clips[k]) - 1) / (n - 1)
            a, e = int(pos), pos - int(pos)
            f = clips[k][a] * (1 - e) + clips[k][min(a + 1, len(clips[k]) - 1)] * e
            out[(k // 3) * th:(k // 3) * th + th, (k % 3) * tw:(k % 3) * tw + tw] = f.astype(np.uint8)
        if lit < 9 and i % 3 == 0:
            out = flash(out) if i else out
        yield with_caption(finish(out, i), text)


def chain_draw(dur, text=None):
    """A real on-chain record: its bytes stream past, then the Face is drawn from them row by row."""
    from export_brand import face_image
    gallery = json.loads((ROOT / "web" / "public" / "data" / "gallery.json").read_text())
    rec = gallery["faces"][7]["record"]
    hexs = rec[2:].upper()
    rows = [hexs[k:k + 16] for k in range(0, len(hexs), 16)]
    full = np.asarray(face_image(rec, W))
    n = int(round(dur * FPS))
    split = int(n * 0.38)
    for i in range(n):
        out = np.zeros((H, W, 3), np.uint8)
        fr = Image.fromarray(out)
        if i < split:  # the bytes, scrolling
            pos = i / split * max(1, len(rows) - 12)  # a continuous scroll, not row by row
            first, frac = int(pos), pos - int(pos)
            for r, line in enumerate(rows[first:first + 14]):
                y = int(440 + (r - frac) * 72)
                if 400 <= y <= 1380:
                    draw_text(fr, " ".join(line[j:j + 2] for j in range(0, 16, 2)), W // 2, y, 6,
                              NEON if r == 12 else DIM, "center")
            out = np.asarray(fr)
        else:  # the picture, drawn from the top
            p = min(1.0, (i - split) / (n * 0.45))
            cut = int(W * p) // 27 * 27
            out = out.copy()
            out[380:380 + cut] = full[:cut]
            if p >= 1.0 and i - split - int(n * 0.45) < 2:
                out = flash(out)
        yield with_caption(finish(mc.drift(out, i, n, 0.06), i, art=True), text)


# ---------------------------------------------------------------- the pieces
# (seconds, generator) parts and (file, from, to, at, volume, fade in, fade out) sounds, as in make_cut.py

def wall():
    parts = [(9.0, lambda: counter(9.0, "5555 FACES.")),
             (3.0, lambda: the_eye(3.0, "ONE OF THEM IS LOOKING AT YOU."))]
    sounds = [score(music("wall"), 0.0, 12.0, 0.9)]
    return parts, sounds


def tiers():
    parts = [(4.2, lambda: tier(1, "GLANCE", "4444", 4.2)),
             (4.2, lambda: tier(2, "WATCH", "833", 4.2)),
             (4.2, lambda: tier(3, "HEAVY STARE", "278", 4.2)),
             (3.0, lambda: cards([(3.0, [("THE ART DECIDES.", 8, NEON), ("", 4, PALE), ("THE REVEAL SHOWS IT.", 6, PALE)])]))]
    sounds = [score(music("tiers"), 0.6, 15.6, 0.9)]
    return parts, sounds


def announce():
    seq = [(2.2, [("THURSDAY", 12, NEON), ("1 OCTOBER", 12, NEON)]),
           (2.2, [("18:00 UTC", 12, NEON), ("", 4, PALE), ("ALL AT NEONFACES.XYZ" if NEUTRAL else "ON NEONFACES.XYZ" if SITE else "ON OPENSEA", 7, PALE)]),
           (3.0, [("THE LIST FIRST", 9, NEON), ("", 4, PALE), ("24 HOURS", 7, PALE), ("0.013 ETH, UP TO 3", 6, PALE)]),
           (3.0, [("THEN EVERYONE", 9, NEON), ("", 4, PALE), ("FROM FRIDAY", 7, PALE), ("0.018 ETH, UP TO 5", 6, PALE)]),
           # the wallet check opens Thu 1 Oct 08:00 UTC with the day's first post (29 Sep), whatever the venue
           (2.8, [("ON THE LIST?", 8, NEON), ("", 4, PALE), ("FIND OUT THURSDAY", 6, PALE), ("08:00 UTC", 10, NEON), ("", 3, PALE), ("NEONFACES.XYZ", 8, PALE)])]
    parts = [(3.8, lambda: real("a-a", 0.1, 3.9, "NEONFACES HAS A DATE.")),
             (13.2, lambda: cards(seq)),
             (3.0, lambda: card("f56", "THEY DON'T BLINK."))]
    sounds = [(raw("a-a"), 0.1, 3.9, 0.0, 0.8, 0.0, 0.3), score(music("announce"), 1.5, 20.0, 0.9, ducks=[(16.1, 19.6)]),
              (T5, 3.3, 7.4, 15.9, 1.0, 0.05, 0.3)]
    return parts, sounds


def list_():
    parts = [(3.8, lambda: real("l-a", 0.1, 3.9, "IS YOUR WALLET ON THE LIST?")),
             (4.0, lambda: video_square(ROOT / "landing" / "img" / "list-in.mp4", 4.0)),
             (3.2, lambda: cards([(3.2, [("PASTE YOUR ADDRESS", 7, NEON), ("", 3, PALE), ("THE CHECK RUNS", 6, PALE),
                                         ("IN YOUR BROWSER", 6, PALE)])], seed=4)),
             (3.2, lambda: cards([(3.2, [("THE LIST MINTS FIRST", 7, NEON), ("", 3, PALE), ("24 HOURS, UP TO 3", 6, PALE),
                                         ("", 3, PALE), ("NEONFACES.XYZ", 8, PALE)])], seed=5))]
    sounds = [(raw("l-a"), 0.1, 3.9, 0.0, 0.8, 0.0, 0.3), score(music("info"), 3.8, 14.2, 0.9)]
    return parts, sounds


def cam():
    """29 Sep (the founder): longer, and mysterious rather than playful. His face, its NEONCAM photo in three grids, then
    the moment the camera turns on and the whole screen strikes neon (as on the site), the photo, the site, his Face.
    The strike lands on the score's hit; CAM_MUSIC picks the track (cam-dark-a, hit at 10 s; cam-dark-b, at 18.5 s)."""
    import os
    portrait = Image.open(HERE / "refs" / "cam-539.png")  # his face in the selfie still, as the phone sees it
    photo = cam_photo(portrait)
    name = os.environ.get("CAM_MUSIC", "cam-dark-a")
    face = lambda: real("c-a", 0.1, 3.9, "YOUR FACE.")
    turn_ = lambda: cam_turn(portrait, 3.2, "THEIR WAY.")
    grids = lambda d: lambda: cam_cells(portrait, d, "FIVE TONES. BLACK TO NEON.")
    kept = lambda d: lambda: still(photo, d, "NOTHING IS UPLOADED.")
    on = lambda d, s: lambda: cam_lit(photo, d, s, "CAMERA ON. THE SCREEN GLOWS NEON.")
    site = lambda d: lambda: cards([(d, [("SEE YOURSELF", 9, NEON), ("THE WAY THEY", 9, NEON), ("SEE YOU", 9, NEON),
                                         ("", 4, PALE), ("NEONFACES.XYZ", 8, PALE), ("", 2, PALE), ("#NEONFACE", 6, PALE)])], seed=9)
    end = lambda d: lambda: card("f539", "THEY DON'T BLINK.")
    if name == "cam-dark-b":  # a loud opening, a long hush, the hit at 18.5 s: the neon comes late, as a climax
        parts = [(3.8, face), (3.2, turn_), (3.0, grids(3.0)), (3.0, kept(3.0)), (6.0, on(6.0, 5.5)), (2.6, site(2.6)), (2.4, end(2.4))]
    else:  # cam-dark-a: it grows from the start, the hit at 10 s
        parts = [(3.8, face), (3.2, turn_), (5.0, on(5.0, 3.0)), (2.4, grids(2.4)), (2.6, kept(2.6)), (3.6, site(3.6)), (3.4, end(3.4))]
    sounds = [(raw("c-a"), 0.1, 3.9, 0.0, 1.0, 0.0, 0.15), score(music(name), 0.0, 24.0, 0.9, rise=(1.0, 3.8, 0.45))]
    return parts, sounds


def cam_cells(face_src: Image.Image, dur, text=None):
    """The same photo at NEONCAM's three grids, 24, 32 and 48 cells, one cut each with a neon flash."""
    shots = [cam_photo(face_src, n) for n in (24, 32, 48)]
    n = int(round(dur * FPS))
    for i in range(n):
        k = min(2, i * 3 // n)
        out = np.zeros((H, W, 3), np.uint8)
        out[380:380 + 1080] = shots[k]
        if i in (0, n // 3, 2 * n // 3):
            out = flash(out)
        yield with_caption(finish(mc.drift(out, i, n, 0.05), i, art=True), text, y=1500)


def cam_lit(photo: np.ndarray, dur, strike, text=None):
    """The camera on: the photo on a dark screen, then at `strike` seconds the whole screen catches neon like a tube
    (a few uneven flashes, then steady) with NEONCAM in black, the way the site lights a face in the dark."""
    n = int(round(dur * FPS))
    s0 = int(round(strike * FPS))
    pattern = [1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0]  # frames from the strike: on, off, on, off, then steady on
    dark = np.zeros((H, W, 3), np.uint8)
    dark[380:380 + 1080] = photo
    lit = np.zeros((H, W, 3), np.uint8)
    lit[:] = NEON
    inset = cv2.resize(photo, (920, 920), interpolation=cv2.INTER_NEAREST)
    lit[420:420 + 920, 80:80 + 920] = inset
    im = Image.fromarray(lit)
    draw_text(im, "NEONCAM", W // 2, 250, 10, INK, "center")
    lit = np.asarray(im)
    for i in range(n):
        j = i - s0
        on = j >= 0 and (j >= len(pattern) or pattern[j])
        fr = lit if on else dark
        yield with_caption(finish(mc.drift(fr, i, n, 0.04), i, art=not on), text, y=1500)


def howto():
    # posted Wed 30 Sep, before the check opens (Thu 1 Oct 08:00 UTC): step 1 says when
    steps = [("1", "CHECK YOUR WALLET", "THURSDAY 08:00 UTC, NEONFACES.XYZ"),
             ("2", "PUT ETH ON", "ROBINHOOD CHAIN"),
             ("3", "THURSDAY 18:00 UTC", "MINT ON NEONFACES.XYZ" if SITE else "OPEN THE DROP ON OPENSEA"),
             ("4", "THE LIST MINTS FIRST", "24 HOURS, UP TO 3 EACH"),
             ("5", "YOUR FACE ARRIVES", "WITH ITS OWN WALLET")]
    seq = [(2.7, [(n, 20, NEON), ("", 4, PALE), (a, 7, PALE), (b, 5, DIM)]) for n, a, b in steps]
    parts = [(3.6, lambda: real("h-a", 0.2, 3.8, "HOW TO MINT A FACE, IN FIVE STEPS.")),
             (13.5, lambda: cards(seq, seed=21)), (2.9, lambda: card("f471", "THEY DON'T BLINK."))]
    sounds = [(raw("h-a"), 0.2, 3.8, 0.0, 0.8, 0.0, 0.3), score(music("info"), 0.0, 20.0, 0.9, rise=(1.0, 3.6, 0.35))]
    return parts, sounds


def tomorrow():
    parts = [(3.8, lambda: real("m-a", 0.1, 3.9, "TOMORROW.")),
             (3.4, lambda: cards([(3.4, [("18:00 UTC", 12, NEON), ("", 4, PALE), ("THE LIST GOES FIRST", 6, PALE)])], seed=13)),
             (3.0, lambda: card("f58", "THEY DON'T BLINK."))]
    sounds = [(raw("m-a"), 0.1, 3.9, 0.0, 0.8, 0.0, 0.3), score(SCORE, 0.0, 10.2, 0.9, ducks=[(6.2, 9.7)], rise=(1.5, 3.8, 0.35)),
              (T5, 3.3, 7.4, 6.0, 1.0, 0.05, 0.3)]
    return parts, sounds


def today():
    parts = [(3.8, lambda: real("t-a", 0.1, 3.9, "TODAY.")),
             (3.0, lambda: turn("t-a", 3.6, "f257", 3.0, "18:00 UTC.")),
             (3.2, lambda: cards([(3.2, [("THE LIST FIRST", 8, NEON), ("", 3, PALE), ("24 HOURS", 7, PALE), ("", 3, PALE),
                                         ("NEONFACES.XYZ", 7, PALE)])], seed=17)),
             (3.0, lambda: card("f257", "TODAY. 18:00 UTC. NEONFACES.XYZ." if SITE else "TODAY. 18:00 UTC. OPENSEA."))]
    sounds = [(raw("t-a"), 0.1, 3.9, 0.0, 1.0, 0.0, 0.15), score(music("day"), 0.0, 13.0, 0.9, rise=(1.0, 3.8, 0.35))]
    return parts, sounds


def open_():
    people = ["n1-a", "n2-a", "n3-a", "n1-b", "t-a", "n2-c", "n3-b", "c-a", "n3-c"]
    parts = [(6.0, lambda: tiles(people, 6.0, "THEY DON'T BLINK.")),
             (3.2, lambda: cards([(3.2, [("THE LIST", 12, NEON), ("IS OPEN", 12, NEON)])], seed=19)),
             (3.4, lambda: cards([(3.4, [("24 HOURS", 9, NEON), ("", 4, PALE), ("THEN EVERYONE", 7, PALE), ("", 3, PALE),
                                         ("NEONFACES.XYZ", 7, PALE)])], seed=23))]
    sounds = [score(music("day"), 0.0, 12.6, 0.9)]
    return parts, sounds


def chain():
    parts = [(9.5, lambda: chain_draw(9.5, "190 BYTES.")),
             (2.5, lambda: cards([(2.5, [("THE CHAIN DRAWS IT", 8, NEON), ("", 4, PALE), ("EVERY TIME", 7, PALE)])], seed=29)),
             (3.0, lambda: card("f490", "NO SERVER. NO LINK THAT CAN BREAK."))]
    sounds = [score(music("chain"), 0.0, 15.0, 0.9, rise=(0.0, 3.5, 0.45))]
    return parts, sounds


def facts():
    """Check it yourself: five facts fixed on the chain (the preview's Facts view), on the melodic track kept aside."""
    items = [("5555", "FIXED IN THE CONTRACT", "IT CAN'T GROW"), ("111", "TEAM FACES", "CAPPED IN THE CONTRACT"),
             ("NO PROXY", "THE CONTRACTS", "CAN'T BE SWAPPED"), ("NO PAUSE", "TRANSFERS CAN NEVER", "BE STOPPED"),
             ("SEALED ART", "THE PIXELS MATCH A FINGERPRINT", "PUBLISHED BEFORE THE MINT")]
    seq = [(1.8, [("CHECK IT", 12, NEON), ("YOURSELF", 12, NEON)])]
    seq += [(2.6, [(a, 13 if len(a) < 6 else 10, NEON), ("", 4, PALE), (b, 6, PALE), (c, 6, PALE)]) for a, b, c in items]
    parts = [(14.8, lambda: cards(seq, seed=31)), (3.0, lambda: card("f130", "EVERYTHING IMPORTANT IS ON THE CHAIN."))]
    sounds = [score(HERE / "raw" / "music-n1-melodic.m4a", 0.0, 17.8, 0.9)]
    return parts, sounds


def public():
    """Fri 2 Oct 18:00 UTC: the sale opens to everyone. Nine other people of the batch look up together."""
    people = ["a-a", "l-a", "h-a", "n1-c", "m-a", "n2-b", "n3-b", "n2-c", "n1-b"]
    parts = [(6.0, lambda: tiles(people, 6.0, "NOW, EVERYONE.")),
             (3.2, lambda: cards([(3.2, [("OPEN TO", 12, NEON), ("EVERYONE", 12, NEON)])], seed=37)),
             (3.4, lambda: cards([(3.4, [("0.018 ETH", 9, NEON), ("", 4, PALE), ("UP TO 5 PER WALLET", 6, PALE),
                                         ("UNTIL THE LAST FACE", 6, PALE), ("", 3, PALE), ("NEONFACES.XYZ", 7, PALE)])], seed=41))]
    sounds = [score(HERE / "raw" / "music-announce-percussive.m4a", 0.0, 12.6, 0.9)]
    return parts, sounds


PIECES = {"public": public, "facts": facts, "chain": chain, "wall": wall, "tiers": tiers, "announce": announce, "list": list_, "cam": cam, "howto": howto,
          "tomorrow": tomorrow, "today": today, "open": open_}

if __name__ == "__main__":
    for name in [a for a in sys.argv[1:] if not a.startswith("--")] or list(PIECES):
        out = f"l-{name}-neutral" if NEUTRAL else f"l-{name}-site" if SITE else f"l-{name}"
        if name == "cam" and os.environ.get("CAM_MUSIC"):
            out += "-" + os.environ["CAM_MUSIC"].split("-")[-1]  # l-cam-a / l-cam-b
        mc.VIDEOS[out] = PIECES[name]
        mc.render(out)
