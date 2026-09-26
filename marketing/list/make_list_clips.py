"""The two clips of the wallet check ("Is your wallet on the list?"), built from the collection's own art.

    python marketing/list/make_list_clips.py        (repo root; ffmpeg on PATH)

list-in:  the mosaic of Faces lights up tile by tile, the eye of the logo opens, a neon flash, YOU'RE IN / ON THE LIST
list-out: the same mosaic stays dark olive, the eye half opens, looks away and closes, NOT ON THE LIST, no neon
600 x 600, 24 fps, 4 s, silent H.264 (plays inline and muted on iPhone and Android), plus the last frame as a poster
for people who turn motion off. Written to landing/img/ and web/public/img/.
"""
import json
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "art"))
sys.path.insert(0, str(ROOT / "marketing" / "posts"))
from export_brand import eye_image, face_image, gaze_path  # noqa: E402
from make_posts import draw_text, text_width  # noqa: E402

S, TILE, FPS, N = 600, 75, 24, 96
COLS = S // TILE
BLACK, NEON, ICE = (0, 0, 0), (204, 255, 0), (242, 255, 200)
OLIVE, OLIVE_DARK, OLIVE_TEXT = (103, 121, 32), (65, 77, 18), (170, 184, 120)
PANEL = (48, 118, 552, 494)  # x0, y0, x1, y1
EYE = (48, 24, 9)  # cols, rows, cell -> 432 x 216
EYE_XY = (84, 136)
OUTS = [ROOT / "landing" / "img", ROOT / "web" / "public" / "img"]


def ease(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def olive(im: Image.Image, gain: float = 1.0) -> Image.Image:
    """Luminance mapped onto dark olive: the neon is gone."""
    a = np.asarray(im.convert("L"), dtype=np.float64)[..., None] / 255 * gain
    tint = np.array([120, 138, 58], dtype=np.float64)
    return Image.fromarray(np.clip(a * tint, 0, 255).astype(np.uint8), "RGB")


def dim(im: Image.Image, k: float) -> Image.Image:
    return Image.fromarray((np.asarray(im, dtype=np.float64) * k).astype(np.uint8), "RGB")


def lid(eye: Image.Image, openness: float) -> Image.Image:
    """Show only a horizontal band around the middle: 0 = closed (a line), 1 = open."""
    w, h = eye.size
    band = max(EYE[2], int(h * openness / 2 / EYE[2]) * EYE[2])
    out = Image.new("RGB", (w, h), BLACK)
    out.paste(eye.crop((0, h // 2 - band, w, h // 2 + band)), (0, h // 2 - band))
    return out


def clip(kind: str, faces: list[str]) -> list[Image.Image]:
    rng = random.Random(4663 if kind == "in" else 5555)
    cache: dict[int, Image.Image] = {}
    face = lambda k: cache.setdefault(k, face_image(faces[k], TILE))  # noqa: E731
    pool = list(range(len(faces)))
    rng.shuffle(pool)
    grid = [pool[i] for i in range(COLS * COLS)]
    arrive = list(range(COLS * COLS))
    rng.shuffle(arrive)
    arrive_at = {cell: i * 20 // len(arrive) for i, cell in enumerate(arrive)}  # every tile in by frame 20
    gaze = gaze_path(N, 7)
    frames = []
    flashes: dict[int, int] = {}
    for f in range(N):
        if f > 24:  # the mosaic keeps living: two tiles change per frame, lit for one frame first
            for _ in range(2 if kind == "in" else 1):
                c = rng.randrange(COLS * COLS)
                flashes[c] = f
                grid[c] = rng.choice(pool)
        if kind == "in":
            bright = 0.3 + 0.7 * ease((f - 40) / 10)
        else:
            bright = 0.55
        im = Image.new("RGB", (S, S), BLACK)
        for c in range(COLS * COLS):
            if f < arrive_at[c]:
                continue
            x, y = (c % COLS) * TILE, (c // COLS) * TILE
            if flashes.get(c) == f or f == arrive_at[c]:
                im.paste(NEON if kind == "in" else OLIVE, (x, y, x + TILE, y + TILE))
            else:
                tile = face(grid[c])
                im.paste(dim(tile, bright) if kind == "in" else olive(tile, bright), (x, y))
        if f < 12:
            frames.append(im)
            continue
        d = ImageDraw.Draw(im)
        if kind == "in":
            edge, width = (ICE if f == 44 else NEON), (9 if 44 <= f <= 46 else 5)
        else:
            edge, width = OLIVE_DARK, 3
        d.rectangle(PANEL, fill=BLACK, outline=edge, width=width)
        gx, gy = gaze[f]
        if kind == "in":
            openness = ease((f - 16) / 24)
        else:  # half opens, looks away, closes
            openness = 0.6 * ease((f - 16) / 20) * (1 - ease((f - 62) / 14))
            gx, gy = (-0.85 * ease((f - 40) / 12), 0.2 * ease((f - 40) / 12))
        eye = eye_image(*EYE, gx, gy, f * 0.1)
        if kind == "out":
            eye = olive(eye, 0.9)
        im.paste(lid(eye, openness), EYE_XY)
        if kind == "in":
            head = "YOU'RE IN"
            shown = head[: max(0, (f - 46) // 2)]
            if shown:
                draw_text(im, shown, (S - text_width(head, 8)) // 2, 372, 8, NEON)
            if f >= 64:
                draw_text(im, "ON THE LIST", S // 2, 446, 3, ICE, anchor="center")
        else:
            head = "NOT ON THE LIST"
            if f >= 70:
                draw_text(im, head, S // 2, 390, 5, OLIVE_TEXT, anchor="center")
            if f in (30, 31, 55, 83):  # a bad signal: rows slip sideways
                a = np.asarray(im).copy()
                y0 = rng.randrange(PANEL[1], PANEL[3] - 40)
                a[y0 : y0 + 24] = np.roll(a[y0 : y0 + 24], rng.choice([-18, 14]), axis=1)
                im = Image.fromarray(a, "RGB")
        frames.append(im)
    return frames


def encode(frames: list[Image.Image], name: str) -> None:
    tmp = Path(tempfile.mkdtemp())
    try:
        for i, fr in enumerate(frames):
            fr.save(tmp / f"{i:03d}.png")
        mp4 = tmp / f"{name}.mp4"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(FPS), "-i", str(tmp / "%03d.png"),
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "26", "-preset", "slow",
                        "-movflags", "+faststart", "-an", str(mp4)], check=True)
        for out in OUTS:
            out.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(mp4, out / f"{name}.mp4")
            frames[-1].save(out / f"{name}.png", optimize=True)
            print(f"{(out / f'{name}.mp4').relative_to(ROOT)}  {(out / f'{name}.mp4').stat().st_size / 1024:.0f} KB")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> None:
    gallery = json.loads((ROOT / "web" / "public" / "data" / "gallery.json").read_text())
    faces = [f["record"] for f in gallery["faces"]]
    encode(clip("in", faces), "list-in")
    encode(clip("out", faces), "list-out")


if __name__ == "__main__":
    main()
