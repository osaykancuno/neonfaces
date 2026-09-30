"""Spoken lines for the Wall of 30 Sep (the founder's idea: an interview about a dream job, a child answering, over
two ordinary days), generated with Seed Audio on Higgsfield; 0.1 credits a line. -> raw/voice/<id>.wav

    python marketing/movement/gen_voice.py            # every line not in raw/voice/ yet
    python marketing/movement/gen_voice.py q1 a1      # only these (generated again)
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
# Seed Audio is billed by the prompt's length (about 0.01 credits a character): q1 and a1 went out with longer
# descriptions (1.7 credits each); the rest with these short ones.
ASK = "Soft, warm woman's voice, home video, asking a child: "
KID = "A little child of seven, sweet and sincere: "
LINES = {
    "q1": ASK + "\"What's your dream job?\"",
    "q2": ASK + "\"What do you wanna do when you grow up?\"",
    "a1": KID + "\"Uh... I'm gonna be a doctor.\"",
    "q3": ASK + "\"How much do you wanna make?\"",
    "a2": KID + "\"I'm gonna make people feel okay.\"",
}


def run(key: str) -> str:
    out = HERE / "raw" / "voice" / f"{key}.wav"
    cmd = [CLI, "generate", "create", "seed_audio", "--prompt", LINES[key], "--format", "wav", "--sample_rate", "48000",
           "--wait", "--wait-timeout", "10m", "--json"]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    if r.returncode != 0:
        return f"{key}: FAILED {(r.stderr or r.stdout).strip()[:300]}"
    job = json.loads(r.stdout)[0]
    if job.get("status") != "completed" or not job.get("result_url"):
        return f"{key}: {job.get('status')} {r.stdout[:300]}"
    urllib.request.urlretrieve(job["result_url"], out)
    return f"{key}: raw/voice/{out.name} job {job['id']}"


def main() -> None:
    keys = sys.argv[1:] or [k for k in LINES if not (HERE / "raw" / "voice" / f"{k}.wav").exists()]
    (HERE / "raw" / "voice").mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(2) as pool:  # the starter plan runs 2 jobs at once
        for line in pool.map(run, keys):
            print(line, flush=True)


if __name__ == "__main__":
    main()
