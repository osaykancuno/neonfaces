"""Images for the OpenSea collection page and the drop page in Studio, from the collection's own art.

Sizes follow OpenSea's creator FAQ (checked 28 Sep 2026): drop page header 8:3 (16:9 on phones), banner logo
1:1 240 px, section media 16:9 above 2560 x 1440, pre-reveal image 1:1 about 1000 px. Pixels stay square: faces and
the eye are drawn in whole cells, section images are the post images doubled by nearest neighbour.
Run from the repo root (after art/generate.py and art/export_site.py, which the brand images need):
    python marketing/opensea/make_opensea.py
"""
import json
import random
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
sys.path[:0] = [str(ROOT / "art"), str(ROOT / "marketing" / "posts")]

from export_brand import BLACK, DIM, ICE, NEON, eye_image, face_image  # noqa: E402
from neonfaces.pixelfont import draw_centered  # noqa: E402
import make_posts as posts  # noqa: E402

# glyphs the post font lacks (5x7, same style)
posts.FONT.update({
    "$": ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
    "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
    "0": ["01110", "10011", "10101", "10101", "10101", "11001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
})


def faces():
    gallery = json.loads((ROOT / "web" / "public" / "data" / "gallery.json").read_text())
    return [f["record"] for f in gallery["faces"]]


def logo(size, cell):
    """The site's eye, alone and centred with room around it (OpenSea crops profile images to a circle)."""
    im = Image.new("RGB", (size, size), BLACK)
    eye = eye_image(48, 24, cell, 0.0, 0.0, 0.0)
    im.paste(eye, ((size - eye.width) // 2, (size - eye.height) // 2))
    return im


def header(recs, w, h, tile, panel=True):
    """A wall of the collection's faces; with `panel`, the eye and the name in a black box in the middle."""
    rng = random.Random(4663 + w)
    order = list(range(len(recs)))
    rng.shuffle(order)
    im = Image.new("RGB", (w, h), BLACK)
    k = 0
    for y in range(0, h, tile):
        for x in range(0, w, tile):
            im.paste(face_image(recs[order[k % len(order)]], tile), (x, y))
            k += 1
    if not panel:
        return im
    s = w / 1500  # the brand banner's layout, scaled to this width
    pw, ph = int(880 * s), int(270 * s)
    x0, y0 = (w - pw) // 2, (h - ph) // 2
    d = ImageDraw.Draw(im)
    d.rectangle([x0, y0, x0 + pw, y0 + ph], fill=BLACK, outline=NEON, width=max(4, int(5 * s)))
    cell = max(4, round(7 * s))
    eye = eye_image(40, 20, cell, 0.0, 0.0, 0.0)
    im.paste(eye, (x0 + int(20 * s), y0 + (ph - eye.height) // 2))
    tx = x0 + int(590 * s)
    t = lambda v: max(1, round(v * s))  # noqa: E731
    draw_centered(d, "NEONFACES", tx, y0 + int(45 * s), t(9), NEON)
    draw_centered(d, "THEY DON'T BLINK.", tx, y0 + int(135 * s), t(3), ICE)
    draw_centered(d, "5555 FACES. EVERY ONE IS AN ACCOUNT.", tx, y0 + int(185 * s), t(2), DIM)
    draw_centered(d, "ROBINHOOD CHAIN", tx, y0 + int(215 * s), t(2), DIM)
    return im


def wallet_post():
    """A Face and what it holds, in the post images' style (1600 x 900)."""
    img = Image.new("RGB", (1600, 900), posts.INK)
    posts.frame(img)
    posts.draw_text(img, "EVERY FACE IS A WALLET.", 800, 90, 9, posts.NEON, "center")
    img.paste(posts.fit(ROOT / "landing" / "img" / "face-watch-1.png", 480), (140, 200))
    x, y = 700, 214
    posts.draw_text(img, "THE NFT IS THE KEY.", x, y, 5, posts.PALE)
    rows = [("BASE BASKET", "ABOUT $5"), ("WATCH", "+ ABOUT $14"), ("HEAVY STARE", "+ ABOUT $70"), ("SET BONUS, ONCE", "ABOUT $12")]
    for i, (a, b) in enumerate(rows):
        posts.draw_text(img, a, x, y + 90 + i * 58, 4, posts.DIM)
        posts.draw_text(img, b, x + 440, y + 90 + i * 58, 4, posts.NEON)
    posts.draw_text(img, "ADD TO IT, WITHDRAW IT, OR LEAVE IT.", x, y + 350, 4, posts.PALE)
    posts.draw_text(img, "IT GOES WHERE THE FACE GOES.", x, y + 400, 4, posts.PALE)
    posts.footer(img)
    return img


def double(im):
    return im.resize((im.width * 2, im.height * 2), Image.NEAREST)


def main():
    recs = faces()
    out = {
        "logo-1000.png": logo(1000, 16),
        "logo-240.png": logo(240, 4),
        "header-desktop.png": header(recs, 2400, 900, 150),
        "header-mobile.png": header(recs, 1920, 1080, 120),
        "header-desktop-plain.png": header(recs, 2400, 900, 150, panel=False),
        "section-1-on-chain.png": double(Image.open(ROOT / "marketing" / "posts" / "4-on-chain.png").convert("RGB")),
        "section-2-wallet.png": double(wallet_post()),
        "section-3-tiers.png": double(Image.open(ROOT / "marketing" / "posts" / "1-they-dont-blink.png").convert("RGB")),
        "section-4-sets.png": double(Image.open(ROOT / "marketing" / "posts" / "2-four-pieces.png").convert("RGB")),
        "section-5-gaze.png": double(Image.open(ROOT / "marketing" / "posts" / "3-patience.png").convert("RGB")),
    }
    unrevealed = ROOT / "art" / "output" / "unrevealed.png"  # the on-chain pre-reveal art, drawn by art/generate.py
    if unrevealed.exists():
        out["prereveal-1200.png"] = Image.open(unrevealed).convert("RGB")
    for name, im in out.items():
        im.save(OUT / name, optimize=True)
        print(f"{name}  {im.width}x{im.height}  {(OUT / name).stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
