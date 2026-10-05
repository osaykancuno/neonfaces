"""
Brand assets for NEONFACES, drawn from the same pixel records that live on-chain.

    python export_brand.py

-> ../web/public/  favicon.svg, favicon.ico (16/32/48), apple-touch-icon.png, icon-192.png, icon-512.png,
                   og.png (1200x630 link preview)
-> ../brand/       logo.gif + logo.png (512x512, the eye that never blinks), banner.gif (1500x500, faces of the
                   collection around the eye) + banner.png (its first frame, for headers that don't animate, e.g. X);
                   the banners are copied to ../landing/img for the preview page

Faces come from web/public/data/gallery.json (written by export_site.py), so no generated images are needed.
"""
from __future__ import annotations

import json
import random
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

from neonfaces.onchain import decode_record, palettes_hex
from neonfaces.pixelfont import draw_centered

ROOT = Path(__file__).parent
WEB = ROOT.parent / "web" / "public"
BRAND = ROOT.parent / "brand"

BLACK = (0, 0, 0)
NEON = (204, 255, 0)
ICE = (242, 255, 200)
DIM = (138, 154, 90)
# the site's eye palette (web/src/effects/eye.js)
EYE_PAL = [(0, 0, 0), (31, 37, 4), (65, 77, 18), (103, 121, 32), (148, 178, 29), (204, 255, 0), (242, 255, 200)]
BAYER = np.array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]).reshape(4, 4) / 16 - 0.47

# 16x16 mark: the logo's eye (neon almond, olive shading, black pupil, ice glint) on black, simplified to read
# at favicon size. B black, N neon, O olive, D dark olive, K pupil, I glint
MARK = [
    "BBBBBBBBBBBBBBBB",
    "BBBBBBBBBBBBBBBB",
    "BBBBBBBBBBBBBBBB",
    "BBBBBNNNNNNBBBBB",
    "BBBNNOOOOOONNBBB",
    "BBNOOODKKDOOONBB",
    "BNOOODKKKKDOOONB",
    "NOOODKIIKKKDOOON",
    "NOOODKIKKKKDOOON",
    "BNOOODKKKKDOOONB",
    "BBNOOODKKDOOONBB",
    "BBBNNOOOOOONNBBB",
    "BBBBBNNNNNNBBBBB",
    "BBBBBBBBBBBBBBBB",
    "BBBBBBBBBBBBBBBB",
    "BBBBBBBBBBBBBBBB",
]
MARK_COLORS = {"B": BLACK, "N": NEON, "O": (148, 178, 29), "D": (65, 77, 18), "K": BLACK, "I": ICE}


# ----------------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------------
def mark_image(scale: int, pad: int = 0) -> Image.Image:
    n = 16 * scale + 2 * pad
    im = Image.new("RGB", (n, n), BLACK)
    d = ImageDraw.Draw(im)
    for y, row in enumerate(MARK):
        for x, ch in enumerate(row):
            if ch != "B":
                d.rectangle([pad + x * scale, pad + y * scale, pad + (x + 1) * scale - 1, pad + (y + 1) * scale - 1], fill=MARK_COLORS[ch])
    return im


def mark_svg() -> str:
    hexes = {k: "#%02x%02x%02x" % v for k, v in MARK_COLORS.items()}
    paths = {k: [] for k in "NODKI"}
    for y, row in enumerate(MARK):
        x = 0
        while x < 16:
            ch = row[x]
            n = 1
            while x + n < 16 and row[x + n] == ch:
                n += 1
            if ch != "B":
                paths[ch].append(f"M{x} {y}h{n}v1h-{n}z")
            x += n
    body = "".join(f'<path fill="{hexes[k]}" d="{"".join(p)}"/>' for k, p in paths.items() if p)
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">'
        f'<rect width="16" height="16" fill="{hexes["B"]}"/>{body}</svg>\n'
    )


def face_image(rec_hex: str, size: int) -> Image.Image:
    """Flat blocks of an on-chain record (no grain), nearest-neighbour scaled."""
    g, traits, runs = decode_record(bytes.fromhex(rec_hex[2:]))
    pal = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in palettes_hex()[traits["Neon"]]], dtype=np.uint8)
    idx = np.array([c for c, n in runs for _ in range(n)], dtype=np.uint8).reshape(g, g)
    return Image.fromarray(pal[idx], "RGB").resize((size, size), Image.NEAREST)


def eye_lum(u, v, gx, gy, t):
    """numpy port of lum() in web/src/effects/eye.js"""
    L = np.ones_like(u)
    L -= 0.34 * np.exp(-((u + 0.05) ** 2 / 0.5 + (v + 0.05) ** 2 / 0.35))
    L -= 0.25 * np.exp(-((u + 0.95) ** 2 / 0.05 + (v - 0.1) ** 2 / 0.3))
    by = -0.72 - 0.12 * np.sin(np.pi * np.clip((u + 0.9) / 1.8, 0, 1))
    brow = (np.abs(v - by) < 0.13 * (1.2 - (u + 1) * 0.25)) & (u > -0.85) & (u < 0.9)
    L = np.where(brow, L * 0.08, L)
    eh = 0.36
    crease = (np.abs(v - (-eh - 0.16 + 0.1 * u * u)) < 0.05) & (np.abs(u) < 0.75)
    L = np.where(crease, L - 0.25, L)
    w = 0.72
    dx = u / w
    inside = np.abs(dx) < 1
    q = np.clip(1 - dx * dx, 0, None)
    up = -eh * q ** 0.8 - 0.03 * dx
    lo = eh * 0.8 * q ** 0.9 - 0.03 * dx
    almond = inside & (v > up) & (v < lo)
    L = np.where(almond, 0.62 - 0.12 * (1 - np.abs(dx)), L)
    ix, iy, R = gx * w * 0.5, gy * eh * 0.35, 0.42
    r = np.hypot(u - ix, v - iy)
    L = np.where(almond & (r < R), 0.1 + 0.1 * (r / R) + 0.04 * np.sin(t * 2 + r * 30), L)
    L = np.where(almond & (r < R * 0.45), 0.0, L)
    L = np.where(almond & (np.hypot(u - ix + 0.09, v - iy + 0.09) < R * 0.2), 1.0, L)
    L = np.where(inside & (np.abs(v - up) < 0.08) & (v < up + 0.03), 0.0, L)
    L = np.where(inside & (np.abs(v - lo) < 0.03), L * 0.75, L)
    lash = (u > w - 0.05) & (u < w + 0.28) & (np.abs(v - (-0.08 - 0.6 * (u - w))) < 0.06)
    L = np.where(lash, 0.02, L)
    L -= 0.12 * np.exp(-((u + 0.05) ** 2 / 0.3 + (v - 0.62) ** 2 / 0.02))
    L += np.sin(u * 37.1 + v * 21.7) * 0.03
    return L


def eye_image(cols: int, rows: int, cell: int, gx: float, gy: float, t: float) -> Image.Image:
    """The site's eye as a block image; the dithered vignette fades to black."""
    j, i = np.mgrid[0:rows, 0:cols]
    u = ((i + 0.5) / cols) * 2 - 1
    v = ((j + 0.5) / rows) * 2 - 1
    L = eye_lum(u * 1.25, v * 1.25, gx, gy, t)
    d = BAYER[j % 4, i % 4]
    edge = np.minimum(1, (1 - np.hypot(u * 0.92, v * 0.98)) * 3.4)
    k = np.clip(np.round(np.clip(L, 0, 1) * 5 + d * 0.7), 0, 6).astype(int)
    k = np.where(L >= 0.99, 6, np.minimum(k, 5))
    k = np.where(edge + d * 0.9 < 0.5, 0, k)
    rgb = np.array(EYE_PAL, dtype=np.uint8)[k]
    return Image.fromarray(rgb, "RGB").resize((cols * cell, rows * cell), Image.NEAREST)


def gaze_path(n: int, seed: int) -> list[tuple[float, float]]:
    """A looping stare: glances between fixed points, micro-saccades, never a blink."""
    keys = [(0.0, 0.0), (-0.85, 0.15), (-0.85, 0.15), (0.9, -0.2), (0.9, -0.2), (0.15, 0.55), (0.0, 0.0)]
    rng = random.Random(seed)
    out = []
    for f in range(n):
        p = f / n * (len(keys) - 1)
        a, b = keys[int(p)], keys[min(int(p) + 1, len(keys) - 1)]
        e = p - int(p)
        e = e * e * (3 - 2 * e)  # ease in-out
        out.append((a[0] + (b[0] - a[0]) * e + rng.uniform(-0.06, 0.06), a[1] + (b[1] - a[1]) * e + rng.uniform(-0.04, 0.04)))
    return out


def save_gif(frames: list[Image.Image], path: Path, ms: int) -> None:
    # one shared palette keeps pixel colors exact across frames
    sheet = Image.new("RGB", (frames[0].width, frames[0].height * len(frames)))
    for n, f in enumerate(frames):
        sheet.paste(f, (0, n * frames[0].height))
    pal = sheet.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
    q[0].save(path, save_all=True, append_images=q[1:], duration=ms, loop=0, optimize=True, disposal=1)


# ----------------------------------------------------------------------------
# assets
# ----------------------------------------------------------------------------
def icons() -> None:
    (WEB / "favicon.svg").write_text(mark_svg(), encoding="utf-8")
    ico = [mark_image(1), mark_image(2), mark_image(3)]
    ico[2].save(WEB / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)], append_images=ico[:2])
    mark_image(10, 10).save(WEB / "apple-touch-icon.png", optimize=True)  # 180
    mark_image(11, 8).save(WEB / "icon-192.png", optimize=True)
    mark_image(25, 56).save(WEB / "icon-512.png", optimize=True)  # safe zone for maskable icons
    old = WEB / "favicon.png"
    if old.exists():
        old.unlink()
    landing = ROOT.parent / "landing"  # the preview uses the same icons
    for name in ("favicon.svg", "favicon.ico", "apple-touch-icon.png", "icon-192.png", "icon-512.png"):
        (landing / name).write_bytes((WEB / name).read_bytes())


def set_face(set_id: int, size: int, cells: int = 48) -> Image.Image:
    """A whole set's Face (its four pieces as one face, art/output/images, drawn from the on-chain records) on black,
    at a whole number of pixels per cell so every cell stays square and sharp."""
    face = Image.open(ROOT / "output" / "images" / f"set-{set_id}.png").convert("RGB").resize((cells, cells), Image.NEAREST)
    k = size // cells
    out = Image.new("RGB", (size, size), BLACK)
    out.paste(face.resize((cells * k, cells * k), Image.NEAREST), ((size - cells * k) // 2, (size - cells * k) // 2))
    return out


def og_card(faces: list[str], hero) -> None:
    """The link preview (29 Sep): NEONCAM's lit page. Neon field with its dot grid, black type, one face in a black
    frame with the site's offset shadow, and the NEONCAM photo's black band along the bottom. Since 5 Oct the face is
    set #419's: the face of the collection (the founder)."""
    W, H = 1200, 630
    og = Image.new("RGB", (W, H), NEON)
    d = ImageDraw.Draw(og)
    for y in range(11, H, 22):  # the lit page's dots (html.neoncam on wide screens)
        for x in range(11, W, 22):
            d.rectangle([x, y, x + 1, y + 1], fill=(170, 212, 0))
    x0, y0, S = 70, 60, 450
    d.rectangle([x0 + 14, y0 + 14, x0 + S + 14 + 16, y0 + S + 14 + 16], fill=BLACK)  # the offset shadow
    d.rectangle([x0, y0, x0 + S + 16, y0 + S + 16], fill=BLACK)
    og.paste(hero.resize((S, S), Image.NEAREST if hero.width < S else Image.LANCZOS) if isinstance(hero, Image.Image) else face_image(hero, S), (x0 + 8, y0 + 8))
    cx = 870
    draw_centered(d, "NEONFACES", cx, 150, 8, BLACK)
    draw_centered(d, "THEY DON'T BLINK.", cx, 250, 4, BLACK)
    draw_centered(d, "5555 FACES.", cx, 330, 3, (40, 50, 8))
    draw_centered(d, "EVERY ONE IS AN ACCOUNT.", cx, 365, 3, (40, 50, 8))
    draw_centered(d, "FULLY ON-CHAIN. ROBINHOOD CHAIN.", cx, 420, 2, (61, 74, 12))
    d.rectangle([0, H - 62, W, H], fill=BLACK)  # the NEONCAM photo's band
    d.rectangle([0, H - 66, W, H - 63], fill=BLACK)
    from neonfaces.pixelfont import draw_text, text_width
    draw_text(d, "NEONFACES", 40, H - 45, 4, NEON)
    draw_text(d, "NEONFACES.XYZ", W - 40 - text_width("NEONFACES.XYZ", 3), H - 41, 3, (201, 212, 163))
    og.save(WEB / "og.png", optimize=True)  # the web app only: landing/ is retired (1 Oct)


def logo_gif() -> None:
    S, n = 512, 48
    frames = []
    for f, (gx, gy) in enumerate(gaze_path(n, 5555)):
        im = Image.new("RGB", (S, S), BLACK)
        im.paste(eye_image(48, 24, 10, gx, gy, f * 0.08), (16, 92))
        d = ImageDraw.Draw(im)
        draw_centered(d, "NEONFACES", S // 2, 352, 6, NEON)
        draw_centered(d, "THEY DON'T BLINK.", S // 2, 414, 2, ICE)
        frames.append(im)
    frames[0].save(BRAND / "logo.png", optimize=True)
    save_gif(frames, BRAND / "logo.gif", 70)


def banner_gif(faces: list[str]) -> None:
    W, H, tile, n = 1500, 500, 125, 40
    cols, rows = W // tile, H // tile
    rng = random.Random(4663)
    order = list(range(len(faces)))
    rng.shuffle(order)
    grid = [[order[r * cols + c] for c in range(cols)] for r in range(rows)]  # no face twice at start
    cache: dict[int, Image.Image] = {}
    face = lambda k: cache.setdefault(k, face_image(faces[k], tile))  # noqa: E731
    panel = (310, 115, 1190, 385)  # stays clear of the profile photo and the header crop on phones
    tx = 900  # center of the text column
    gaze = gaze_path(n, 4663)
    flashes: dict[tuple[int, int], int] = {}
    frames = []
    for f in range(n):
        if f > 0:  # swap two tiles per frame, each lit neon for one frame first (like the site's mosaic)
            for _ in range(2):
                c, r = rng.randrange(cols), rng.randrange(rows)
                shown = {k for row in grid for k in row}
                flashes[(c, r)] = f
                grid[r][c] = rng.choice([k for k in order if k not in shown])
        im = Image.new("RGB", (W, H), BLACK)
        d = ImageDraw.Draw(im)
        for r in range(rows):
            for c in range(cols):
                x, y = c * tile, r * tile
                if flashes.get((c, r)) == f:
                    d.rectangle([x, y, x + tile - 1, y + tile - 1], fill=NEON)
                else:
                    im.paste(face(grid[r][c]), (x, y))
        d.rectangle(panel, fill=BLACK, outline=NEON, width=5)
        im.paste(eye_image(40, 20, 7, *gaze[f], f * 0.1), (panel[0] + 20, panel[1] + 65))
        draw_centered(d, "NEONFACES", tx, 160, 9, NEON)
        draw_centered(d, "THEY DON'T BLINK.", tx, 250, 3, ICE)
        draw_centered(d, "5555 FACES. EVERY ONE IS AN ACCOUNT.", tx, 300, 2, DIM)
        draw_centered(d, "ROBINHOOD CHAIN", tx, 330, 2, DIM)
        frames.append(im)
    frames[0].save(BRAND / "banner.png", optimize=True)
    save_gif(frames, BRAND / "banner.gif", 110)
    # the preview page shows the same banner
    landing = ROOT.parent / "landing" / "img"
    for name in ("banner.png", "banner.gif"):
        (landing / name).write_bytes((BRAND / name).read_bytes())


# the link preview's face (the founder, 5 Oct): set #419's Face, the face of the collection
OG_PORTRAIT = lambda: set_face(419, 450)  # noqa: E731


def main() -> None:
    BRAND.mkdir(exist_ok=True)
    gallery = json.loads((WEB / "data" / "gallery.json").read_text())
    faces = [f["record"] for f in gallery["faces"]]
    icons()
    og_card(faces, OG_PORTRAIT())
    logo_gif()
    banner_gif(faces)
    for p in sorted([*WEB.glob("favicon.*"), *WEB.glob("*icon*.png"), WEB / "og.png", *BRAND.iterdir()]):
        print(f"{p.relative_to(ROOT.parent)}  {p.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    import sys

    if "--og" in sys.argv:  # only the link preview
        og_card([], OG_PORTRAIT())
        print("web/public/og.png")
    else:
        main()
