"""
Generate the full NEONFACES collection (fully on-chain edition).

    python generate.py                  # 5555 faces into ./output
    python generate.py --count 400      # quick rehearsal
    python generate.py --workers 8

Outputs (./output):
    onchain/chunks.json      hex chunks to upload into NeonArt (SSTORE2), in order
    onchain/placeholder.hex  pre-reveal record (NeonRenderer constructor)
    provenance.json          keccak running hash of the chunks -> NeonFaces.setProvenanceHash BEFORE mint
    art.json                 traits of every art piece (singles [0, 3335), then 555 sets of 4; by Stare tier inside each)
    rarity.csv               per-trait counts and percentages
    images/<artId>.png       1200px previews rasterized from the on-chain data (marketing / site)
    images/set-<n>.png       assembled sets (n = 1..555)
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
from neonfaces.onchain import (  # noqa: E402
    build_chunks, encode_record, provenance, raster_preview, raster_set_preview, render_set_svg, render_svg,
)
from neonfaces.render import (  # noqa: E402
    FaceParams, Window, quantize, render_face, render_grid, render_set, sample_anatomy, split_set,
)
from neonfaces.traits import (  # noqa: E402
    BY_TIER, FACE, GLOBAL, PIECES, SET_TIERS, SET_TRAITS, SETS, SINGLE_TIERS, SUPPLY, TIERS, TRAIT_ORDER, deck,
)

MASTER_SEED = 5555_0000_4663
ROOT = Path(__file__).parent


def _scaled(sizes: dict[int, int], n: int) -> dict[int, int]:
    """Tier sizes for a rehearsal run of n (the full run keeps the exact sizes)."""
    full = sum(sizes.values())
    if n == full:
        return dict(sizes)
    out = {t: round(c * n / full) for t, c in sizes.items()}
    out[1] += n - sum(out.values())
    return out


def plan(count: int, seed: int) -> list[dict]:
    """Assign exact trait decks: singles tier by tier, then sets tier by tier (4 pieces share a set's traits)."""
    rng = random.Random(seed)
    n_sets = SETS if count == SUPPLY else count * SETS // SUPPLY
    n_singles = count - 4 * n_sets
    single_sizes = _scaled(SINGLE_TIERS, n_singles)
    set_sizes = _scaled(SET_TIERS, n_sets)

    pieces = []
    globals_ = {k: deck(v, n_singles, rng) for k, v in GLOBAL.items()}
    gi = 0
    for tier, (tname, _) in TIERS.items():
        n = single_sizes[tier]
        biased = {k: deck(v[tier], n, rng) for k, v in BY_TIER.items()}
        for j in range(n):
            t = {"Stare": tname}
            for k in GLOBAL:
                t[k] = globals_[k][gi]
            for k in BY_TIER:
                t[k] = biased[k][j]
            pieces.append({"artId": len(pieces), "tier": tier, "traits": t})
            gi += 1

    set_globals = {k: deck(GLOBAL[k], n_sets, rng) for k in SET_TRAITS}
    si = 0
    for tier, (tname, _) in TIERS.items():
        n = set_sizes[tier]
        biased = {k: deck(v[tier], n, rng) for k, v in BY_TIER.items()}
        faces = deck(FACE, n, rng)
        for j in range(n):
            t = {"Stare": tname, "Anomaly": "None", "Face": faces[j]}
            for k in SET_TRAITS:
                t[k] = set_globals[k][si]
            for k in BY_TIER:
                t[k] = biased[k][j]
            for q in range(4):
                pieces.append({"artId": len(pieces), "tier": tier, "set": si + 1, "piece": q,
                               "traits": {**t, "Crop": PIECES[q]}})
            si += 1
    return pieces


def _params(traits: dict) -> FaceParams:
    return FaceParams(
        crop=traits["Crop"] if traits["Crop"] not in PIECES else "Eye", density=traits["Density"],
        grain=traits["Grain"], edge=traits["Edge"], neon=traits["Neon"], light=traits["Light"],
        expression=traits["Expression"], accessory=traits["Accessory"], anomaly=traits["Anomaly"],
        block=traits["Block"], face=traits.get("Face", ""),
    )


def _legible(idx, dominant=0.82, bright=0.12) -> bool:
    """Reject near-empty frames: a face must show some structure."""
    tones = np.bincount(idx.ravel(), minlength=8)
    return tones.max() / idx.size < dominant and (idx.size - tones[5]) / idx.size > 0.10 and tones[3:].sum() / idx.size > bright


def work(job):
    """One single close-up, or one whole set (its 4 pieces). Returns [(artId, record hex, grid hash, seed, accessory)]."""
    group, out_dir, seed, previews = job
    first = group[0]
    attempt = 0
    while True:
        s = (seed * 1_000_003 + first["artId"] * 7919 + attempt) % (2**63)
        if "set" not in first:
            _, idx = render_face(_params(first["traits"]), s, with_image=False)
            if _legible(idx):
                grids, accs = [idx], [first["traits"]["Accessory"]]
                break
        else:
            full, accs = render_set(_params(first["traits"]), s)
            grids = split_set(full)
            if _legible(full) and all(_legible(t, dominant=0.9, bright=0.06) for t in grids):
                break
        attempt += 1
    out = []
    recs = []
    for piece, idx, acc in zip(group, grids, accs):
        rec = encode_record(idx, {**piece["traits"], "Accessory": acc})
        recs.append(rec)
        if previews:
            raster_preview(piece["artId"], rec).save(Path(out_dir) / "images" / f"{piece['artId']}.png", optimize=True)
        out.append((piece["artId"], rec.hex(), hashlib.sha256(idx.tobytes()).hexdigest(), s, acc))
    if previews and "set" in first:
        raster_set_preview(first["set"], recs).save(Path(out_dir) / "images" / f"set-{first['set']}.png", optimize=True)
    return out


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


def groups(pieces: list[dict]) -> list[list[dict]]:
    out = []
    for p in pieces:
        if "set" in p and p["piece"] > 0:
            out[-1].append(p)
        else:
            out.append([p])
    return out


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
    jobs = [(g, str(out), args.seed, previews) for g in groups(pieces)]
    with ProcessPoolExecutor(max_workers=args.workers) as ex:
        for k, rs in enumerate(ex.map(work, jobs, chunksize=8)):
            for r in rs:
                results[r[0]] = r
            if (k + 1) % 500 == 0:
                print(f"  {k + 1}/{len(jobs)}  {time.time() - t0:.0f}s", flush=True)

    # uniqueness: re-render any single / set whose block grid collides with an earlier one
    seen: set[str] = set()
    for g in groups(pieces):
        bump = 0
        while any(results[p["artId"]][2] in seen for p in g):
            bump += 1
            for r in work((g, str(out), args.seed + bump * 104729, previews)):
                results[r[0]] = r
        seen.update(results[p["artId"]][2] for p in g)
    for p in pieces:
        p["traits"]["Accessory"] = results[p["artId"]][4]  # set pieces show the accessory only where it lands

    records = [bytes.fromhex(results[p["artId"]][1]) for p in pieces]
    chunks = build_chunks(records)
    prov = provenance(chunks)
    (out / "onchain" / "chunks.json").write_text(json.dumps(["0x" + c.hex() for c in chunks]))
    ph = placeholder_record()
    (out / "onchain" / "placeholder.hex").write_text("0x" + ph.hex())

    art = []
    for p, rec in zip(pieces, records):
        a = {"artId": p["artId"], "tier": p["tier"], "renderSeed": results[p["artId"]][3], "recordBytes": len(rec)}
        if "set" in p:
            a["set"], a["piece"] = p["set"], p["piece"]
        a["attributes"] = [{"trait_type": k, "value": p["traits"][k]} for k in TRAIT_ORDER if k in p["traits"]]
        if "set" in p:
            a["attributes"].append({"trait_type": "Set", "value": f"#{p['set']}"})
        art.append(a)
    (out / "art.json").write_text(json.dumps(art, separators=(",", ":")))

    tiers = {}
    for a in art:
        t = tiers.setdefault(a["tier"], {"count": 0, "singles": 0, "setPieces": 0})
        t["count"] += 1
        t["setPieces" if "set" in a else "singles"] += 1
    info = {
        "provenanceHash": prov,
        "algorithm": "h0 = 0x00..00; h(k+1) = keccak256(h(k) || chunk(k)); chunks = onchain/chunks.json in order",
        "count": len(art),
        "chunks": len(chunks),
        "totalBytes": sum(len(c) for c in chunks),
        "tiers": {str(k): {"name": TIERS[k][0], **v} for k, v in tiers.items()},
        "singles": sum(1 for a in art if "set" not in a),
        "sets": len({a["set"] for a in art if "set" in a}),
        "layout": "art ids [0, singles): single close-ups by tier; set k (1-based) = singles + 4(k-1) .. +3: left eye, right eye, left mouth, right mouth; sets by tier",
        "masterSeed": args.seed,
    }
    (out / "provenance.json").write_text(json.dumps(info, indent=1))

    with open(out / "rarity.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["trait", "value", "count", "percent"])
        for k in TRAIT_ORDER:
            c = Counter(next((x["value"] for x in a["attributes"] if x["trait_type"] == k), "None") for a in art)
            for v, n in c.most_common():
                w.writerow([k, v, n, f"{100 * n / len(art):.2f}"])

    # byte-exact fixtures for the Solidity renderer tests: one of each grain + the placeholder
    fixtures = []
    for grain in ("Clean print", "Dusty", "Heavy scan"):
        a = next(x for x in art if next(t["value"] for t in x["attributes"] if t["trait_type"] == "Grain") == grain)
        rec = records[a["artId"]]
        fixtures.append({"artId": a["artId"], "record": "0x" + rec.hex(), "svg": render_svg(a["artId"], rec)})
    fixtures.append({"artId": 5555, "record": "0x" + ph.hex(), "svg": render_svg(5555, ph)})
    first = next(x for x in art if "set" in x and next(t["value"] for t in x["attributes"] if t["trait_type"] == "Grain") != "Clean print")
    set_recs = records[first["artId"]:first["artId"] + 4]
    set_fixture = {"set": first["set"], "artId": first["artId"], "records": ["0x" + r.hex() for r in set_recs],
                   "svg": render_set_svg(first["set"], set_recs)}
    for gz in (1, 2, 3):
        set_fixture[f"gaze{gz}"] = render_set_svg(first["set"], set_recs, gz)
    Path(args.fixtures).mkdir(parents=True, exist_ok=True)
    (Path(args.fixtures) / "svg-samples.json").write_text(json.dumps(fixtures, indent=1))
    (Path(args.fixtures) / "svg-set-sample.json").write_text(json.dumps(set_fixture, indent=1))

    raster_preview(5555, ph).save(out / "unrevealed.png", optimize=True)
    if previews:
        sheets(out, len(art))
    print(f"done: {len(art)} faces in {time.time() - t0:.0f}s | on-chain {info['totalBytes'] / 1e6:.2f} MB in {len(chunks)} chunks | provenance {prov}")


if __name__ == "__main__":
    main()
