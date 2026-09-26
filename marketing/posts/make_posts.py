"""Post images for X, built only from the collection's own art in landing/img.

Pixels stay square: every upscale is nearest-neighbour by a whole factor, and the
text is a 5x7 bitmap font drawn in cells. Run from the repo root:
    python marketing/posts/make_posts.py
"""
import re
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
IMG = ROOT / "landing" / "img"
OUT = Path(__file__).resolve().parent

INK = (0, 0, 0)
NEON = (204, 255, 0)
DIM = (103, 121, 32)
PALE = (242, 255, 200)

FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "G": ["01111", "10000", "10000", "10011", "10001", "10001", "01111"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "J": ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
    "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
    "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "'": ["1", "1", "0", "0", "0", "0", "0"],
    ".": ["0", "0", "0", "0", "0", "0", "1"],
    ",": ["00", "00", "00", "00", "00", "01", "10"],
    ":": ["0", "1", "0", "0", "0", "1", "0"],
    "-": ["000", "000", "000", "111", "000", "000", "000"],
    "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
    ">": ["0001000", "0000100", "0000010", "1111111", "0000010", "0000100", "0001000"],
    " ": ["000"] * 7,
}


def text_width(text, cell):
    return sum((len(FONT[c][0]) + 1) * cell for c in text) - cell


def draw_text(img, text, x, y, cell, color=NEON, anchor="left"):
    """Draw upper-case text; anchor 'left' or 'center' (x is then the centre)."""
    if anchor == "center":
        x -= text_width(text, cell) // 2
    for c in text:
        glyph = FONT[c]
        for gy, row in enumerate(glyph):
            for gx, bit in enumerate(row):
                if bit == "1":
                    img.paste(color, (x + gx * cell, y + gy * cell, x + (gx + 1) * cell, y + (gy + 1) * cell))
        x += (len(glyph[0]) + 1) * cell
    return x


def frame(img, color=NEON, inset=32, width=4):
    w, h = img.size
    for i in range(width):
        box = (inset + i, inset + i, w - inset - 1 - i, h - inset - 1 - i)
        img.paste(color, (box[0], box[1], box[2] + 1, box[1] + 1))
        img.paste(color, (box[0], box[3], box[2] + 1, box[3] + 1))
        img.paste(color, (box[0], box[1], box[0] + 1, box[3] + 1))
        img.paste(color, (box[2], box[1], box[2] + 1, box[3] + 1))


def fit(path, size):
    """Nearest-neighbour resize to a square side that keeps whole cells (callers pick multiples)."""
    return Image.open(path).convert("RGB").resize((size, size), Image.NEAREST)


def gaze(level, size):
    """Rasterise landing/img/gaze-N.svg: 48x48 cells, glow = blur * slope, screen-blended."""
    svg = (IMG / f"gaze-{level}.svg").read_text(encoding="utf-8")
    cells = Image.new("RGB", (48, 48), NEON)
    for fill, d in re.findall(r'<path fill="(#[0-9a-f]{6})" d="([^"]+)"', svg):
        rgb = tuple(int(fill[i:i + 2], 16) for i in (1, 3, 5))
        for x, y, w in re.findall(r"M(\d+) (\d+)h(\d+)v1h-\d+z", d):
            x, y, w = int(x), int(y), int(w)
            cells.paste(rgb, (x, y, x + w, y + 1))
    k = size // 48
    im = cells.resize((48 * k, 48 * k), Image.NEAREST)
    m = re.search(r'stdDeviation="([\d.]+)".*?slope="([\d.]+)"', svg, re.S)
    if m:
        sd, slope = float(m.group(1)), float(m.group(2))
        glow = im.filter(ImageFilter.GaussianBlur(sd * k)).point(lambda v: int(v * slope))
        im = ImageChops.screen(im, glow)
    return im


def footer(img, cell=4):
    w, h = img.size
    draw_text(img, "NEONFACES.XYZ", w // 2, h - 32 - 24 - 7 * cell, cell, DIM, "center")


def stare_tiers():
    img = Image.new("RGB", (1600, 900), INK)
    frame(img)
    draw_text(img, "THEY DON'T SMILE. THEY DON'T POSE.", 800, 92, 6, PALE, "center")
    x = 800 - (3 * 400 + 2 * 40) // 2
    for i, (name, label) in enumerate([("glance", "GLANCE"), ("watch", "WATCH"), ("heavy-stare", "HEAVY STARE")]):
        face = fit(IMG / f"face-{name}-1.png", 400)
        img.paste(face, (x + i * 440, 190))
        draw_text(img, label, x + i * 440 + 200, 612, 4, DIM, "center")
    draw_text(img, "THEY DON'T BLINK.", 800, 680, 10, NEON, "center")
    footer(img)
    img.save(OUT / "1-they-dont-blink.png")


def four_pieces():
    img = Image.new("RGB", (1600, 900), INK)
    frame(img)
    draw_text(img, "FOUR PIECES. ONE FACE.", 800, 90, 9, NEON, "center")
    top, gap = 210, 36
    for i in range(4):
        piece = fit(IMG / f"set-518-{i}.png", 240)
        img.paste(piece, (150 + (i % 2) * (240 + gap), top + (i // 2) * (240 + gap)))
    draw_text(img, ">", 800, top + 240 + gap // 2 - 28, 8, NEON, "center")
    img.paste(fit(IMG / "set-518.png", 516), (928, top))
    draw_text(img, "COLLECT. ASSEMBLE. FUSE, IF YOU CHOOSE.", 800, 756, 4, PALE, "center")
    footer(img)
    img.save(OUT / "2-four-pieces.png")


def patience():
    img = Image.new("RGB", (1600, 900), INK)
    frame(img)
    draw_text(img, "PATIENCE SHOWS IN THE PICTURE.", 800, 96, 7, NEON, "center")
    size, gap = 336, 32
    x = 800 - (4 * size + 3 * gap) // 2
    for level, label in enumerate(["DAY ONE", "STEADY", "FIXED", "BURNING"]):
        img.paste(gaze(level, size), (x + level * (size + gap), 220))
        draw_text(img, label, x + level * (size + gap) + size // 2, 588, 4, DIM if level < 3 else NEON, "center")
    draw_text(img, "A SALE RESETS IT. THE STARE BELONGS TO WHOEVER KEEPS IT.", 800, 690, 3, PALE, "center")
    footer(img)
    img.save(OUT / "3-patience.png")


def on_chain_wall():
    wall = Image.open(ROOT / "marketing" / "teasers" / "2-watching-start.png").convert("RGB")
    img = wall.resize((1600, 900), Image.NEAREST).point(lambda v: int(v * 0.35))
    band_h = 230
    img.paste(INK, (0, 450 - band_h // 2, 1600, 450 + band_h // 2))
    img.paste(NEON, (0, 450 - band_h // 2, 1600, 450 - band_h // 2 + 4))
    img.paste(NEON, (0, 450 + band_h // 2 - 4, 1600, 450 + band_h // 2))
    draw_text(img, "THE ART LIVES ON THE CHAIN.", 800, 380, 8, NEON, "center")
    draw_text(img, "NO SERVER, NO LINK THAT CAN BREAK.", 800, 470, 4, PALE, "center")
    img.save(OUT / "4-on-chain.png")


def neoncam():
    img = Image.new("RGB", (1200, 1200), INK)
    frame(img)
    draw_text(img, "NEONCAM", 600, 100, 10, NEON, "center")
    img.paste(fit(IMG / "set-337.png", 720), (240, 220))
    draw_text(img, "SEE YOURSELF THE WAY THEY SEE YOU.", 600, 972, 4, PALE, "center")
    draw_text(img, "YOUR CAMERA, THROUGH THE SAME PIPELINE.", 600, 1022, 3, DIM, "center")
    footer(img)
    img.save(OUT / "5-neoncam.png")


if __name__ == "__main__":
    stare_tiers()
    four_pieces()
    patience()
    on_chain_wall()
    neoncam()
    print("written to", OUT)
