"""Start and end frames for the two 4-second "what's inside" clips (Seedance 2.0 Mini on Higgsfield).

    python marketing/inside/make_frames.py    (repo root)

a-inside-start.png  set #518's face (the brightest of the site's faces: a clip must not open dark, see the
                    virality notes in marketing/teasers/PROMPTS.md), nearest-neighbour, centred on black (1280x720)
a-inside-end.png    inside the eye: a dark pupil ring and the kinds of things a Face's basket holds, drawn as pixel
                    icons in the collection's palette (rising chart bars for the stocks, a gold bar, a silver bar, a
                    coin for bitcoin), no text, no numbers, no logos
b-human-start.png   the trailer's opening face (set #124, marketing/trailer/hero-start.png): the face Veo carried
                    toward a real person in the trailer's first take, the look the user liked
"""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
IMG = ROOT / "landing" / "img"
W, H = 1280, 720
INK, NEON, DIM, PALE = (0, 0, 0), (204, 255, 0), (103, 121, 32), (242, 255, 200)
DEEP = (40, 48, 10)
CELL = 16  # one pixel of the icons on screen


def centred(name: str) -> Image.Image:
    f = Image.new("RGB", (W, H), INK)
    face = Image.open(IMG / name).convert("RGB").resize((720, 720), Image.NEAREST)
    f.paste(face, ((W - 720) // 2, 0))
    return f


def cells(d: ImageDraw.ImageDraw, x0: int, y0: int, rows: list[str], colours: dict[str, tuple]):
    """Draw a small bitmap: one character per cell, '.' is transparent."""
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch != ".":
                x, y = x0 + c * CELL, y0 + r * CELL
                d.rectangle([x, y, x + CELL - 1, y + CELL - 1], fill=colours[ch])


def inside() -> Image.Image:
    f = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(f)
    # the pupil's edge: a stepped olive ring, as if we were looking out from inside the eye
    cx, cy, r = W // 2, H // 2, 420
    for gy in range(0, H, CELL):
        for gx in range(0, W, CELL):
            dist = ((gx + CELL / 2 - cx) ** 2 + (gy + CELL / 2 - cy) ** 2) ** 0.5
            if dist > r + 60:
                d.rectangle([gx, gy, gx + CELL - 1, gy + CELL - 1], fill=DIM)
            elif dist > r:
                d.rectangle([gx, gy, gx + CELL - 1, gy + CELL - 1], fill=DEEP)
    col = {"n": NEON, "d": DIM, "p": PALE, "k": DEEP}
    chart = [  # rising bars: the stocks
        "..........nn",
        "..........nn",
        ".......nn.nn",
        ".......nn.nn",
        "....nn.nn.nn",
        "....nn.nn.nn",
        ".nn.nn.nn.nn",
        ".nn.nn.nn.nn",
        "dddddddddddd",
    ]
    gold = [  # an ingot
        "..nnnnnnnn..",
        ".nppnnnnnnd.",
        "nnnnnnnnnndd",
        "dddddddddddd",
    ]
    silver = [
        "..pppppppp..",
        ".ppppppppdd.",
        "ppppppppppdd",
        "dddddddddddd",
    ]
    coin = [  # a plain coin, no symbol
        "...nnnn...",
        ".nnddddnn.",
        ".ndnnnndn.",
        "ndnnnnnndn",
        "ndnnnnnndn",
        "ndnnnnnndn",
        ".ndnnnndn.",
        ".nnddddnn.",
        "...nnnn...",
    ]
    # an asymmetric cluster (not two "eyes" and a "mouth": no mascot face)
    cells(d, 360, 300, chart, col)
    cells(d, 740, 150, coin, col)
    cells(d, 620, 452, gold, col)
    cells(d, 652, 388, silver, col)
    # a few loose neon cells drifting, like dust in the light
    for x, y in [(560, 140), (880, 360), (340, 380), (600, 600), (860, 560), (470, 250)]:
        d.rectangle([x, y, x + CELL - 1, y + CELL - 1], fill=DIM)
    return f


if __name__ == "__main__":
    centred("set-518.png").save(HERE / "a-inside-start.png")
    inside().save(HERE / "a-inside-end.png")
    Image.open(ROOT / "marketing" / "trailer" / "hero-start.png").convert("RGB").save(HERE / "b-human-start.png")
    print("frames written to", HERE)
