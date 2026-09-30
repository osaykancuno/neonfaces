"""Thu 1 Oct, the mint day (the founder: a story like the Wall of 30 Sep, on 10 credits). #419, the young woman whose
eye opens and closes our videos, tells her friends about NEONFACES over a glass in the evening: she turns her phone
toward us, her Face is on it, the camera rushes into the screen and through the Face into the NEON world; back at the
table her friends' phones light up one by one, the city waits, and at 18:00 UTC the city falls into NEON. No new
words: the only voice is the brand line already recorded ("They don't blink. Neither do we.", gen_voice.py so). The
music is the Wall's own track (music-wall10): its build under the day, the lift on the way through the screen, its
near silence under the last seconds before 18:00 and the drop on 18:00 UTC.

People are always moving (the founder, 1 Oct: no still pictures of people); no clip runs slower than about half speed.
The phone's screen came out as a blank light: it is tracked frame by frame and the exact Face drawn into it.

New media (9.5 credits): stills st-table, st-ots, st-phones (frames.json; they start the clips) and clips st-table,
st-phones (clips.json). Everything else was already in raw/.

    python marketing/movement/make_friends.py        # -> out/l-friends.mp4 + -4x5.mp4
"""
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1] / "art")]
import make_cut as mc  # noqa: E402
import make_launch as ml  # noqa: E402
from make_frames import corners, screen_image  # noqa: E402
from make_wall10 import flashed, slow, ticking  # noqa: E402

W, H, FPS = mc.W, mc.H, mc.FPS
FACE = Image.open(HERE / "refs" / "f419.png").convert("RGB")
TURN = (0.0, 1.45)  # st-table: she lifts the phone and turns it toward us
RUSH = (1.45, 2.3)  # the push into the screen


def sub_at(subs, t):
    for t0, t1, text in subs:
        if t0 <= t < t1:
            return text
    return None


def screen_quad(fr):
    """The phone's screen in a frame of st-table (a bright, pale lime area in front of her, 1080 x 1920 frame), or
    None while it faces away: four corners, top-left first in the screen's own frame, and the filled mask."""
    hsv = cv2.cvtColor(fr, cv2.COLOR_RGB2HSV).astype(int)
    m = ((hsv[..., 2] >= 200) & (hsv[..., 0] >= 30) & (hsv[..., 0] <= 85)).astype(np.uint8)
    roi = np.zeros_like(m)
    roi[850:1350, 300:750] = 1
    m = cv2.morphologyEx(m * roi, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    n, lab, st, _ = cv2.connectedComponentsWithStats(m)
    if n < 2:
        return None
    b = 1 + int(np.argmax(st[1:, cv2.CC_STAT_AREA]))
    if st[b, cv2.CC_STAT_AREA] < 2500:
        return None
    full = np.zeros_like(m)
    cv2.drawContours(full, cv2.findContours((lab == b).astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0],
                     -1, 1, -1)
    return corners(full)


def tracked(a, b):
    """Frames of st-table from a to b with their screen quads, each corner smoothed over three frames (no jitter)."""
    fr = mc.clip_frames("st-table", a, b)
    qs = [screen_quad(f) for f in fr]
    out = []
    for i, q in enumerate(qs):
        near = [x for x in qs[max(0, i - 1):i + 2] if x is not None]
        out.append(None if q is None else np.mean(near, axis=0).astype(np.float32))
    return fr, out


def draw_face(img, quad, glow=True):
    """The Face drawn into `quad` (output pixels): black screen, the square Face across its width, crisp cells."""
    q = np.float32(quad)
    wpx = int(np.linalg.norm(q[1] - q[0]))
    hpx = int(np.linalg.norm(q[3] - q[0]))
    k = max(1, int(np.ceil(1400 / max(8, hpx))))  # draw big, warp down: square cells without jaggies
    src = screen_image(FACE, max(2, wpx * k), max(2, hpx * k))
    sq = np.float32([[0, 0], [src.shape[1], 0], [src.shape[1], src.shape[0]], [0, src.shape[0]]])
    c = q.mean(0)
    M = cv2.getPerspectiveTransform(sq, c + (q - c) * 1.03)
    warped = cv2.warpPerspective(src, M, (W, H), flags=cv2.INTER_AREA)
    area = np.zeros((H, W), np.float32)
    cv2.fillConvexPoly(area, (c + (q - c) * 1.03).astype(np.int32), 1.0)
    alpha = cv2.GaussianBlur(area, (3, 3), 0.8)[..., None]
    shown = cv2.GaussianBlur(warped, (0, 0), 0.5)
    if glow:  # an emitting screen: its lime bleeds a little
        bloom = cv2.GaussianBlur(shown, (0, 0), 2.5) * 0.45
        shown = 255 - (255 - shown) * (255 - bloom) / 255
    return (img.astype(np.float32) * (1 - alpha) + shown * alpha).clip(0, 255).astype(np.uint8)


def resample(fr, n):
    """n frames spread over fr, blending neighbours (slow motion without stutter), with their fractional index."""
    for i in range(n):
        pos = i * (len(fr) - 1) / max(1, n - 1)
        k, e = int(pos), pos - int(pos)
        yield (fr[k].astype(np.float32) * (1 - e) + fr[min(k + 1, len(fr) - 1)].astype(np.float32) * e), k, e


def turn(dur, subs):
    """She lifts her phone and turns it toward us; from the moment the screen shows, her Face is on it."""
    fr, qs = tracked(*TURN)
    n = int(round(dur * FPS))
    for i, (f, k, e) in enumerate(resample(fr, n)):
        f = mc.drift(np.clip(f, 0, 255).astype(np.uint8), i, n, 0.03)
        q = qs[k] if e < 0.5 or qs[min(k + 1, len(qs) - 1)] is None else qs[min(k + 1, len(qs) - 1)]
        if q is not None:
            s = 1.0 + 0.03 * (i / max(1, n - 1))  # the same push as drift(), applied to the quad
            q = (q - np.float32([W / 2, H / 2])) * s + np.float32([W / 2, H / 2])
            f = draw_face(f, q)
        yield mc.finish(mc.with_caption(f, sub_at(subs, i / FPS)), i)


def rush(dur, z_end=None):
    """The camera rushes into the screen: the frame is scaled around the screen until the screen fills it; the Face
    is drawn after the zoom, at output resolution, so its cells stay crisp all the way in."""
    fr, qs = tracked(*RUSH)
    last = next(q for q in reversed(qs) if q is not None)
    n = int(round(dur * FPS))
    for i, (f, k, e) in enumerate(resample(fr, n)):
        q = qs[k] if qs[k] is not None else last
        c = q.mean(0)
        hq = (np.linalg.norm(q[3] - q[0]) + np.linalg.norm(q[2] - q[1])) / 2
        full = H * 1.08 / hq  # the zoom at which the screen fills the frame
        p = mc.ease(i / max(1, n - 1)) ** 1.7
        s = 1.0 + ((z_end or full) - 1.0) * p
        dst = c + (np.float32([W / 2, H / 2]) - c) * p  # the screen drifts to the centre as we go in
        M = np.float32([[s, 0, dst[0] - s * c[0]], [0, s, dst[1] - s * c[1]]])
        out = cv2.warpAffine(np.clip(f, 0, 255).astype(np.uint8), M, (W, H), flags=cv2.INTER_LINEAR)
        qo = q * s + np.float32([M[0, 2], M[1, 2]])
        out = draw_face(out, qo, glow=True)
        yield mc.finish(out, i)


def through(dur):
    """Inside the screen: the Face alone, the camera keeps going into its cells, the neon blooms, then white-lime."""
    n = int(round(dur * FPS))
    side = W  # the Face across the width, as on the screen once it fills the frame
    face = np.asarray(FACE.resize((side * 2, side * 2), Image.NEAREST), np.float32)
    for i in range(n):
        p = mc.ease(i / max(1, n - 1))
        # it starts where the rush ended (the Face across the full screen, centred a little above the middle) and
        # goes on toward its left eye
        s = 1.06 + 2.2 * p ** 1.5
        fx, fy = 0.5 + (0.36 - 0.5) * p, 0.5 + (0.40 - 0.5) * p
        M = np.float32([[s * 0.5, 0, W / 2 - s * 0.5 * face.shape[1] * fx],
                        [0, s * 0.5, H * 0.435 - s * 0.5 * face.shape[0] * fy]])
        out = cv2.warpAffine(face, M, (W, H), flags=cv2.INTER_NEAREST)
        bloom = cv2.GaussianBlur(out, (0, 0), 14) * (0.3 + 0.9 * p)
        out = 255 - (255 - out) * (255 - bloom) / 255
        if i >= n - 4:  # the flash into the NEON world
            out = out * 0.4 + np.float32(mc.NEON) * 0.6
        yield mc.finish(np.clip(out, 0, 255).astype(np.uint8), i, art=True)


def rush_through(d1, d2, blend=6):
    """The rush and the way through the Face as one move: the last frames of the rush dissolve into the first of the
    Face, so the tilted screen straightens without a jump."""
    a = list(rush(d1))
    b = list(through(d2 + blend / FPS))
    for i, f in enumerate(a[:-blend]):
        yield f
    for k in range(blend):
        e = mc.ease((k + 1) / (blend + 1))
        yield (a[len(a) - blend + k].astype(np.float32) * (1 - e) + b[k].astype(np.float32) * e).astype(np.uint8)
    yield from b[blend:]


def toned(f, cell=24):
    """A frame in NEONCAM's cells and five tones."""
    small = cv2.resize(f, (W // cell, H // cell), interpolation=cv2.INTER_AREA).astype(np.float32)
    lum = small @ np.float32([0.2126, 0.7152, 0.0722])
    lo, hi = np.percentile(lum, [2, 99])
    v = np.clip((lum - lo) / max(24, hi - lo), 0, 1)
    t = ml.CAM_PAL[np.searchsorted([0.20, 0.37, 0.55, 0.72], v, side="right")]
    return cv2.resize(t, (W, H), interpolation=cv2.INTER_NEAREST).astype(np.uint8)


def neon_back(cid, a, b, dur, hold=0.35, subs=()):
    """The NEON world: the shot in cells, then reality comes back from the top, under a neon scan line."""
    fr = mc.clip_frames(cid, a, b)
    n = int(round(dur * FPS))
    for i, (f, _, _) in enumerate(resample(fr, n)):
        f = mc.drift(np.clip(f, 0, 255).astype(np.uint8), i, n, 0.04)
        p = i / max(1, n - 1)
        k = mc.ease((p - hold) / (1 - hold)) if p > hold else 0.0
        line = int(H * k)
        out = toned(f)
        out[:line] = f[:line]
        if 0 < line < H:
            out[line:line + 6] = mc.NEON
        yield mc.finish(mc.with_caption(out, sub_at(subs, i / FPS)), i)


def neon_fall(cid, a, b, dur, subs=()):
    """18:00 UTC: the shot falls into NEON cells from the bottom up, fast."""
    fr = mc.clip_frames(cid, a, b)
    n = int(round(dur * FPS))
    for i, (f, _, _) in enumerate(resample(fr, n)):
        f = mc.drift(np.clip(f, 0, 255).astype(np.uint8), i, n, 0.06)
        k = mc.ease(min(1.0, i / max(1, n * 0.7)))
        line = int(H * (1 - k))
        out = f.copy()
        out[line:] = toned(f)[line:]
        if 0 < line < H:
            out[max(0, line - 6):line] = mc.NEON
        yield mc.finish(mc.with_caption(out, sub_at(subs, i / FPS)), i)


# the music: the Wall's track joined at its build, with a jump over most of its dip so its near silence and its drop
# land on 17:59:57 and 18:00 UTC
TRACK_IN = 13.3
T_JUMP, TRACK_BACK = 24.0, 45.1


def piece():
    NEON, PALE = mc.NEON, mc.PALE
    seq = [
        # her eye opens it, in near silence
        (4.9, lambda: slow("s-eye", 0.0, 4.9, 4.9, z=0.06)),
        # the morning: she already knows
        (4.7, lambda: slow("v1-c", 0.3, 5.0, 4.7, [(0.5, 99, "TODAY.")])),
        # the evening: she turns her phone to us, her Face on it
        (1.8, lambda: turn(1.8, [(0.0, 99, "17:30 UTC.")])),
        # the rush into the screen (the lift arrives as the screen fills the frame) and on through the Face
        (2.3, lambda: rush_through(1.3, 1.0)),
        # the NEON world, and back at the table: her friends lean in
        (1.8, lambda: neon_back("st-table", 2.3, 4.09, 1.8)),
        # one after another, their phones light up; she looks at us
        (4.8, lambda: slow("st-phones", 0.0, 4.09, 4.8, z=0.05)),
        # the city waits
        (4.1, lambda: flashed(slow("s-windows", 0.45, 4.55, 4.1, [(0, 99, "17:59 UTC.")]))),
        # the near silence
        (1.95, lambda: ticking(1.95, ["17:59:57", "17:59:58", "17:59:59"])),
        # 18:00 UTC: the city falls into NEON
        (1.85, lambda: flashed(neon_fall("s-windows", 2.9, 4.55, 1.85, [(0, 99, "18:00 UTC.")]), 3)),
        (1.9, lambda: ml.counter(1.9, "5555 FACES.")),
        (2.2, lambda: ml.cards([(2.2, [("TODAY", 12, NEON), ("", 3, PALE), ("18:00 UTC", 11, NEON), ("", 3, PALE),
                                      ("ON OPENSEA", 7, PALE)])], seed=51)),
        (2.4, lambda: ml.cards([(2.4, [("THE LIST FIRST", 9, NEON), ("24 HOURS, 0.013 ETH", 6, PALE), ("", 4, PALE),
                                      ("THEN EVERYONE", 9, NEON), ("FROM FRIDAY, 0.018 ETH", 6, PALE)])], seed=52)),
        # into her eye, and the brand's voice
        (3.4, lambda: ml.eye_close(3.4)),
    ]
    total = sum(d for d, _ in seq)
    track = mc.music("wall10")
    voice_at, voice_len = total - 3.2, 2.85
    # segment-local time (the second segment starts at T_JUMP): lower under the details, a dip under the voice
    details = sum(d for d, _ in seq[:9]) - T_JUMP
    low = f"(1-0.4*max(0,min(1,(t-{details:.2f})/1.5)))"
    duck = (f"(1-0.5*max(0,min(1,min((t-{voice_at - 0.2 - T_JUMP:.2f})/0.2+1,"
            f"({voice_at + voice_len + 0.3 - T_JUMP:.2f}-t)/0.3+1))))")
    sounds = [
        (track, TRACK_IN, TRACK_IN + T_JUMP + 0.25, 0.0, 0.95, 2.5, 0.35),
        (track, TRACK_BACK, TRACK_BACK + total - T_JUMP, T_JUMP, f"0.95*{low}*{duck}", 0.3, 1.2),
        (HERE / "raw" / "voice" / "so-c.wav", 0.0, voice_len, voice_at, 0.9, 0.03, 0.15),
    ]
    # each real shot keeps a little of its own sound (the eye's hum soft, the city, the bar)
    t = 0.0
    own = {0: ("s-eye", 0.0, 0.15), 1: ("v1-c", 0.3, 0.35), 2: ("st-table", 0.0, 0.4), 4: ("st-table", 2.3, 0.35),
           5: ("st-phones", 0.0, 0.35), 6: ("s-windows", 0.45, 0.3)}
    for k, (d, _) in enumerate(seq):
        if k in own:
            cid, a, g = own[k]
            sounds.append((mc.raw(cid), a, a + min(d, 4.0), t, g, 0.15, 0.3))
        t += d
    return seq, sounds


mc.VIDEOS["l-friends"] = piece

if __name__ == "__main__":
    mc.render("l-friends")
