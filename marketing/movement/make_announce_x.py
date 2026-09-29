"""The announcement for X (29 Sep, the founder's own cut and music): 4:5, 1080 x 1350, the frame X's feed shows whole on
a phone. An extreme close-up eye opens it (the 1-minute story's first shot, with its own sound), then the founder's
sequence on the beat of his track, cut every 1.5 s, reframed and captioned in the collection's pixel font; the
"coming soon" ending becomes the counter of the 5555 Faces and the announcement itself; then the music stops and the
same eye comes back, staring, with only the buzz of a neon (the founder: end on the eye, in near silence). Pinned on
the profile. The track plays once, untouched (a loop of its bars was audible): its last bar rings out in echoes under
the last card, the card dissolves into the eye, and picture and sound fade to black together.

    python marketing/movement/make_announce_x.py SOURCE.mp4     # -> out/l-announce-x.mp4
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1] / "art")]
import make_cut as mc  # noqa: E402
import make_launch as ml  # noqa: E402

FPS, W, H = mc.FPS, 1080, 1350
TOP = (1920 - H) // 2  # the 4:5 window inside the films' 9:16 frames
SRC = Path(sys.argv[1])
INTRO = 3.6  # the eye opening, before the track starts
CUTS = [(0.0, 1.467, None), (1.467, 2.967, "THEY DON'T BLINK."), (2.967, 4.467, "HOW THEY SEE YOU."),
        (4.467, 5.967, "MY NEW PFP."), (5.967, 7.467, "EVERYONE RUSHES. YOU DON'T."),
        (7.467, 8.933, "WHEN YOUR WALLET IS ON THE LIST.")]  # the founder's shots and lines
TRACK = 14.333
BAR = 1.5  # the founder's cuts fall every 1.5 s, on the bar
LAST = 2.0  # the last card, over the echoes, after the track
MIX = 0.8  # the last card dissolves into the eye
OUTRO = (3.6, 5.088, 3.6)  # the same eye, wide open, the neon in the pupil, slowed to 3.6 s (incl. the dissolve)
FADE = 0.8  # picture and sound fade to black together
END = TRACK + LAST + OUTRO[2]  # in track time (the dissolve happens inside the eye's own frames)


def source_frames(t0, t1):
    """The founder's footage, 720 x 1280: the 4:5 band above his burned-in captions, at 1080 x 1350, 24 fps."""
    raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t0}", "-t", f"{t1 - t0}", "-i", str(SRC),
                          "-vf", f"crop=720:900:0:80,scale={W}:{H}:flags=lanczos,fps={FPS}", "-f", "rawvideo",
                          "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)


def cap(fr, text):
    if not text:
        return fr
    im = Image.fromarray(np.ascontiguousarray(fr))
    mc.caption(im, text, y=1150, cell=6)
    return np.asarray(im)


def window(frames):
    for f in frames:
        yield np.ascontiguousarray(f[TOP:TOP + H])


def take(gen, n):
    out = []
    for f in gen:
        out.append(f)
        if len(out) == n:
            break
    while len(out) < n:
        out.append(out[-1])
    return out


def frames():
    # 1. the eye (the story's opening shot), pushed in slowly
    eye = mc.clip_frames("s-eye", 0.0, INTRO)
    n = int(round(INTRO * FPS))
    for i in range(n):
        yield mc.drift(np.ascontiguousarray(eye[min(i, len(eye) - 1)][TOP:TOP + H]), i, n, 0.05)
    # 2. the founder's sequence, a neon flash on every cut
    for a, b, text in CUTS:
        shot = source_frames(a, b)
        want = int(round(b * FPS)) - int(round(a * FPS))
        for k in range(want):
            f = shot[min(k, len(shot) - 1)]
            if k < 2:
                f = mc.flash(f)
            yield cap(f, text)
    # 3. the counter, then the announcement (was "coming soon"), cut on the beat
    list_card = [("ON THE LIST?", 8, mc.NEON), ("", 4, mc.PALE), ("FIND OUT THURSDAY", 6, mc.PALE), ("08:00 UTC", 10, mc.NEON),
                 ("", 3, mc.PALE), ("NEONFACES.XYZ", 8, mc.PALE)]
    t = 8.933
    half = (TRACK - 8.933 - BAR) / 2
    parts = [(BAR, lambda d: ml.counter(d, "5555 FACES.")),
             (half, lambda d: ml.cards([(d, [("THURSDAY", 12, mc.NEON), ("1 OCTOBER", 12, mc.NEON), ("", 4, mc.PALE),
                                              ("18:00 UTC", 9, mc.NEON), ("ON OPENSEA", 7, mc.PALE)])], seed=31)),
             (half, lambda d: ml.cards([(d, [("THE LIST FIRST", 9, mc.NEON), ("24 HOURS, 0.013 ETH", 6, mc.PALE),
                                              ("", 4, mc.PALE), ("THEN EVERYONE", 9, mc.NEON),
                                              ("FROM FRIDAY, 0.018 ETH", 6, mc.PALE)])], seed=32)),
             (LAST, lambda d: ml.cards([(d, list_card)], seed=33))]
    held = None
    for d, make in parts:
        want = int(round((t + d) * FPS)) - int(round(t * FPS))
        chunk = take(window(make(d)), want)
        held = chunk[-1]
        yield from chunk
        t += d
    # 4. the last card dissolves into the eye, slowed by blending frames; picture fades to black at the end
    a, b, dur = OUTRO
    eye = mc.clip_frames("s-eye", a, b).astype(np.float32)
    n = int(round(dur * FPS))
    nm, nf = int(round(MIX * FPS)), int(round(FADE * FPS))
    card = held.astype(np.float32)
    for i in range(n):
        pos = i * (len(eye) - 1) / (n - 1)
        k, e = int(pos), pos - int(pos)
        f = eye[k] * (1 - e) + eye[min(k + 1, len(eye) - 1)] * e
        f = mc.drift(np.ascontiguousarray(f[TOP:TOP + H].astype(np.uint8)), i, n, 0.05).astype(np.float32)
        if i < nm:
            w = mc.ease(i / nm)
            f = card * (1 - w) + f * w
        if i >= n - nf:
            f = f * ((n - 1 - i) / nf)
        yield np.clip(f, 0, 255).astype(np.uint8)


def main():
    out = HERE / "out" / "l-announce-x.mp4"
    with tempfile.TemporaryDirectory() as tmp:
        silent = Path(tmp) / "v.mp4"
        enc = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}",
                                "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-crf", "19", "-preset", "slow",
                                "-pix_fmt", "yuv420p", str(silent)], stdin=subprocess.PIPE)
        count = 0
        for fr in frames():
            enc.stdin.write(np.ascontiguousarray(fr, dtype=np.uint8).tobytes())
            count += 1
        enc.stdin.close()
        enc.wait()
        total = INTRO + END
        d0 = int(INTRO * 1000)
        tail_at = TRACK - BAR  # the last bar
        buzz_at = TRACK - 0.2  # under the echoes, so there is no gap between the music and the buzz
        af = (f"[0:a]atrim=0:{INTRO},asetpts=PTS-STARTPTS,volume=0.8,afade=t=out:st={INTRO - 0.25}:d=0.25[e];"
              # the track once, untouched until its last bar, which fades while its echoes ring on
              f"[1:a]asplit=2[t1][t2];"
              f"[t1]atrim=0:{TRACK},asetpts=PTS-STARTPTS,afade=t=out:st={TRACK - 0.9}:d=0.9,adelay={d0}|{d0}[m];"
              f"[t2]atrim={tail_at}:{TRACK},asetpts=PTS-STARTPTS,volume=0.8,apad=pad_dur=5,"
              f"aecho=0.8:0.85:375|750|1125|1500:0.45|0.32|0.22|0.14,afade=t=in:d=0.6,"
              f"afade=t=out:st={BAR + 1.6}:d=2.4,atrim=0:{BAR + 4.0},adelay={int((INTRO + tail_at) * 1000)}|{int((INTRO + tail_at) * 1000)}[r];"
              # then only a neon's buzz (the end of the N2 score, after its last hit), fading out with the picture
              # the buzz's steady stretches only (the score dips at 17.6 s), joined with soft crossfades
              f"[2:a]asplit=3[b1][b2][b3];[b1]atrim=15.0:17.5,asetpts=PTS-STARTPTS[c1];[b2]atrim=17.9:19.7,asetpts=PTS-STARTPTS[c2];"
              f"[b3]atrim=15.0:17.5,asetpts=PTS-STARTPTS[c3];[c1][c2]acrossfade=d=0.4[c12];[c12][c3]acrossfade=d=0.4,"
              f"atrim=0:{END - buzz_at},volume=0.55,afade=t=in:d=1.4,"
              f"afade=t=out:st={END - buzz_at - FADE}:d={FADE},adelay={int((INTRO + buzz_at) * 1000)}|{int((INTRO + buzz_at) * 1000)}[o];"
              f"[e][m][r][o]amix=inputs=4:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,atrim=0:{total}[a]")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(HERE / "raw" / "s-eye.mp4"), "-i", str(SRC),
                        "-i", str(HERE / "raw" / "music-n2.m4a"), "-i", str(silent), "-filter_complex", af,
                        "-map", "3:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
                        "-movflags", "+faststart", "-t", f"{total}", str(out)], check=True)
    print(f"{out.relative_to(HERE)}  {count / FPS:.1f} s, {count} frames, {W}x{H}")


if __name__ == "__main__":
    main()
