"""The Wall of Wed 30 Sep, 10:00 (the founder's idea): two people of the collection, #286 and #198, on an ordinary
day, while a woman asks a child about a dream job; in the evening they close in on 18:00 UTC, the mint, and at
18:00 their own Faces are on their screens; then the collection's details on the beat. One minute, on our own
track (music-wall10, built on the founder's reference: a quiet start for the voices, a lift at 26 s, a near
silence before the drop at 48 s) and our own voices (gen_voice.py). The music sits lower in the last 15 s.

    python marketing/movement/make_wall10.py        # -> out/l-wall10.mp4 + -4x5.mp4
"""
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1] / "art")]
import make_cut as mc  # noqa: E402
import make_launch as ml  # noqa: E402

FPS, W, H = mc.FPS, mc.W, mc.H
VOICE = HERE / "raw" / "voice"
# the lines: (file, from, to in the file, at in the video, subtitle); a1 keeps its "Uh..." and loses the long pause
LINES = [("q1", 0.0, 1.5, 4.7, "WHAT'S YOUR DREAM JOB?"),
         ("q2", 3.5, None, 9.0, "WHAT DO YOU WANNA DO WHEN YOU GROW UP?"),
         ("a1", 0.0, 0.75, 13.1, "UH... I'M GONNA BE A DOCTOR."),
         ("a1", 4.5, None, 14.2, None),
         ("q3", 0.0, None, 17.6, "HOW MUCH DO YOU WANNA MAKE?"),
         ("a2", 0.0, None, 22.1, "I'M GONNA MAKE PEOPLE FEEL OKAY.")]
SUB_HOLD = 3.2  # a subtitle stays on this long (or until the next shot)


def level(src, peak=-8.0):
    """The gain that brings a voice line's peak to `peak` dB (the lines came out between -15 and -26 dB)."""
    out = subprocess.run(["ffmpeg", "-i", str(src), "-af", "volumedetect", "-f", "null", "-"], capture_output=True,
                         text=True).stderr
    return round(10 ** ((peak - float(re.search(r"max_volume: (-?[0-9.]+) dB", out).group(1))) / 20), 3)


def slow(cid, a, b, dur, subs=(), z=0.05, at=0.0):
    """A clip's [a, b] stretched to `dur` by blending frames (no stutter), a slow push-in, subtitles by time."""
    fr = mc.clip_frames(cid, a, b).astype(np.float32)
    n = int(round(dur * FPS))
    for i in range(n):
        pos = i * (len(fr) - 1) / max(1, n - 1)
        k, e = int(pos), pos - int(pos)
        f = fr[k] * (1 - e) + fr[min(k + 1, len(fr) - 1)] * e
        f = mc.drift(np.clip(f, 0, 255).astype(np.uint8), i, n, z)
        yield mc.with_caption(f, sub_at(subs, at + i / FPS))


def still(shot, dur, focus, z1, subs=(), at=0.0):
    for i, f in enumerate(mc.ots(shot, dur, z1=z1, focus=focus)):
        yield mc.with_caption(f, sub_at(subs, at + i / FPS))


def sub_at(subs, t):
    for t0, t1, text in subs:
        if t0 <= t < t1:
            return text
    return None


def ticking(dur, stamps):
    """Black, and a clock in the pixel font: 17:59:57, 58, 59 (the near silence before the drop)."""
    n = int(round(dur * FPS))
    for i in range(n):
        im = Image.new("RGB", (W, H), mc.INK)
        s = stamps[min(len(stamps) - 1, int(i / n * len(stamps)))]
        mc.draw_text(im, s, W // 2, H // 2 - 60, 14, mc.NEON, "center")
        mc.draw_text(im, "UTC", W // 2, H // 2 + 110, 7, mc.PALE, "center")
        yield mc.finish(np.asarray(im), i, art=True)


def flashed(gen, frames=2):
    for i, f in enumerate(gen):
        yield mc.flash(f) if i < frames else f


def fade_out(gen, n, last):
    for i, f in enumerate(gen):
        k = n - 1 - i
        yield (f.astype(np.float32) * min(1.0, k / last)).astype(np.uint8) if k < last else f


def piece():
    subs = []
    for _, _, _, at, text in LINES:
        if text:
            subs.append([at, at + SUB_HOLD, text])
    for k in range(len(subs) - 1):
        subs[k][1] = min(subs[k][1], subs[k + 1][0])

    lime = (0.5, 0.42)
    NEON, PALE = mc.NEON, mc.PALE
    seq = [
        # the eye opens it, in near silence
        (4.0, lambda: slow("d-eye", 0.0, 4.09, 4.0, z=0.06)),
        # an ordinary day, and the questions
        (4.5, lambda: slow("d-m1", 0.0, 4.09, 4.5, subs, at=4.0)),
        (4.0, lambda: slow("v5-a", 0.5, 4.5, 4.0, subs, at=8.5)),
        (4.5, lambda: still("d-m2", 4.5, lime, 1.12, subs, at=12.5)),
        (4.5, lambda: slow("v5-b", 0.3, 4.8, 4.5, subs, at=17.0)),
        (4.5, lambda: slow("v1-b", 0.4, 5.0, 4.5, subs, at=21.5)),
        # 26 s, the lift: the evening, closing in on 18:00 UTC
        (4.3, lambda: flashed(slow("v2-b", 0.0, 4.3, 4.3, [(0, 99, "THURSDAY.")], at=0))),
        (4.05, lambda: flashed(slow("s-windows", 0.5, 4.55, 4.05, [(0, 99, "17:45 UTC.")], at=0))),
        (3.45, lambda: flashed(slow("v4-d", 0.3, 3.75, 3.45, [(0, 99, "17:55 UTC.")], at=0))),
        (3.7, lambda: flashed(slow("d-w1", 1.55, 4.09, 3.7, [(0, 99, "17:58 UTC.")], at=0))),
        (4.0, lambda: flashed(slow("v3-a", 0.0, 4.6, 4.0, [(0, 99, "17:59 UTC.")], at=0))),
        # the near silence
        (1.95, lambda: ticking(1.95, ["17:59:57", "17:59:58", "17:59:59"])),
        # 18:00 UTC: their Faces on their screens
        (1.45, lambda: flashed(mc.ots("h3", 1.45, z1=1.35, text="18:00 UTC."), 3)),
        (1.4, lambda: flashed(mc.ots("d-w1o", 1.4, z1=1.3, focus=(0.8, 0.44), text="18:00 UTC."), 2)),
        # the collection, on the beat
        (1.9, lambda: ml.counter(1.9, "5555 FACES.")),
        (2.2, lambda: ml.cards([(2.2, [("THURSDAY", 12, NEON), ("1 OCTOBER", 12, NEON), ("", 4, PALE),
                                      ("18:00 UTC", 9, NEON), ("ON OPENSEA", 7, PALE)])], seed=41)),
        (2.1, lambda: ml.cards([(2.1, [("THE LIST FIRST", 9, NEON), ("24 HOURS, 0.013 ETH", 6, PALE), ("", 4, PALE),
                                      ("THEN EVERYONE", 9, NEON), ("FROM FRIDAY, 0.018 ETH", 6, PALE)])], seed=42)),
        # posted the day before the wallet check opens (the founder: remind them it is tomorrow, on the site)
        (2.5, lambda: ml.cards([(2.5, [("ON THE LIST?", 9, NEON), ("", 4, PALE), ("CHECK YOUR WALLET", 7, PALE),
                                      ("", 2, PALE), ("TOMORROW, 08:00 UTC", 8, NEON), ("", 3, PALE),
                                      ("ON NEONFACES.XYZ", 7, PALE)])], seed=43)),
        (2.6, lambda: fade_out(ml.the_eye(2.6, "ONE OF THEM IS LOOKING AT YOU."), int(round(2.6 * FPS)), 20)),
    ]
    total = sum(d for d, _ in seq)
    track = mc.music("wall10")
    # the music: full until 45 s, then lower under the mint and the details (the founder: the last 15 s)
    gain = ["0.95", "(1-0.4*max(0,min(1,(t-46.0)/1.5)))"]
    voices = []
    for f, a, b, at, _ in LINES:
        src = VOICE / f"{f}.wav"
        b = mc.track_len(src) if b is None else b
        voices.append((src, a, b, at, level(src), 0.02, 0.12))
        # the music steps back under each line (it rises from 12 s, and the answers are soft)
        x0, x1 = at - 0.2, at + (b - a) + 0.25
        gain.append(f"(1-0.45*max(0,min(1,min((t-{x0:.2f})/0.2+1,({x1:.2f}-t)/0.3+1))))")
    sounds = [(track, 0.0, min(total, mc.track_len(track)), 0.0, "*".join(gain), 0.05, 1.2)] + voices
    # each real shot keeps a little of its own sound (the eye's hum, the moka, the train, the rain)
    t = 0.0
    own = {0: ("d-eye", 0.0), 1: ("d-m1", 0.0), 6: ("v2-b", 0.0), 8: ("v4-d", 0.3), 9: ("d-w1", 1.55), 10: ("v3-a", 0.0)}
    for k, (d, _) in enumerate(seq):
        if k in own:
            cid, a = own[k]
            sounds.append((mc.raw(cid), a, a + min(d, 4.0), t, 0.35 if k < 6 else 0.25, 0.15, 0.3))
        t += d
    # the eye at the end: the music is over, only a neon's buzz (the N2 score's steady tail), fading with the picture
    sounds.append((mc.music("n2"), 15.0, 17.5, total - 2.6, 0.45, 0.8, 1.0))
    return seq, sounds


mc.VIDEOS["l-wall10"] = piece

if __name__ == "__main__":
    mc.render("l-wall10")
