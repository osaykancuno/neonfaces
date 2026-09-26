"""
Images for the pre-launch page (landing/img), drawn from the on-chain records of the generated collection.

    python export_landing.py

- face-<tier>-1/2.png   two single close-ups per Stare tier
- set-<n>-<piece>.png   the four pieces of two sets (one woman, one man), and set-<n>.png assembled
- gaze-0..3.svg         one dark assembled set at every Gaze level: the exact SVG the contract returns
"""
from __future__ import annotations

import json
import random
from pathlib import Path

from neonfaces.onchain import raster_preview, raster_set_preview, render_set_svg

ROOT = Path(__file__).parent
OUT = ROOT / "output"
IMG = ROOT.parent / "landing" / "img"


def trait(a, k):
    return next((x["value"] for x in a["attributes"] if x["trait_type"] == k), None)


def main():
    art = json.loads((OUT / "art.json").read_text())
    chunks = [bytes.fromhex(c[2:]) for c in json.loads((OUT / "onchain" / "chunks.json").read_text())]

    def record(aid):
        c = chunks[aid // 32]
        i = aid % 32
        n = int.from_bytes(c[0:2], "big") // 2
        start = int.from_bytes(c[2 * i:2 * i + 2], "big")
        end = int.from_bytes(c[2 * i + 2:2 * i + 4], "big") if i + 1 < n else len(c)
        return c[start:end]

    rng = random.Random(5555)
    IMG.mkdir(parents=True, exist_ok=True)
    for old in IMG.glob("face-*.png"):
        old.unlink()
    for old in IMG.glob("set-*.png"):
        old.unlink()

    for stare in ("Glance", "Watch", "Heavy Stare"):
        pool = [a for a in art if "set" not in a and trait(a, "Stare") == stare and trait(a, "Anomaly") == "None"]
        for k, a in enumerate(rng.sample(pool, 2), 1):
            raster_preview(a["artId"], record(a["artId"]), 960).resize((320, 320)).save(IMG / f"face-{stare.lower().replace(' ', '-')}-{k}.png", optimize=True)

    heads = [a for a in art if a.get("piece") == 0 and trait(a, "Grain") != "Heavy Scan"]
    picks = [rng.choice([a for a in heads if trait(a, "Face") == "Woman" and trait(a, "Stare") == "Watch"]),
             rng.choice([a for a in heads if trait(a, "Face") == "Man" and trait(a, "Stare") == "Glance"])]
    for a in picks:
        recs = [record(a["artId"] + q) for q in range(4)]
        for q, r in enumerate(recs):
            raster_preview(a["artId"] + q, r, 960).resize((240, 240)).save(IMG / f"set-{a['set']}-{q}.png", optimize=True)
        raster_set_preview(a["set"], recs, 960).resize((480, 480)).save(IMG / f"set-{a['set']}.png", optimize=True)

    # the Gaze reads best on a dark face: neon bleeding into black
    a = rng.choice([h for h in heads if trait(h, "Density") == "Heavy" and trait(h, "Grain") == "Clean Print" and trait(h, "Edge") == "Stair Step"])
    recs = [record(a["artId"] + q) for q in range(4)]
    for g in range(4):
        (IMG / f"gaze-{g}.svg").write_text(render_set_svg(a["set"], recs, g))
    print("sets:", [(p["set"], trait(p, "Face"), trait(p, "Stare")) for p in picks], "gaze: set", a["set"])


if __name__ == "__main__":
    main()
