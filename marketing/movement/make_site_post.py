"""Plan B's still (1 Oct): if the mint moves to neonfaces.xyz, the post that says so. Her Face (#419, the young woman
of the eye) in neon, on the dim wall of the collection, and where to mint. 4:5 for X.

    python marketing/movement/make_site_post.py     # -> out/l-site-mint-4x5.png (with today's time), out/l-site-mint-any-4x5.png
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import make_launch as ml  # noqa: E402
from make_cut import H, NEON, PALE, W, draw_text  # noqa: E402

TOP, H45 = 285, 1350  # the 4:5 crop of the 1080 x 1920 frame, a little higher than the videos' (the face sits high)


def still(lines, out):
    bg = Image.fromarray(ml.wall_bg(19, dim=0.13))
    d = ImageDraw.Draw(bg)
    for k in range(6):
        d.rectangle([60 + k, TOP + 60 + k, W - 61 - k, TOP + H45 - 61 - k], outline=NEON)
    size = 540
    bg.paste(ml.art_img(419, size), ((W - size) // 2, TOP + 150))
    y = TOP + 150 + size + 70
    for text, cell, col in lines:
        if text:
            draw_text(bg, text, W // 2, y, cell, col, "center")
        y += 11 * cell
    im = bg.crop((0, TOP, W, TOP + H45))
    im.save(HERE / "out" / out)
    print(f"out/{out}")


def banner(out, bw=2800, bh=800):
    """OpenSea's collection banner while the page can't sell (it shows 0 available): where the mint really is. 4:1 at
    twice OpenSea's 1400 x 350, everything inside the middle half so the phone crop keeps it."""
    rng = ml.random.Random(23)
    tile = 200
    im = Image.new("RGB", (bw, bh), (0, 0, 0))
    for y in range(0, bh, tile):
        for x in range(0, bw, tile):
            im.paste(ml.art_img(rng.randrange(5555), tile), (x, y))
    im = Image.fromarray((np.asarray(im).astype(np.float32) * 0.12).astype(np.uint8))
    d = ImageDraw.Draw(im)
    cx = bw // 2
    for k in range(5):
        d.rectangle([cx - 760 + k, 150 + k, cx + 760 - k, bh - 150 - k], outline=NEON)
    draw_text(im, "THE MINT IS ON", cx, 215, 8, PALE, "center")
    draw_text(im, "NEONFACES.XYZ", cx, 320, 13, NEON, "center")
    draw_text(im, "SAME LIST. SAME TERMS. THROUGH OPENSEA'S SEADROP.", cx, 500, 4, PALE, "center")
    im.save(HERE / "out" / out, optimize=True)
    print(f"out/{out} {bw}x{bh}")


if __name__ == "__main__":
    banner("opensea-banner-site.png")
    still([("THE MINT IS ON", 7, PALE), ("NEONFACES.XYZ", 11, NEON), ("", 3, PALE), ("TODAY 18:00 UTC", 7, NEON),
           ("SAME TERMS. CONNECT YOUR WALLET.", 5, PALE)], "l-site-mint-4x5.png")
    still([("THE MINT IS ON", 7, PALE), ("NEONFACES.XYZ", 11, NEON), ("", 3, PALE),
           ("CONNECT YOUR WALLET THERE.", 5, PALE)], "l-site-mint-any-4x5.png")
