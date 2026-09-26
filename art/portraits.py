"""
Source portraits for the collection: photographic portraits of people who don't exist, one per set and a pool
for the single close-ups (each pool portrait gives about eight crops). The pixels that go on-chain are made from
them by neonfaces/photo.py.

    python portraits.py plan            # write portraits/manifest.json: id, who, light, expression, prompt
    python portraits.py pool [4] [300]  # singles on a budget: reuse earlier set takes, plan only what is missing
    python portraits.py todo [n]        # the next n portraits without an image (prompts to generate)
    python portraits.py generate [n] [--backend muapi|pollinations] [--ids set-1,pool-3]
                                        # generate the missing portraits (or regenerate --ids) through an API;
                                        # key in art/.env: MUAPI_API_KEY=... or POLLINATIONS_KEY=... (git-ignored)
    python portraits.py record r.json   # store generation results ([{"id", "job", "url"}]) in the manifest
    python portraits.py fetch           # download every portrait that has a url in the manifest (512 px, grayscale)
    python portraits.py check           # landmarks sanity + contact sheet of what is there
    python portraits.py similar [0.65]  # pairs of faces that look like the same person (SFace identity)
    python portraits.py diversify --sets [0.75]    # set faces: no two that look like the same person (or siblings)
    python portraits.py diversify [0.85]           # everything: no duplicates; one of each pair gets a new person

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
CROPS_PER_PORTRAIT = 1  # for `plan` from scratch; the budgeted pool (`pool`) gives about 4 crops per person
MODEL = "z_image"

LOOKS = [
    "East Asian", "Southeast Asian", "South Asian", "Black", "white European",
    "Middle Eastern", "Latin American", "mixed-heritage",
]
AGES = {"twenties": 30, "thirties": 35, "forties": 25, "fifties": 10}
AGE_SPAN = {"twenties": (21, 29), "thirties": (30, 39), "forties": (40, 49), "fifties": (50, 59)}
# individual features, dealt from shuffled decks so no two portraits get the same description
FACE_SHAPE = ["an oval face", "a round face", "a square face", "a heart-shaped face", "a long face", "a diamond-shaped face"]
HAIR = {
    "Woman": ["long straight hair", "long wavy hair", "shoulder-length curly hair", "a short pixie cut", "a chin-length bob",
              "hair tied back", "long braids", "a natural afro", "short curly hair", "a side-swept fringe",
              "a high bun", "cropped hair shaved at the sides"],
    "Man": ["short cropped hair", "a buzz cut", "curly hair on top", "wavy medium-length hair", "hair combed back",
            "a shaved head", "a short afro", "a receding hairline", "shoulder-length hair tied back", "a side part",
            "short twists", "thick messy hair"],
}
HAIR_TONE = ["black", "dark brown", "brown", "light brown", "greying", "silver", "dark blond", "blond", "auburn", "jet-black"]
EYES = ["large eyes", "small eyes", "narrow eyes", "round eyes", "downturned eyes", "upturned eyes", "close-set eyes",
        "heavy-lidded eyes"]
NOSE = ["a small nose", "a long nose", "a wide nose", "a straight nose", "an aquiline nose", "a button nose",
        "a flat nose bridge", "a high nose bridge"]
FACIAL_HAIR = ["clean-shaven", "clean-shaven", "light stubble", "a short beard", "a moustache", "a full trimmed beard"]
BROWS = ["thick eyebrows", "thin eyebrows", "arched eyebrows", "straight eyebrows", "bushy eyebrows", "soft eyebrows"]
FEATURE = ["freckles", "dimples", "high cheekbones", "a strong jawline", "a soft jawline", "a broad nose", "a narrow nose",
           "full lips", "thin lips", "deep-set eyes", "hooded eyelids", "wide-set eyes", "a slightly crooked nose",
           "a cleft chin", "prominent ears", "laugh lines", "almond eyes", "a rounded nose tip"]
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
        f"Black and white photographic close-up portrait of {who}, an ordinary, good-looking, one-of-a-kind person, "
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


class _Looks:
    """Deals individual features from shuffled decks, so every description differs from every other."""

    def __init__(self, rng: random.Random, seen: set | None = None):
        self.rng, self.decks, self.seen = rng, {}, set(seen or ())

    def _card(self, name: str, values: list) -> str:
        d = self.decks.setdefault(name, [])
        if not d:
            d += values
            self.rng.shuffle(d)
        return d.pop()

    def who(self, gender: str, look: str, age: str) -> str:
        noun = "woman" if gender == "Woman" else "man"
        for _ in range(50):
            years = self.rng.randint(*AGE_SPAN[age])
            art = "an" if str(years).startswith("8") or years in (11, 18) else "a"
            style = self._card("hair" + gender, HAIR[gender])
            if style != "a shaved head":
                style = f"{style} ({self._card('tone', HAIR_TONE)})"
            parts = [self._card("shape", FACE_SHAPE), style, self._card("brows", BROWS), self._card("eyes", EYES),
                     self._card("nose", NOSE), self._card("feature", FEATURE)]
            if gender == "Man":
                parts.insert(2, self._card("beard", FACIAL_HAIR))
            text = f"{art} {years}-year-old {look} {noun} with {', '.join(parts[:-1])} and {parts[-1]}"
            if text not in self.seen:
                self.seen.add(text)
                return text
        raise RuntimeError("could not find a new description")


def build(pieces: list[dict], seed: int) -> list[dict]:
    """Manifest entries for a planned collection (generate.plan output)."""
    rng = random.Random(seed ^ 0x9E3779B9)
    looks_ = _Looks(random.Random(seed ^ 0x51ED))
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
            who = looks_.who(gender, look, age)
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
            who = looks_.who(genders[i], looks[i], ages[i])
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
        if e["id"].startswith(("pool", "spare")) and not e.get("exclude"):
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
    """Write through a temporary file and retry: Windows can hold the file for a moment (indexer, antivirus)."""
    import time
    tmp = MANIFEST.with_suffix(".tmp")
    tmp.write_text(json.dumps(manifest, indent=1))
    for attempt in range(20):
        try:
            tmp.replace(MANIFEST)
            return
        except OSError:
            time.sleep(0.25 * (attempt + 1))
    raise OSError(f"could not write {MANIFEST}")


# --------------------------------------------------------------------------
# Generation through an API (the key comes from the environment or art/.env, never from the code)
# --------------------------------------------------------------------------
BACKENDS = {
    "muapi": ("MUAPI_API_KEY", "z-image-turbo"),
    "pollinations": ("POLLINATIONS_KEY", "tongyi-mai/z-image-turbo"),
}


def _key(name: str) -> str:
    import os
    if os.environ.get(name):
        return os.environ[name]
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            k, _, v = line.partition("=")
            if k.strip() == name and v.strip():
                return v.strip().strip('"').strip("'")
    sys.exit(f"{name} is not set: put {name}=... in art/.env (git-ignored) or in the environment")


def _http(method: str, url: str, headers: dict, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={**headers, "Content-Type": "application/json", "User-Agent": "neonfaces-art"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def _generate_one(backend: str, key: str, prompt_: str) -> tuple[str, str | None, bytes | None]:
    """(job id, image url or None, image bytes or None)."""
    import time
    if backend == "muapi":
        h = {"x-api-key": key}
        job = _http("POST", "https://api.muapi.ai/api/v1/z-image-turbo", h, {"prompt": prompt_, "width": 1024, "height": 1024})
        rid = job["request_id"]
        for _ in range(180):
            time.sleep(2)
            res = _http("GET", f"https://api.muapi.ai/api/v1/predictions/{rid}/result", h)
            if res.get("status") == "completed":
                out = res["outputs"][0]
                return rid, out if isinstance(out, str) else out.get("url"), None
            if res.get("status") == "failed":
                raise RuntimeError(f"muapi {rid} failed: {res.get('error')}")
        raise TimeoutError(f"muapi {rid} still running")
    if backend == "pollinations":
        import base64
        res = _http("POST", "https://gen.pollinations.ai/v1/images/generations", {"Authorization": f"Bearer {key}"},
                    {"model": BACKENDS[backend][1], "prompt": prompt_, "size": "1024x1024"})
        item = res["data"][0]
        raw = base64.b64decode(item["b64_json"]) if item.get("b64_json") else None
        return res.get("id", "pollinations"), item.get("url"), raw
    raise ValueError(backend)


def _store(e: dict, url: str | None, raw: bytes | None) -> None:
    """Keep the portrait at the resolution the pipeline samples (512 px grayscale) + the hash of the original."""
    import io
    from PIL import Image
    if raw is None:
        raw = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "neonfaces-art"}), timeout=120).read()
    e["sha256"] = hashlib.sha256(raw).hexdigest()
    Image.open(io.BytesIO(raw)).convert("L").resize((512, 512), Image.LANCZOS).save(DIR / f"{e['id']}.png", optimize=True)


def generate(ids: list[str] | None, limit: int, backend: str, workers: int = 4) -> None:
    import threading
    from concurrent.futures import ThreadPoolExecutor
    key = _key(BACKENDS[backend][0])
    manifest = load()
    todo = [e for e in manifest if (ids is None and not (DIR / f"{e['id']}.png").exists()) or (ids and e["id"] in ids)]
    todo = todo[:limit]
    lock = threading.Lock()
    done, failed = 0, []

    def one(e):
        nonlocal done
        try:
            job, url, raw = _generate_one(backend, key, e["prompt"])
            _store(e, url, raw)
            with lock:
                e.update({"job": job, "url": url, "model": BACKENDS[backend][1], "backend": backend})
                save(manifest)
                done += 1
                print(f"  {e['id']}  ({done}/{len(todo)})", flush=True)
        except Exception as err:  # keep going; failed ones are retried on the next run
            with lock:
                failed.append(e["id"])
                print(f"  {e['id']} failed: {err}", flush=True)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(one, todo))
    print(f"generated {done}, failed {len(failed)}: {failed[:20]}")


# --------------------------------------------------------------------------
# Different people: SFace identity check + new descriptions for look-alikes
# --------------------------------------------------------------------------
def identities(ids: list[str] | None = None) -> tuple[list[str], "np.ndarray"]:
    """Identity embeddings of the portraits on disk, cached by image hash in portraits/identity.npy."""
    import numpy as np
    sys.path.insert(0, str(ROOT))
    from neonfaces.photo import detect, identity, load_portrait
    cache_f = DIR / "identity.npy"
    cache = dict(np.load(cache_f, allow_pickle=True).item()) if cache_f.exists() else {}
    out_ids, vecs = [], []
    for e in load():
        f = DIR / f"{e['id']}.png"
        if not f.exists() or (ids and e["id"] not in ids):
            continue
        h = hashlib.sha256(f.read_bytes()).hexdigest()
        if h not in cache:
            lum = load_portrait(f)
            cache[h] = identity(lum, detect(lum))
        if cache[h] is None:
            print(f"  no face found in {e['id']}")
            continue
        out_ids.append(e["id"])
        vecs.append(cache[h])
    np.save(cache_f, cache, allow_pickle=True)
    return out_ids, np.array(vecs)


def lookalikes(thr: float, only: str | None = None) -> list[tuple[float, str, str]]:
    """Pairs at or above `thr`; `only="set"` compares the set faces among themselves."""
    import numpy as np
    ids, E = identities()
    if only:
        keep = [i for i, x in enumerate(ids) if x.startswith(only)]
        ids, E = [ids[i] for i in keep], E[keep]
    m = E @ E.T
    np.fill_diagonal(m, -1)
    iu = np.argwhere(np.triu(m >= thr, 1))
    return sorted(((float(m[i, j]), ids[i], ids[j]) for i, j in iu), reverse=True)


def redescribe(e: dict, taken: set, round_: int) -> None:
    """A new person for the same slot: same gender, background, age band, light and expression."""
    rng = random.Random(f"{e['id']}/{round_}")
    who = _Looks(rng, taken).who(e["gender"], e["look"], e["age"])
    e["prompt"] = prompt(who, e["light"], e["expression"])
    e["replaced"] = e.get("replaced", 0) + 1
    for k in ("job", "url", "sha256"):
        e.pop(k, None)
    f = DIR / f"{e['id']}.png"
    if f.exists():
        (DIR / "replaced").mkdir(exist_ok=True)
        f.replace(DIR / "replaced" / f"{e['id']}-{e['replaced']}.png")


def diversify(thr: float, rounds: int, backend: str, only: str | None = None) -> None:
    """Until no two portraits look like the same person: give a new description to one face of each look-alike
    pair and generate it again. Faces that resemble many others go first (one new face can clear several pairs);
    otherwise the later id changes."""
    for r in range(1, rounds + 1):
        pairs = lookalikes(thr, only)
        print(f"round {r}: {len(pairs)} look-alike pairs at or above {thr}{' among ' + only + ' faces' if only else ''}")
        if not pairs:
            return
        order = {e["id"]: i for i, e in enumerate(load())}
        degree = defaultdict(int)
        for _, a, b in pairs:
            degree[a] += 1
            degree[b] += 1
        redo, cleared = [], set()
        for _, a, b in pairs:  # greedy cover: the face in more pairs, else the later one
            if (a, b) in cleared or a in redo or b in redo:
                continue
            pick = max((a, b), key=lambda x: (degree[x], order[x]))
            redo.append(pick)
        redo.sort(key=order.get)
        manifest = load()
        taken = {e["prompt"] for e in manifest}
        by_id = {e["id"]: e for e in manifest}
        for pid in redo:
            redescribe(by_id[pid], taken, r)
            taken.add(by_id[pid]["prompt"])
        save(manifest)
        generate(redo, len(redo), backend)
    print("stopped after the last round: check `python portraits.py similar` by eye")


def budget_pool(per_portrait: int, max_new: int) -> None:
    """Singles on a budget: every earlier take of a set face (set aside by `diversify`, already paid) becomes a
    `spare-*` portrait for single close-ups, and only the portraits still missing to give each (light, expression)
    group about `per_portrait` crops per person are planned as new `pool-*` entries."""
    sys.path.insert(0, str(ROOT))
    from generate import MASTER_SEED, plan
    from neonfaces.traits import SUPPLY
    manifest = load()
    by_id = {e["id"]: e for e in manifest}
    # 1. adopt the earlier takes
    spare = DIR / "replaced"
    for f in sorted(spare.glob("set-*.png")) if spare.exists() else []:
        slot = "-".join(f.stem.split("-")[:2])
        e = by_id[slot]
        sid = "spare-" + f.stem[len("set-"):]
        f.replace(DIR / f"{sid}.png")
        manifest.append({"id": sid, "light": e["light"], "expression": e["expression"], "gender": e["gender"],
                         "look": e["look"], "age": e["age"], "source": slot,
                         "prompt": f"an earlier take for {slot} (too close to another set face), reused for single close-ups"})
    # 2. drop planned pool portraits that were never generated, then plan only what is missing
    manifest = [e for e in manifest if not (e["id"].startswith("pool") and not (DIR / f"{e['id']}.png").exists())]
    need = defaultdict(int)
    for piece in plan(SUPPLY, MASTER_SEED):
        if "set" not in piece:
            need[("top" if piece["traits"]["Light"] == "Top" else "side", piece["traits"]["Expression"])] += 1
    have = defaultdict(int)
    for e in manifest:
        if e["id"].startswith(("pool", "spare")):
            have[(e["light"], e["expression"])] += 1
    missing = {b: max(0, math.ceil(n / per_portrait) - have[b]) for b, n in need.items()}
    if sum(missing.values()) > max_new:
        sys.exit(f"{sum(missing.values())} new portraits needed at {per_portrait} per person, over the cap of {max_new}")
    rng = random.Random(MASTER_SEED ^ 0xB0D6E7)
    looks_ = _Looks(random.Random(MASTER_SEED ^ 0x5EED), {e["prompt"] for e in manifest})
    k = 1 + max([int(e["id"].split("-")[1]) for e in manifest if e["id"].startswith("pool")] or [-1])
    for (light, expression), m in sorted(missing.items()):
        genders = _deck({"Woman": 1, "Man": 1}, m, rng)
        looks = _deck({x: 1 for x in LOOKS}, m, rng)
        ages = _deck(AGES, m, rng)
        for i in range(m):
            who = looks_.who(genders[i], looks[i], ages[i])
            manifest.append({"id": f"pool-{k}", "light": light, "expression": expression, "gender": genders[i],
                             "look": looks[i], "age": ages[i], "prompt": prompt(who, light, expression)})
            k += 1
    save(manifest)
    total = sum(1 for e in manifest if e["id"].startswith(("pool", "spare")))
    print(f"singles: {sum(need.values())} crops from {total} people ({sum(missing.values())} new to generate, "
          f"about ${sum(missing.values()) * 0.007:.2f} on MuAPI)")


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "status"
    DIR.mkdir(exist_ok=True)
    if cmd == "pool":  # portraits.py pool [per_portrait] [max_new]
        nums = [int(x) for x in sys.argv[2:] if x.isdigit()]
        budget_pool(nums[0] if nums else 4, nums[1] if len(nums) > 1 else 300)
    elif cmd == "plan":
        if any(e["id"].startswith("spare") for e in (load() if MANIFEST.exists() else [])) and "--force" not in sys.argv:
            sys.exit("the singles pool is budgeted (spare-* portraits): `plan --force` would plan it again from scratch")
        sys.path.insert(0, str(ROOT))
        from generate import MASTER_SEED, plan
        from neonfaces.traits import SUPPLY
        old = {e["id"]: e for e in load()} if MANIFEST.exists() else {}
        manifest = build(plan(SUPPLY, MASTER_SEED), MASTER_SEED)
        for e in manifest:  # keep generation records of portraits whose prompt did not change
            o = old.get(e["id"])
            if o and o["prompt"] == e["prompt"]:
                e.update({k: o[k] for k in ("job", "url", "sha256", "model", "backend") if k in o})
            elif (DIR / f"{e['id']}.png").exists():  # made from an older prompt: set aside, generate again
                (DIR / "replaced").mkdir(exist_ok=True)
                (DIR / f"{e['id']}.png").replace(DIR / "replaced" / f"{e['id']}.png")
        save(manifest)
        sets = sum(1 for e in manifest if "set" in e)
        print(f"{len(manifest)} portraits: {sets} sets + {len(manifest) - sets} pool")
    elif cmd == "todo":
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 12
        todo = [e for e in load() if "job" not in e][:n]
        print(json.dumps([{"id": e["id"], "prompt": e["prompt"]} for e in todo], indent=1))
    elif cmd == "generate":  # portraits.py generate [n] [--backend muapi|pollinations] [--ids a,b]
        args = sys.argv[2:]
        backend = args[args.index("--backend") + 1] if "--backend" in args else "muapi"
        ids = args[args.index("--ids") + 1].split(",") if "--ids" in args else None
        workers = int(args[args.index("--workers") + 1]) if "--workers" in args else 4
        if "--workers" in args:
            args = [x for i, x in enumerate(args) if i != args.index("--workers") + 1]
        n = next((int(x) for x in args if x.isdigit()), 10_000)
        generate(ids, n, backend, workers)
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
    elif cmd == "diversify":  # portraits.py diversify [threshold] [rounds] [--sets] [--backend muapi|pollinations]
        args = sys.argv[2:]
        backend = args[args.index("--backend") + 1] if "--backend" in args else "muapi"
        nums = [x for x in args if x.replace(".", "", 1).isdigit()]
        only = "set" if "--sets" in args else None
        diversify(float(nums[0]) if nums else (0.75 if only else 0.85), int(nums[1]) if len(nums) > 1 else 6, backend, only)
    elif cmd == "similar":  # portraits.py similar [threshold]: pairs of faces that look too much alike
        sys.path.insert(0, str(ROOT))
        import numpy as np
        from PIL import Image
        from neonfaces.photo import SFACE, _bilinear, detect, identity, landmarks, load_portrait
        # with SFace: identity embeddings (same person scores high whatever the light); without: aligned pixels
        use_id = SFACE.exists()
        thr = float(sys.argv[2]) if len(sys.argv) > 2 else (0.65 if use_id else 0.90)
        ids, vecs = [], []
        t = np.linspace(-0.8, 0.8, 32)
        gx, gy = np.meshgrid(t * 0.9, t + 0.45)  # eyes to chin, aligned on the eye line
        for e in load():
            f = DIR / f"{e['id']}.png"
            if not f.exists():
                continue
            lum = load_portrait(f)
            if use_id:
                v = identity(lum, detect(lum))
                if v is not None:
                    ids.append(e["id"])
                    vecs.append(v)
                    continue
                print(f"  no face found in {e['id']}: regenerate it")
                continue
            lm = landmarks(lum)
            v = _bilinear(lum, lm["cx"] + gx * lm["unit"], lm["eye_y"] + gy * lm["unit"])
            # keep the features, drop the broad lighting: subtract a 7x7 box blur
            k = np.ones(7) / 7
            blur = np.apply_along_axis(lambda r: np.convolve(r, k, mode="same"), 0, v)
            blur = np.apply_along_axis(lambda r: np.convolve(r, k, mode="same"), 1, blur)
            v = (v - blur).ravel()
            v = v - v.mean()
            ids.append(e["id"])
            vecs.append(v / (np.linalg.norm(v) + 1e-9))
        m = np.array(vecs) @ np.array(vecs).T
        np.fill_diagonal(m, -1)
        pairs = sorted(((m[i, j], ids[i], ids[j]) for i in range(len(ids)) for j in range(i + 1, len(ids)) if m[i, j] >= thr),
                       reverse=True)
        for sc, a, b in pairs[:40]:
            print(f"{sc:.3f}  {a}  {b}")
        print(f"{len(pairs)} pairs at or above {thr} among {len(ids)} portraits (regenerate one of each)")
        if pairs:
            tsz = 128
            sheet = Image.new("L", (2 * tsz, min(len(pairs), 20) * tsz))
            for k, (_, a, b) in enumerate(pairs[:20]):
                for c, pid in enumerate((a, b)):
                    sheet.paste(Image.open(DIR / f"{pid}.png").convert("L").resize((tsz, tsz)), (c * tsz, k * tsz))
            sheet.save(DIR / "similar.png")
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
