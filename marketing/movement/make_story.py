"""NEONFACES, the story: one minute (9:16 1080x1920 + 4:5), every piece of the movement in one arc, ending on the
site. No date, no price: "COMING SOON".

    python marketing/movement/make_story.py      -> out/story.mp4, out/story-4x5.mp4

Needs the movement's clips and stills (gen_frames.py, gen_clips.py), raw/s-eye.mp4, raw/s-windows.mp4 and
raw/music.* (Sonilo Music, 60 s, instrumental).

The arc
  hook       an eye that doesn't blink, the lime of a screen in its pupil; "They don't blink." on the first second
             (2.2 s: the Virality Predictor saw attention dip in seconds 1-3 of a 3.5 s eye; 53 / 35 / 100% on 15.5 s)
  the world  people looking at their phones at every hour: tram, rain, 5:50 am, the metro, 2 am, a rooftop
  the turn   some screens stare back: over the shoulder her Face is on her screen; her face becomes her Face
  inside     look closer: into his screen, into the Face; a small piece of the market inside
  the set    5555 Faces on the chain; some are one of four; the Gaze grows with patience
  the end    a building full of lime windows, "Someone has to keep watching."; the card, NEONFACES.XYZ, COMING SOON
Hook rules (marketing/teasers/PROMPTS.md): motion, a hit and the voice on the first frame, bright from the first
second, captions on every line for muted autoplay.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import make_cut as C  # noqa: E402

W, H, FPS = C.W, C.H, C.FPS
T1, T2, T3, T5 = C.T1, C.T2, C.T3, C.T5
MUSIC = next((p for p in HERE.glob("raw/music.*") if p.suffix != ".json"), None)


def captions(gen, caps):
    """caps: [(from second, text)] inside one segment."""
    for i, fr in enumerate(gen):
        t = i / FPS
        text = None
        for start, line in caps:
            if t >= start:
                text = line
        yield C.with_caption(fr, text)


def bright(gen, until=2.0, gain=1.25):
    """The first seconds a little brighter (autoplay opens muted and small)."""
    for i, fr in enumerate(gen):
        if i / FPS < until:
            k = 1 + (gain - 1) * (1 - i / (until * FPS))
            fr = np.clip(fr.astype(np.float32) * k, 0, 255).astype(np.uint8)
        yield fr


def card(face, dur):
    base = Image.new("RGB", (W, H), C.INK)
    d = ImageDraw.Draw(base)
    for k in range(6):
        d.rectangle([60 + k, 400 + k, W - 61 - k, H - 401 - k], outline=C.NEON)
    base.paste(C.face_img(face, 520), ((W - 520) // 2, 460))
    C.draw_text(base, "NEONFACES", W // 2, 1030, 14, C.NEON, "center")
    C.draw_text(base, "NEONFACES.XYZ", W // 2, 1190, 8, C.PALE, "center")
    C.draw_text(base, "COMING SOON", W // 2, 1300, 6, C.DIM, "center")
    dark = Image.eval(base, lambda v: v // 6)
    flick = [0, 1, 0, 0, 1, 1, 0, 1]
    for i in range(int(round(dur * FPS))):
        fr = base if i >= len(flick) or flick[i] else dark
        yield C.finish(np.asarray(fr), i, art=True)


def pieces(dur_each=0.6):
    for p in ["p1", "p2", "p3", "p4"]:
        yield from C.ots(p, dur_each, z1=1.05, text="SOME ARE ONE OF FOUR.")


def gaze_short(face, dur):
    """Steady, Fixed, Piercing only (the no-Gaze level is skipped: the story has no time for it)."""
    frames = list(C.gaze(face, 4.8))
    per = len(frames) // 4
    keep = frames[per:]
    n = int(round(dur * FPS))
    for i in range(n):
        yield keep[min(len(keep) - 1, int(i * len(keep) / n))]


def parts():
    return [
        (2.2, lambda: bright(captions(C.real("s-eye", 0.0, 2.2), [(0.0, "THEY DON'T BLINK.")]))),
        (3.0, lambda: C.real("v1-a", 1.2, 4.2, "EVERYONE HAS A SCREEN.")),
        (2.5, lambda: C.real("v1-b", 2.3, 4.8, "EVERYONE HAS A SCREEN.")),
        (2.5, lambda: C.real("v2-a", 0.5, 3.0, "5:50 AM.")),
        (2.5, lambda: C.real("v2-b", 0.6, 3.1, "11 PM.")),
        (3.0, lambda: captions(C.real("v2-c", 1.8, 4.8), [(0.0, "2 AM."), (0.9, "THE MARKET NEVER CLOSES.")])),
        (2.5, lambda: C.real("v4-c", 1.0, 3.5, "NEITHER DO THEY.")),
        (3.0, lambda: C.ots("h1", 3.0, text="SOME SCREENS STARE BACK.")),
        (3.0, lambda: C.real("v1-c", 0.2, 3.2)),
        (3.0, lambda: C.turn("v1-c", 3.3, "f419", 3.0, "5555 FACES. EACH ONE SOMEONE.")),
        (3.0, lambda: C.real("v3-a", 0.8, 3.8, "LOOK CLOSER.")),
        (3.0, lambda: C.ots("h3", 3.0, text="EVERY FACE IS A WALLET.", into_screen=True)),
        (4.0, lambda: C.inside(4.0, "A SMALL PIECE OF THE MARKET INSIDE.")),
        (3.5, lambda: C.grid("f286", 3.5, "FULLY ON-CHAIN.", seed=286)),
        (2.4, lambda: pieces(0.6)),
        (3.0, lambda: C.assembly(3.0, "ONE FACE.")),
        (2.7, lambda: C.real("v5-c", 0.6, 3.3, "THE LONGER IT STAYS,")),
        (3.3, lambda: gaze_short("f198", 3.3)),
        (4.3, lambda: C.real("s-windows", 0.0, 4.3, "SOMEONE HAS TO KEEP WATCHING.")),
        (3.6, lambda: card("f419", 3.6)),
    ]


def sounds(starts):
    """starts: the start second of each part, in order. (file, from, to, at, volume, fade in, fade out)"""
    s = starts
    raw = C.raw
    out = [
        (T1, 0.0, 1.6, 0.0, 1.2, 0.0, 0.2),                    # zap, bass hit, "They don't blink."
        (raw("s-eye"), 0.0, 2.2, 0.0, 0.8, 0.0, 0.2),
        (raw("v1-a"), 1.2, 4.2, s[1], 0.7, 0.05, 0.1), (raw("v1-b"), 2.3, 4.8, s[2], 0.7, 0.05, 0.1),
        (raw("v2-a"), 0.5, 3.0, s[3], 0.7, 0.05, 0.1), (raw("v2-b"), 0.6, 3.1, s[4], 0.8, 0.05, 0.1),
        (raw("v2-c"), 1.8, 4.8, s[5], 0.7, 0.05, 0.1),
        (T3, 3.7, 5.3, s[5] + 0.8, 1.4, 0.05, 0.2),            # "The market never closes."
        (raw("v4-c"), 1.0, 3.5, s[6], 1.4, 0.05, 0.1),
        (raw("v1-a"), 0.0, 3.0, s[7], 0.5, 0.1, 0.2), (raw("v1-c"), 0.2, 3.2, s[8], 1.2, 0.05, 0.1),
        (T1, 0.0, 1.5, s[9], 0.9, 0.0, 0.3),                   # the hit that opens the turn
        (raw("v3-a"), 0.8, 3.8, s[10], 0.7, 0.05, 0.1),
        (T1, 6.1, 7.2, s[10] + 0.4, 1.3, 0.02, 0.2),            # "Look closer."
        (T1, 0.0, 1.0, s[12], 0.7, 0.0, 0.3),                   # through the screen
        (raw("v4-a"), 0.0, 0.6, s[14], 0.8, 0.02, 0.05), (raw("v4-b"), 0.0, 0.6, s[14] + 0.6, 0.8, 0.02, 0.05),
        (raw("v4-c"), 0.0, 0.6, s[14] + 1.2, 1.2, 0.02, 0.05), (raw("v4-d"), 0.0, 0.6, s[14] + 1.8, 0.8, 0.02, 0.05),
        (T1, 0.0, 1.2, s[15] + 1.6, 0.8, 0.0, 0.3),            # the click as the pieces lock
        (raw("v5-c"), 0.6, 3.3, s[16], 0.8, 0.05, 0.1),
        (T3, 5.2, 8.0, s[17], 1.5, 0.1, 0.4),                  # the bass pulse under the Gaze
        (raw("s-windows"), 0.0, 4.3, s[18], 0.9, 0.05, 0.1),
        (T2, 3.0, 4.9, s[18] + 1.2, 1.3, 0.02, 0.2),            # "Someone has to keep watching."
        (T5, 3.6, 7.9, s[19] + 0.1, 1.1, 0.02, 0.8),            # "They don't blink. Neither do I." on the card
    ]
    if MUSIC:
        out.append((MUSIC, 0.0, 60.0, 0.0, 0.45, 0.3, 1.5))
    return out


def main():
    ps = parts()
    starts, t = [], 0.0
    for d, _ in ps:
        starts.append(round(t, 3))
        t += d
    length = t
    snd = sounds(starts)
    C.VIDEOS["story"] = lambda: (ps, snd)
    C.render("story")
    print(f"story: {length:.1f} s; parts start at {starts}")


if __name__ == "__main__":
    main()
