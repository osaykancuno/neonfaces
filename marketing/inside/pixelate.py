"""Pixelate a generated clip the way the collection is made: square cells on the start frame's grid, luminance
mapped to the six neon tones of art/neonfaces/render.py. Keeps the clip's audio.

    python marketing/inside/pixelate.py raw/b-human.mp4 b-human.mp4 [--cell 12] [--ox 4] [--oy 0]

Seedance turned clip B's pixel face into a smooth, natural-colour person; this brings it back to the collection's
look (a real person, always pixelated) without spending credits. --ox/--oy align the grid with the start frame
(hero-start.png has 12 px cells starting at x = 4).
"""
import subprocess
import sys
from pathlib import Path
import numpy as np

HERE = Path(__file__).resolve().parent
TONES = np.array([(0, 0, 0), (31, 37, 4), (65, 77, 18), (103, 121, 32), (148, 178, 29), (204, 255, 0)], np.uint8)
W, H = 1280, 720


def arg(name, default):
    return int(sys.argv[sys.argv.index(name) + 1]) if name in sys.argv else default


def main():
    src, dst = HERE / sys.argv[1], HERE / sys.argv[2]
    cell, ox, oy = arg("--cell", 12), arg("--ox", 4), arg("--oy", 0)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
                         capture_output=True, check=True).stdout
    frames = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
    lum = frames.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
    # one set of levels for the whole clip (per-frame levels would pump): the face's range, not the black background
    centre = lum[1:, 60:660, 320:960]
    lo, hi = np.percentile(centre, 20), np.percentile(centre, 80)  # like the art: skin opens into the neon field
    cols, rows = (W - ox) // cell, (H - oy) // cell
    out = np.zeros_like(frames)
    prev = None
    for i, (f, l) in enumerate(zip(frames, lum)):
        if i == 0:
            out[0] = f  # the collection's own face, untouched
            continue
        block = l[oy:oy + rows * cell, ox:ox + cols * cell].reshape(rows, cell, cols, cell).mean(axis=(1, 3))
        prev = block if prev is None else 0.5 * prev + 0.5 * block  # a little temporal calm, less cell flicker
        t = np.clip((prev - lo) / (hi - lo), 0, 1) ** 0.8
        idx = np.rint(t * (len(TONES) - 1)).astype(int)
        img = TONES[idx].repeat(cell, 0).repeat(cell, 1)
        o = np.zeros((H, W, 3), np.uint8)
        o[oy:oy + rows * cell, ox:ox + cols * cell] = img
        out[i] = o
    enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                            "-r", "24", "-i", "-", "-i", str(src), "-map", "0:v", "-map", "1:a", "-c:v", "libx264",
                            "-crf", "14", "-preset", "slow", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
                            "-shortest", str(dst)], stdin=subprocess.PIPE)
    enc.communicate(out.tobytes())
    print(f"{dst.name}: {len(frames)} frames, cell {cell}px, levels {lo:.0f}-{hi:.0f}")


if __name__ == "__main__":
    main()
