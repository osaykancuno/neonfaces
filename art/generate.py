"""
Generate the full NEONFACES collection (fully on-chain edition).

    python generate.py                  # 5555 faces into ./output
    python generate.py --count 400      # quick rehearsal
    python generate.py --workers 8

Outputs (./output):
    onchain/chunks.json      hex chunks to upload into NeonArt (SSTORE2), in order
    onchain/placeholder.hex  pre-reveal record (NeonRenderer constructor)
    provenance.json          keccak running hash of the chunks -> NeonFaces.setProvenanceHash BEFORE mint
    art.json                 traits of every art piece (artId = 0..N-1, grouped by Stare tier)
    rarity.csv               per-trait counts and percentages
    images/<artId>.png       1200px previews rasterized from the on-chain data (marketing / site)
    contact_sheet.png, legibility_48px.png, unrevealed.png
    ../contracts/test/fixtures/svg-samples.json   byte-exact SVG fixtures for the Solidity tests
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import random
import sys
import time
from collections import Counter
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from neonfaces.onchain import build_chunks, encode_record, provenance, raster_preview, render_svg  # noqa: E402
from neonfaces.render import FaceParams, Window, quantize, render_face, render_grid, sample_anatomy  # noqa: E402
from neonfaces.traits import BY_TIER, GLOBAL, SUPPLY, TIERS, TRAIT_ORDER, deck  # noqa: E402

MASTER_SEED = 5555_0000_4663
ROOT = Path(__file__).parent


def plan(count: int, seed: int) -> list[dict]:
    """Assign exact trait decks to every art piece, tier by tier."""
    rng = random.Random(seed)
    scale = count / SUPPLY
    tier_sizes = {t: (c if count == SUPPLY else max(1, round(c * scale))) for t, (_, c) in TIERS.items()}
    if count != SUPPLY:  # make sizes add up for rehearsal runs
        tier_sizes[1] += count - sum(tier_sizes.values())

    pieces = []
    globals_ = {k: deck(v, count, rng) for k, v in GLOBAL.items()}
    gi = 0
    for tier, (tname, _) in TIERS.items():
        n = tier_sizes[tier]
        biased = {k: deck(v[tier], n, rng) for k, v in BY_TIER.items()}
        for j in range(n):
            t = {"Stare": tname}
            for k in GLOBAL:
                t[k] = globals_[k][gi]
            for k in BY_TIER:
                t[k] = biased[k][j]
            pieces.append({"artId": gi, "tier": tier, "tierIndex": j, "traits": t})
            gi += 1
    return pieces


def _params(traits: dict) -> FaceParams:
    return FaceParams(
        crop=traits["Crop"], density=traits["Density"], grain=traits["Grain"],
        edge=traits["Edge"], neon=traits["Neon"], light=traits["Light"],
        expression=traits["Expression"], accessory=traits["Accessory"],
        anomaly=traits["Anomaly"], block=traits["Block"],
    )


def work(job):
    piece, out_dir, seed, previews = job
    attempt = 0
    while True:
        s = (seed * 1_000_003 + piece["artId"] * 7919 + attempt) % (2**63)
        _, idx = render_face(_params(piece["traits"]), s, with_image=False)
        # reject near-empty frames: a face must show some structure
        tones = np.bincount(idx.ravel(), minlength=8)
        if tones.max() / idx.size < 0.82 and (idx.size - tones[5]) / idx.size > 0.10 and tones[3:].sum() / idx.size > 0.12:
            break
        attempt += 1
    rec = encode_record(idx, piece["traits"])
    if previews:
        raster_preview(piece["artId"], rec).save(Path(out_dir) / "images" / f"{piece['artId']}.png", optimize=True)
    return piece["artId"], rec.hex(), hashlib.sha256(idx.tobytes()).hexdigest(), s


def placeholder_record() -> bytes:
    """Pre-reveal art: an inverted, hard-cut open eye (neon lines on black)."""
    p = FaceParams(crop="Eye", edge="Hard cut", light="Top", density="Mid", expression="Wide", grain="Heavy scan")
    rng = np.random.default_rng(4663)
    sample_anatomy(p, rng)
    p.extra["bg"] = 0.03
    win = Window(0.40, -0.02, 0.7, 0.0, False)
    idx = quantize(render_grid(p, win, 24, rng), "Hard cut")
    idx = (5 - idx).astype(np.uint8)
    traits = {"Crop": "Eye", "Density": "Mid", "Neon": "Standard", "Edge": "Hard cut", "Grain": "Heavy scan",
              "Light": "Top", "Expression": "Wide", "Accessory": "None", "Block": "Standard", "Anomaly": "None"}
    return encode_record(idx, traits)


def sheets(out: Path, n: int):
    ids = list(range(n))
    random.Random(7).shuffle(ids)
    ids = ids[:400]
    cols = 20
    rows = (len(ids) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * 120, rows * 120))
    leg = Image.new("RGB", (cols * 52, rows * 52), (20, 20, 20))
    for i, a in enumerate(ids):
        im = Image.open(out / "images" / f"{a}.png").convert("RGB")
        sheet.paste(im.resize((120, 120), Image.BILINEAR), ((i % cols) * 120, (i // cols) * 120))
        leg.paste(im.resize((48, 48), Image.LANCZOS), ((i % cols) * 52 + 2, (i // cols) * 52 + 2))
    sheet.save(out / "contact_sheet.png", optimize=True)
    leg.save(out / "legibility_48px.png", optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=SUPPLY)
    ap.add_argument("--out", default=str(ROOT / "output"))
    ap.add_argument("--seed", type=int, default=MASTER_SEED)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--no-previews", action="store_true")
    ap.add_argument("--fixtures", default=str(ROOT.parent / "contracts" / "test" / "fixtures"))
    args = ap.parse_args()

    out = Path(args.out)
    (out / "images").mkdir(parents=True, exist_ok=True)
    (out / "onchain").mkdir(parents=True, exist_ok=True)
    pieces = plan(args.count, args.seed)
    previews = not args.no_previews
    t0 = time.time()

    results = {}
    jobs = [(p, str(out), args.seed, previews) for p in pieces]
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        for k, r in enumerate(ex.map(work, jobs, chunksize=16)):
            results[r[0]] = r
            if (k + 1) % 500 == 0:
                print(f"  {k + 1}/{len(jobs)}  {time.time() - t0:.0f}s", flush=True)

    # uniqueness: re-render any piece whose block grid collides with an earlier one
    seen: set[str] = set()
    for p in pieces:
        aid = p["artId"]
        bump = 0
        while results[aid][2] in seen:
            bump += 1
            results[aid] = work((p, str(out), args.seed + bump * 104729, previews))
        seen.add(results[aid][2])

    records = [bytes.fromhex(results[p["artId"]][1]) for p in pieces]
    chunks = build_chunks(records)
    prov = provenance(chunks)
    (out / "onchain" / "chunks.json").write_text(json.dumps(["0x" + c.hex() for c in chunks]))
    ph = placeholder_record()
    (out / "onchain" / "placeholder.hex").write_text("0x" + ph.hex())

    art = []
    for p, rec in zip(pieces, records):
        art.append({
            "artId": p["artId"], "tier": p["tier"], "tierIndex": p["tierIndex"],
            "renderSeed": results[p["artId"]][3], "recordBytes": len(rec),
            "attributes": [{"trait_type": k, "value": p["traits"][k]} for k in TRAIT_ORDER],
        })
    (out / "art.json").write_text(json.dumps(art, separators=(",", ":")))

    tiers = {}
    for a in art:
        t = tiers.setdefault(a["tier"], {"first": a["artId"], "count": 0})
        t["count"] += 1
    info = {
        "provenanceHash": prov,
        "algorithm": "h0 = 0x00..00; h(k+1) = keccak256(h(k) || chunk(k)); chunks = onchain/chunks.json in order",
        "count": len(art),
        "chunks": len(chunks),
        "totalBytes": sum(len(c) for c in chunks),
        "tiers": {str(k): {"name": TIERS[k][0], **v} for k, v in tiers.items()},
        "masterSeed": args.seed,
    }
    (out / "provenance.json").write_text(json.dumps(info, indent=1))

    with open(out / "rarity.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["trait", "value", "count", "percent"])
        for k in TRAIT_ORDER:
            c = Counter(next(x["value"] for x in a["attributes"] if x["trait_type"] == k) for a in art)
            for v, n in c.most_common():
                w.writerow([k, v, n, f"{100 * n / len(art):.2f}"])

    # byte-exact fixtures for the Solidity renderer tests: one of each grain + the placeholder
    fixtures = []
    for grain in ("Clean print", "Dusty", "Heavy scan"):
        a = next(x for x in art if next(t["value"] for t in x["attributes"] if t["trait_type"] == "Grain") == grain)
        rec = records[a["artId"]]
        fixtures.append({"artId": a["artId"], "record": "0x" + rec.hex(), "svg": render_svg(a["artId"], rec)})
    fixtures.append({"artId": 5555, "record": "0x" + ph.hex(), "svg": render_svg(5555, ph)})
    Path(args.fixtures).mkdir(parents=True, exist_ok=True)
    (Path(args.fixtures) / "svg-samples.json").write_text(json.dumps(fixtures, indent=1))

    raster_preview(5555, ph).save(out / "unrevealed.png", optimize=True)
    if previews:
        sheets(out, len(art))
    print(f"done: {len(art)} faces in {time.time() - t0:.0f}s | on-chain {info['totalBytes'] / 1e6:.2f} MB in {len(chunks)} chunks | provenance {prov}")


if __name__ == "__main__":
    main()
