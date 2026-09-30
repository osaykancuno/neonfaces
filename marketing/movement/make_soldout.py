"""Sold out (the founder, 30 Sep): the adventure has just begun. One calm female voice all the way (the teasers' brand
voice, one take: gen_voice.py "so"), our look: the eye, the count, SOLD OUT, the tribe, what a Face is (on the chain, a
wallet, the Gaze), the reveal next; then we enter the NEON dimension: at dawn #198 watches the city light up in lime,
the world falls into NEONCAM's cells, #286 turns to us, "Let's NEON the world together." Track music-soldout.

    python marketing/movement/make_soldout.py        # -> out/l-soldout.mp4 + -4x5.mp4
"""
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1] / "art")]
import make_cut as mc  # noqa: E402
import make_launch as ml  # noqa: E402
from make_wall10 import fade_out, flashed, level, slow, sub_at  # noqa: E402

FPS, W, H = mc.FPS, mc.W, mc.H
V = HERE / "raw" / "voice"
# the take (so) and its last sentence again (so-end: the take was cut off inside "together"; made with a piece of the take
# as the voice reference, so-ref.wav); each is compressed to ride over the drums (the raw take sat 10-12 dB under)
TAKES = {"so": V / "so.wav", "so-end": V / "so-end.wav"}
# the sentences: (from, to in the take, at in the video, subtitle); the last one comes from so-end
LINES = [(0.00, 0.95, 0.5, "THEY DON'T BLINK."),
         (2.00, 2.80, 1.8, "NEITHER DO WE."),
         (4.08, 6.05, 3.5, "EVERY FACE HAS FOUND ITS HOLDER."),
         (7.47, 9.28, 7.6, "WELCOME TO THE NEON TRIBE."),
         (11.53, 15.05, 11.0, "EVERY FACE LIVES ON THE CHAIN. NOTHING TO BREAK."),
         (16.11, 19.49, 14.9, "EVERY FACE IS A WALLET, WITH A SMALL BASKET INSIDE."),
         (20.52, 23.67, 18.6, "AND THE LONGER YOU HOLD IT, THE HARDER IT STARES."),
         (26.07, 27.85, 22.2, "NEXT, THE REVEAL."),
         (28.98, 32.52, 25.3, "EVERY FACE GETS ITS ART, FOR EVERYONE AT ONCE."),
         (34.41, 35.75, 29.6, "THIS IS ONLY THE BEGINNING."),
         (0.45, 2.30, 32.0, "LET'S NEON THE WORLD TOGETHER.")]
SOURCE = ["so"] * 10 + ["so-end"]
SUBS = [(at, at + (b - a) + 0.35, text) for a, b, at, text in LINES]


def subbed(gen, t0, y=1470):
    """Subtitles by time; y=420 (the top of the 4:5 frame) where the art has its own label at the bottom."""
    for i, f in enumerate(gen):
        yield mc.with_caption(f, sub_at(SUBS, t0 + i / FPS), y=y)


def neon_world(cid, a, b, dur, start, t0, cell=24):
    """The clip stretched to `dur`; from `start` (0-1 of the shot) a line rises from the bottom and everything below it
    falls into NEONCAM's cells and five tones: the world entering the NEON dimension."""
    for i, f in enumerate(slow(cid, a, b, dur, SUBS, z=0.06, at=t0)):
        p = i / max(1, int(round(dur * FPS)) - 1)
        if p > start:
            k = mc.ease((p - start) / (1 - start))
            small = cv2.resize(f, (W // cell, H // cell), interpolation=cv2.INTER_AREA).astype(np.float32)
            lum = small @ np.float32([0.2126, 0.7152, 0.0722])
            lo, hi = np.percentile(lum, [2, 99])
            v = np.clip((lum - lo) / max(24, hi - lo), 0, 1)
            toned = ml.CAM_PAL[np.searchsorted([0.20, 0.37, 0.55, 0.72], v, side="right")]
            cells = cv2.resize(toned, (W, H), interpolation=cv2.INTER_NEAREST)
            line = int(H * (1 - k))
            out = f.copy()
            out[line:] = cells[line:].astype(np.uint8)
            if 0 < line < H:
                out[max(0, line - 6):line] = mc.NEON  # the scan line
            f = mc.with_caption(out, sub_at(SUBS, t0 + i / FPS))
        yield f


def voice(name):
    """The take compressed (cached next to it as <name>-c.wav)."""
    src, out = TAKES[name], V / f"{name}-c.wav"
    if not out.exists() or out.stat().st_mtime < src.stat().st_mtime:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af",
                        "highpass=f=90,acompressor=threshold=-26dB:ratio=4:attack=5:release=150:makeup=10,"
                        "alimiter=limit=0.89", str(out)], check=True)
    return out


def piece():
    NEON, PALE = mc.NEON, mc.PALE
    seq = [
        (3.2, lambda: subbed(mc.real("s-eye", 0.0, 3.2), 0.0)),
        (2.8, lambda: subbed(ml.counter(2.8, "5555 FACES."), 3.2)),
        (1.3, lambda: flashed(ml.cards([(1.3, [("SOLD", 20, NEON), ("OUT.", 20, NEON)])], seed=51), 3)),
        (3.5, lambda: subbed(ml.tiles(["n1-a", "n2-a", "n3-a", "n1-b", "t-a", "n2-c", "n3-b", "c-a", "n3-c"], 3.5), 7.3)),
        (3.9, lambda: subbed(ml.chain_draw(3.9), 10.8)),
        (3.7, lambda: subbed(mc.ots("h5", 3.7, z1=1.3), 14.7)),
        (3.6, lambda: subbed(mc.gaze("f198", 3.6), 18.4, y=420)),
        (1.0, lambda: subbed(ml.tier(1, "GLANCE", "4444", 1.0), 22.0, y=420)),
        (1.0, lambda: subbed(ml.tier(2, "WATCH", "833", 1.0), 23.0, y=420)),
        (1.0, lambda: subbed(ml.tier(3, "HEAVY STARE", "278", 1.0), 24.0, y=420)),
        # 25 s, the music opens: dawn, the city lights up, then the world falls into NEON
        (6.2, lambda: flashed(neon_world("so-dawn", 0.0, 5.04, 6.2, 0.68, 25.0), 3)),
        (3.2, lambda: flashed(slow("so-face", 1.2, 4.09, 3.2, SUBS, z=0.06, at=31.2), 2)),
        (2.4, lambda: ml.cards([(2.4, [("LET'S NEON", 12, NEON), ("THE WORLD", 12, NEON), ("TOGETHER.", 12, NEON),
                                      ("", 5, PALE), ("#NEONFACE  #NEONFAM", 6, PALE)])], seed=53)),
        # the signature ending: into the young woman's eye, as the video opened
        (4.2, lambda: ml.eye_close(4.2)),
    ]
    total = sum(d for d, _ in seq)
    track = mc.music("soldout")
    gain = ["0.8"]
    for a, b, at, _ in LINES:  # the music steps back under every sentence
        x0, x1 = at - 0.2, at + (b - a) + 0.25
        gain.append(f"(1-0.72*max(0,min(1,min((t-{x0:.2f})/0.25+1,({x1:.2f}-t)/0.35+1))))")
    sounds = [(track, 0.0, min(total, mc.track_len(track)), 0.0, "*".join(gain), 0.05, 1.5)]
    files = {k: voice(k) for k in TAKES}
    gains = {k: level(f, -2.0) for k, f in files.items()}
    sounds += [(files[k], max(0.0, a - 0.05), b + 0.1, at - 0.05 if a else at, gains[k], 0.03, 0.12)
               for k, (a, b, at, _) in zip(SOURCE, LINES)]
    # the real shots keep a little of their own sound
    sounds += [(mc.raw("s-eye"), 0.0, 3.2, 0.0, 0.3, 0.05, 0.3),
               (mc.raw("so-dawn"), 0.0, 5.04, 25.0, 0.3, 0.3, 0.6),
               (mc.raw("so-face"), 1.2, 4.09, 31.2, 0.25, 0.2, 0.4),
               (mc.raw("s-eye"), 1.8, 5.0, total - 4.2, 0.3, 0.3, 1.0),
               # the music rings out; a neon's buzz stays with the eye to the black (the N2 score's steady tail)
               (mc.music("n2"), 15.0, 17.5, total - 2.6, 0.4, 0.8, 1.0)]
    return seq, sounds


mc.VIDEOS["l-soldout"] = piece

if __name__ == "__main__":
    mc.render("l-soldout")
