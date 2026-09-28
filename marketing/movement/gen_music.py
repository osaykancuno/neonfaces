"""Instrumental beds for the second batch, generated on Higgsfield (Sonilo Music) with the CLI.

    python marketing/movement/gen_music.py            # every track not in raw/ yet
    python marketing/movement/gen_music.py n1 cam     # only these (generated again)

Prompts are in music.json (each track's prompt + the common tail: no voice, first hit on the first beat, mixed for
phone speakers). 0.0625 credits a second. -> raw/music-<id>.m4a, mixed under the clips' own sound by make_cut.py and
make_launch.py.
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


def run(cfg: dict, t: dict) -> str:
    out = HERE / "raw" / f"music-{t['id']}.m4a"
    cmd = [CLI, "generate", "create", "sonilo_music", "--prompt", t["prompt"] + " " + t.get("tail", cfg["tail"]),
           "--duration", str(t["duration"]), "--wait", "--wait-timeout", "20m", "--json"]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        return f"{t['id']}: FAILED {(r.stderr or r.stdout).strip()[:300]}"
    job = json.loads(r.stdout)[0]
    if job.get("status") != "completed" or not job.get("result_url"):
        return f"{t['id']}: {job.get('status')} {r.stdout[:300]}"
    urllib.request.urlretrieve(job["result_url"], out)
    return f"{t['id']}: raw/{out.name} job {job['id']}"


def main() -> None:
    ids = sys.argv[1:]
    cfg = json.loads((HERE / "music.json").read_text(encoding="utf-8"))
    if ids:
        todo = [t for t in cfg["tracks"] if t["id"] in ids]
    else:
        todo = [t for t in cfg["tracks"] if not (HERE / "raw" / f"music-{t['id']}.m4a").exists()]
    with ThreadPoolExecutor(2) as pool:  # the starter plan runs 2 jobs at once
        for line in pool.map(lambda t: run(cfg, t), todo):
            print(line, flush=True)


if __name__ == "__main__":
    main()
