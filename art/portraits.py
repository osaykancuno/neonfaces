"""
Source portraits for the collection: photographic portraits of people who don't exist, one per set and a pool
for the single close-ups (each pool portrait gives about eight crops). The pixels that go on-chain are made from
them by neonfaces/photo.py.

    python portraits.py plan            # write portraits/manifest.json: id, who, light, expression, prompt
    python portraits.py todo [n]        # the next n portraits without an image (prompts to generate)
    python portraits.py record r.json   # store generation results ([{"id", "job", "url"}]) in the manifest
    python portraits.py fetch           # download every portrait that has a url in the manifest (512 px, grayscale)
    python portraits.py check           # landmarks sanity + contact sheet of what is there

portraits/manifest.json is committed (prompts, generation job ids, sha256 of every image); the images
(portraits/<id>.png) are not: the on-chain records are the art.
"""
from __future__ import annotations

import hashlib
import json
import math
import random
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).parent
DIR = ROOT / "portraits"
MANIFEST = DIR / "manifest.json"
CROPS_PER_PORTRAIT = 8
MODEL = "z_image"

LOOKS = [
    "East Asian", "Southeast Asian", "South Asian", "Black", "white European",
    "Middle Eastern", "Latin American", "mixed-heritage",
]
AGES = {"twenties": 30, "thirties": 35, "forties": 25, "fifties": 10}
EXPRESSION = {
    "Flat": "a calm, neutral expression",
    "Squint": "eyes slightly narrowed in a relaxed way",
    "Glare": "a focused, steady stare, calm and self-assured",
    "Wide": "eyes open a little wider, attentive",
    "Tense": "a serious expression, lips gently pressed together",
}
LIGHT = {
    "side": "a single soft light from the left side of the frame, the right half of the face falling into deep shadow",
    "top": "a single soft light from directly above, shadows under the brows, nose and chin",
}


def prompt(who: str, light: str, expression: str) -> str:
    return (
        f"Black and white photographic close-up portrait of {who}, ordinary and good-looking, "
        f"{EXPRESSION[expression]}, looking straight into the camera, frontal, head centred and filling the frame, "
        f"eyes a little above the middle of the frame, {LIGHT[light]}, plain dark background, natural skin, "
        f"no glasses, no jewellery, sharp focus"
    )


def _deck(weights: dict, n: int, rng: random.Random) -> list:
    tot = sum(weights.values())
    cards = []
    for k, w in weights.items():
        cards += [k] * round(w / tot * n)
    while len(cards) < n:
        cards.append(max(weights, key=weights.get))
    cards = cards[:n]
    rng.shuffle(cards)
    return cards


def _who(gender: str, look: str, age: str) -> str:
    noun, pron = ("woman", "her") if gender == "Woman" else ("man", "his")
    art = "an" if look[0].lower() in "aeiou" else "a"
    return f"{art} {look} {noun} in {pron} {age}"


def build(pieces: list[dict], seed: int) -> list[dict]:
    """Manifest entries for a planned collection (generate.plan output)."""
    rng = random.Random(seed ^ 0x9E3779B9)
    out = []
    sets = [p for p in pieces if "set" in p and p["piece"] == 0]
    # sets: one portrait each, looks and ages dealt evenly inside each gender
    for gender in ("Woman", "Man"):
        mine = [p for p in sets if p["traits"]["Face"] == gender]
        looks = _deck({k: 1 for k in LOOKS}, len(mine), rng)
        ages = _deck(AGES, len(mine), rng)
        for p, look, age in zip(mine, looks, ages):
            t = p["traits"]
            light = "top" if t["Light"] == "Top" else "side"
            who = _who(gender, look, age)
            out.append({"id": f"set-{p['set']}", "set": p["set"], "gender": gender, "look": look, "age": age,
                        "light": light, "expression": t["Expression"], "prompt": prompt(who, light, t["Expression"])})
    # singles: a pool per (light, expression), about CROPS_PER_PORTRAIT crops per portrait
    need = defaultdict(int)
    for p in pieces:
        if "set" not in p:
            need[("top" if p["traits"]["Light"] == "Top" else "side", p["traits"]["Expression"])] += 1
    k = 0
    for (light, expression), n in sorted(need.items()):
        m = math.ceil(n / CROPS_PER_PORTRAIT)
        genders = _deck({"Woman": 1, "Man": 1}, m, rng)
        looks = _deck({x: 1 for x in LOOKS}, m, rng)
        ages = _deck(AGES, m, rng)
        for i in range(m):
            who = _who(genders[i], looks[i], ages[i])
            out.append({"id": f"pool-{k}", "light": light, "expression": expression, "gender": genders[i],
                        "look": looks[i], "age": ages[i], "prompt": prompt(who, light, expression)})
            k += 1
    out.sort(key=lambda e: (e["id"].startswith("pool"), int(e["id"].split("-")[1])))
    return out


def assign_singles(pieces: list[dict], manifest: list[dict]) -> dict[int, list[tuple[str, float]]]:
    """For every single: candidate (portrait id, side) pairs, the first one preferred. Portraits of the matching
    (light, expression) pool are used in turn, never the same crop on the same side twice."""
    pools = defaultdict(list)
    for e in manifest:
        if e["id"].startswith("pool"):
            pools[(e["light"], e["expression"])].append(e["id"])
    used = set()
    cursor = defaultdict(int)
    out = {}
    for p in pieces:
        if "set" in p:
            continue
        t = p["traits"]
        key = ("top" if t["Light"] == "Top" else "side", t["Expression"])
        pool = pools[key]
        cands = []
        for step in range(len(pool)):
            pid = pool[(cursor[key] + step) % len(pool)]
            for side in (1.0, -1.0):
                if (pid, t["Crop"], side) not in used:
                    cands.append((pid, side))
        if not cands:  # more crops than combinations: allow repeats (different jitter)
            cands = [(pool[cursor[key] % len(pool)], 1.0)]
        used.add((cands[0][0], t["Crop"], cands[0][1]))
        cursor[key] += 1
        out[p["artId"]] = cands[:6]
    return out


def load() -> list[dict]:
    return json.loads(MANIFEST.read_text())


def save(manifest: list[dict]) -> None:
    MANIFEST.write_text(json.dumps(manifest, indent=1))


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    DIR.mkdir(exist_ok=True)
    if cmd == "plan":
        sys.path.insert(0, str(ROOT))
        from generate import MASTER_SEED, plan
        from neonfaces.traits import SUPPLY
        old = {e["id"]: e for e in load()} if MANIFEST.exists() else {}
        manifest = build(plan(SUPPLY, MASTER_SEED), MASTER_SEED)
        for e in manifest:  # keep generation records of portraits whose prompt did not change
            o = old.get(e["id"])
            if o and o["prompt"] == e["prompt"]:
                e.update({k: o[k] for k in ("job", "url", "sha256") if k in o})
        save(manifest)
        sets = sum(1 for e in manifest if "set" in e)
        print(f"{len(manifest)} portraits: {sets} sets + {len(manifest) - sets} pool")
    elif cmd == "todo":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 12
        todo = [e for e in load() if "job" not in e][:n]
        print(json.dumps([{"id": e["id"], "prompt": e["prompt"]} for e in todo], indent=1))
    elif cmd == "record":  # portraits.py record results.json  ([{"id", "job", "url"}] from the generation tool)
        manifest = load()
        by_id = {e["id"]: e for e in manifest}
        for r in json.loads(Path(sys.argv[2]).read_text()):
            by_id[r["id"]].update({"job": r["job"], "url": r["url"], "model": MODEL})
        save(manifest)
        print(f"{sum('job' in e for e in manifest)}/{len(manifest)} generated")
    elif cmd == "fetch":
        import io
        from PIL import Image
        manifest = load()
        for e in manifest:
            f = DIR / f"{e['id']}.png"
            if e.get("url") and not f.exists():
                raw = urllib.request.urlopen(e["url"]).read()
                e["sha256"] = hashlib.sha256(raw).hexdigest()  # of the image as generated
                # kept at the resolution the pipeline samples: 512 px grayscale
                Image.open(io.BytesIO(raw)).convert("L").resize((512, 512), Image.LANCZOS).save(f, optimize=True)
                save(manifest)
        save(manifest)
        have = sum(1 for e in manifest if (DIR / f"{e['id']}.png").exists())
        print(f"{have}/{len(manifest)} portraits on disk")
    elif cmd == "check":
        sys.path.insert(0, str(ROOT))
        from PIL import Image
        from neonfaces.photo import landmarks, load_portrait
        manifest = [e for e in load() if (DIR / f"{e['id']}.png").exists()]
        bad = []
        for e in manifest:
            lm = landmarks(load_portrait(DIR / f"{e['id']}.png"))
            if lm.get("fallback"):
                bad.append(e["id"])
        cols, t = 20, 96
        sheet = Image.new("L", (cols * t, ((len(manifest) + cols - 1) // cols) * t))
        for i, e in enumerate(manifest):
            sheet.paste(Image.open(DIR / f"{e['id']}.png").convert("L").resize((t, t)), ((i % cols) * t, (i // cols) * t))
        sheet.save(DIR / "contact.png")
        print(f"{len(manifest)} checked, framing fallback on: {bad or 'none'}; sheet: portraits/contact.png")
    else:
        manifest = load()
        have = sum(1 for e in manifest if (DIR / f"{e['id']}.png").exists())
        print(f"{len(manifest)} planned, {sum('job' in e for e in manifest)} generated, {have} on disk")


if __name__ == "__main__":
    main()
