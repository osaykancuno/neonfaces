"""Stills for the movement, generated on Higgsfield with the CLI (`higgsfield`, signed in), then the real Face put
on the screen of the over-the-shoulder ones.

    python marketing/movement/gen_frames.py              # every shot not in raw/ yet
    python marketing/movement/gen_frames.py v1-a h1      # only these (generated again)

Shots are in frames.json. Two kinds, because a person looking at a phone never shows its screen to the camera:
  front  the person in front, the phone's back to the camera, the screen's lime light on the face (start frames
         for the clips; they look up into the lens in the clip)
  ots    over the shoulder: the screen as the person sees it, generated flat lime (a green screen) and replaced
         by the exact Face or piece with make_frames.py -> frames/<id>.png
Model gpt_image_2_5, 9:16, reference = the set's source portrait; medium 1k (0.5 credits), "hero" shots high 2k
(2.75 credits; they are also the feed images).
"""
import json
import shutil
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
CLI = shutil.which("higgsfield")
sys.path.insert(0, str(HERE))
from make_frames import paste  # noqa: E402


def prompt(cfg: dict, s: dict) -> str:
    return " ".join([s["scene"], cfg[s["kind"]], s["light"], cfg["note"], cfg["style"]])


def run(cfg: dict, s: dict) -> str:
    raw = HERE / "raw" / f"{s['id']}.png"
    hero = s.get("hero", False)
    cmd = [CLI, "generate", "create", "gpt_image_2_5", "--prompt", prompt(cfg, s),
           "--image", str(HERE / "refs" / f"p{s['set']}.png"),
           "--quality", "high" if hero else "medium", "--resolution", "2k" if hero else "1k",
           "--aspect_ratio", "9:16", "--wait", "--wait-timeout", "15m", "--json"]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        return f"{s['id']}: FAILED {(r.stderr or r.stdout).strip()[:300]}"
    job = json.loads(r.stdout)[0]
    if job.get("status") != "completed" or not job.get("result_url"):
        return f"{s['id']}: {job.get('status')} {r.stdout[:300]}"
    urllib.request.urlretrieve(job["result_url"], raw)
    line = f"{s['id']}: raw/{raw.name} {Image.open(raw).size} job {job['id']}"
    if s["kind"] == "ots":
        try:
            (HERE / "frames").mkdir(exist_ok=True)
            paste(Image.open(raw), Image.open(HERE / "refs" / f"{s['screen']}.png")).save(HERE / "frames" / raw.name)
            line += f" -> frames/{raw.name}"
        except SystemExit as e:
            line += f" (no screen pasted: {e})"
    return line


def main() -> None:
    ids = sys.argv[1:]
    cfg = json.loads((HERE / "frames.json").read_text(encoding="utf-8"))
    if ids:
        todo = [s for s in cfg["shots"] if s["id"] in ids]
    else:
        todo = [s for s in cfg["shots"] if not (HERE / "raw" / f"{s['id']}.png").exists()]
    (HERE / "raw").mkdir(exist_ok=True)
    with ThreadPoolExecutor(2) as pool:  # the starter plan runs 2 jobs at once
        for line in pool.map(lambda s: run(cfg, s), todo):
            print(line, flush=True)


if __name__ == "__main__":
    main()
