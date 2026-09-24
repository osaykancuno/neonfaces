"""
Export website assets from the generated collection.

    python export_site.py            # -> ../web/public/{faces,data}, og.png, favicon.png, unrevealed.png

- data/gallery.json   120 on-chain records (hex) covering every crop / tier / anomaly + the placeholder;
                      the site renders them with the JS port of NeonRenderer (byte-identical SVG)
- data/rarity.json    exact counts per trait value (the published rarity table)
- og.png              1200x630 social card, favicon.png 64px pixel eye
"""
from __future__ import annotations

import json
import random
import shutil
from collections import Counter, defaultdict
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).parent
OUT = ROOT / "output"
WEB = ROOT.parent / "web" / "public"


def trait(a, k):
    return next(x["value"] for x in a["attributes"] if x["trait_type"] == k)


def main():
    art = json.loads((OUT / "art.json").read_text())
    rng = random.Random(4663)

    # --- pick a diverse preview set -------------------------------------------------
    picked: list[int] = []
    by = defaultdict(list)
    for a in art:
        by[("Anomaly", trait(a, "Anomaly"))].append(a["artId"])
        by[("Crop", trait(a, "Crop"))].append(a["artId"])
        by[("Stare", trait(a, "Stare"))].append(a["artId"])
        by[("Accessory", trait(a, "Accessory"))].append(a["artId"])
    for key in sorted(by):
        for aid in rng.sample(by[key], min(3, len(by[key]))):
            if aid not in picked:
                picked.append(aid)
    pool = [a["artId"] for a in art if a["artId"] not in picked]
    picked += rng.sample(pool, 120 - len(picked))
    rng.shuffle(picked)

    # the site draws Faces from the same bytes that live on-chain (no image files)
    faces_dir = WEB / "faces"
    if faces_dir.exists():
        shutil.rmtree(faces_dir)
    chunks = [bytes.fromhex(c[2:]) for c in json.loads((OUT / "onchain" / "chunks.json").read_text())]

    def record(aid):
        c = chunks[aid // 32]
        i = aid % 32
        n = int.from_bytes(c[0:2], "big") // 2
        start = int.from_bytes(c[2 * i:2 * i + 2], "big")
        end = int.from_bytes(c[2 * i + 2:2 * i + 4], "big") if i + 1 < n else len(c)
        return "0x" + c[start:end].hex()

    gallery = [{"artId": aid, "stare": trait(art[aid], "Stare"), "record": record(aid)} for aid in picked]
    (WEB / "data").mkdir(parents=True, exist_ok=True)
    (WEB / "data" / "gallery.json").write_text(json.dumps({
        "placeholder": (OUT / "onchain" / "placeholder.hex").read_text().strip(),
        "faces": gallery,
    }))

    # --- rarity table ---------------------------------------------------------------
    order = [x["trait_type"] for x in art[0]["attributes"]]
    rarity = []
    for k in order:
        c = Counter(trait(a, k) for a in art)
        rarity.append({"trait": k, "values": [{"value": v, "count": n} for v, n in c.most_common()]})
    (WEB / "data" / "rarity.json").write_text(json.dumps({"total": len(art), "traits": rarity}))

    # --- social card: mosaic + title block -------------------------------------------
    og = Image.new("RGB", (1200, 630), (0, 0, 0))
    tile = 105
    k = 0
    for y in range(0, 630, tile):
        for x in range(0, 1200, tile):
            im = Image.open(OUT / "images" / f"{picked[k % len(picked)]}.png").convert("RGB").resize((tile, tile), Image.NEAREST)
            og.paste(im, (x, y))
            k += 1
    d = ImageDraw.Draw(og)
    d.rectangle([300, 245, 900, 385], fill=(0, 0, 0))
    d.rectangle([300, 245, 900, 385], outline=(204, 255, 0), width=4)
    _pixel_text(d, "NEONFACES", 330, 275, 8, (204, 255, 0))
    _pixel_text(d, "THEY DONT BLINK", 450, 350, 3, (242, 255, 200))
    og.save(WEB / "og.png", optimize=True)

    # --- favicon / unrevealed ----------------------------------------------------------
    Image.open(OUT / "unrevealed.png").convert("RGB").resize((64, 64), Image.NEAREST).save(WEB / "favicon.png")
    print(f"exported {len(picked)} previews, rarity for {len(order)} traits, og.png, favicon.png")


# minimal 5x7 pixel font for the social card
FONT = {
    "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    "C": ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    "I": ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
    "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    " ": ["00000"] * 7,
}


def _pixel_text(d, text, x, y, s, color):
    for ch in text:
        g = FONT[ch]
        for r, row in enumerate(g):
            for c, bit in enumerate(row):
                if bit == "1":
                    d.rectangle([x + c * s, y + r * s, x + c * s + s - 1, y + r * s + s - 1], fill=color)
        x += 6 * s


if __name__ == "__main__":
    main()
