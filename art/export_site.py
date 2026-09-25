"""
Export website assets from the generated collection.

    python export_site.py            # -> ../web/public/data   (then: python export_brand.py for icons, og.png, logo, banner)

- data/gallery.json   120 on-chain records (hex) covering every crop / tier / anomaly + the placeholder,
                      and 8 whole sets (4 records each, women and men, every tier);
                      the site renders them with the JS port of NeonRenderer (byte-identical SVG)
- data/rarity.json    exact counts per trait value (the published rarity table)
"""
from __future__ import annotations

import json
import random
import shutil
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).parent
OUT = ROOT / "output"
WEB = ROOT.parent / "web" / "public"


def trait(a, k):
    return next((x["value"] for x in a["attributes"] if x["trait_type"] == k), None)


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

    # whole sets for the "Four pieces" section: one woman and one man per tier, plus two more Glance
    heads = [a for a in art if a.get("piece") == 0]
    sets = []
    for stare, n in (("Heavy Stare", 2), ("Watch", 2), ("Glance", 4)):
        for face in ("Woman", "Man"):
            pool = [a for a in heads if trait(a, "Stare") == stare and trait(a, "Face") == face]
            for a in rng.sample(pool, n // 2):
                sets.append({"set": a["set"], "stare": stare, "face": face,
                             "records": [record(a["artId"] + q) for q in range(4)]})
    rng.shuffle(sets)

    (WEB / "data").mkdir(parents=True, exist_ok=True)
    (WEB / "data" / "gallery.json").write_text(json.dumps({
        "placeholder": (OUT / "onchain" / "placeholder.hex").read_text().strip(),
        "faces": gallery,
        "sets": sets,
    }))

    # --- rarity table ---------------------------------------------------------------
    order = [x["trait_type"] for x in art[-1]["attributes"] if x["trait_type"] != "Set"]  # a set piece has every trait
    rarity = []
    for k in order:
        c = Counter(v for v in (trait(a, k) for a in art) if v is not None)  # Face: set pieces only
        rarity.append({"trait": k, "values": [{"value": v, "count": n} for v, n in c.most_common()]})
    (WEB / "data" / "rarity.json").write_text(json.dumps({"total": len(art), "traits": rarity}))

    print(f"exported {len(picked)} previews, rarity for {len(order)} traits")


if __name__ == "__main__":
    main()
