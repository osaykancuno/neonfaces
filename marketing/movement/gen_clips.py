"""Clips for the movement: each front still (raw/<id>.png) comes alive on Higgsfield with the CLI.

    python marketing/movement/gen_clips.py              # every clip not in raw/ yet
    python marketing/movement/gen_clips.py v1-a v5-c    # only these (generated again)

Seedance 2.0 Mini, 720p, 9:16, start frame = the still, native sound with no voice; 1 credit per second.
Prompts are in clips.json (motion + sound + the common tail: the screen never faces the camera).
"""
import json
import shutil
import subprocess
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLI = shutil.which("higgsfield")


def run(cfg: dict, c: dict) -> str:
    out = HERE / "raw" / f"{c['id']}.mp4"
    text = " ".join([c["motion"], cfg["tail"], "Sound: " + c["sound"]])
    cmd = [CLI, "generate", "create", "seedance_2_0_mini", "--prompt", text,
           "--start-image", str(HERE / "raw" / f"{c['id']}.png"), "--duration", str(c["duration"]),
           "--resolution", "720p", "--aspect_ratio", "9:16", "--generate_audio", "true",
           "--wait", "--wait-timeout", "30m", "--json"]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        return f"{c['id']}: FAILED {(r.stderr or r.stdout).strip()[:300]}"
    job = json.loads(r.stdout)[0]
    if job.get("status") != "completed" or not job.get("result_url"):
        return f"{c['id']}: {job.get('status')} {r.stdout[:300]}"
    urllib.request.urlretrieve(job["result_url"], out)
    return f"{c['id']}: raw/{out.name} job {job['id']}"


def main() -> None:
    ids = sys.argv[1:]
    cfg = json.loads((HERE / "clips.json").read_text(encoding="utf-8"))
    if ids:
        todo = [c for c in cfg["clips"] if c["id"] in ids]
    else:
        todo = [c for c in cfg["clips"] if not (HERE / "raw" / f"{c['id']}.mp4").exists()]
    with ThreadPoolExecutor(2) as pool:  # the starter plan runs 2 jobs at once
        for line in pool.map(lambda c: run(cfg, c), todo):
            print(line, flush=True)


if __name__ == "__main__":
    main()
