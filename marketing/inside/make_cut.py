"""18-second cut "what's inside a Face", from the two generated clips (Seedance 2.0 Mini, 27 Sep) and the
trailer's own parts. Captions in the collection's pixel font, for muted autoplay.

    python marketing/inside/make_cut.py              (repo root; ffmpeg on PATH) -> neonfaces-inside.mp4
    python marketing/inside/make_cut.py --no-name    -> inside-no-name.mp4 (card: THEY DON'T BLINK. / ROBINHOOD CHAIN)

Needs raw/a-inside.mp4, raw/b-human.mp4 and b-human.mp4 (`python marketing/inside/pixelate.py raw/b-human.mp4 b-human.mp4`).

 0.0- 3.5  clip A: set #518's face glitches, its eyes snap open, the camera goes through the pupil into the Face:
           chart bars, a coin, a gold and a silver bar. Colours snapped to the collection's palette.
           VO "Look closer." (teaser 1) on the first frame
 3.5- 6.0  20 people of the collection, one every eighth of a second; the ticking of teaser 3
 6.0- 8.5  four pieces slide together into one face; the riser of teaser 5
 8.5-11.5  the card, the name only (no site for now); VO "They don't blink. Neither do I." (teaser 5)
11.5-15.5  clip B, the ending: the trailer's face becomes a person, pixelated like the art, opens its eyes and holds
           the stare (the pupils reflect the chart); VO "Someone has to keep watching." (teaser 2); in the last
           1.5 s the cells get finer until the real face generated for the clip is left on screen
15.5-18.0  that real face holds the stare (the clip's last frame, a slow push-in)
Virality proxy (Higgsfield, 27 Sep) on the earlier 16 s order: overall 50, hook 35, sustain 99.6%; with the voice on
the first frame 52 / 36 / 99.6%. Hook rules from marketing/teasers/PROMPTS.md: motion and a hit on the first frame,
bright from the first second, captions on every line.
"""
import json
import random
import subprocess
import sys
import tempfile
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "marketing" / "trailer"))
import make_trailer as T  # noqa: E402  (reads --no-name from sys.argv too)

W, H, FPS = T.W, T.H, T.FPS
TEASERS = ROOT / "marketing" / "teasers"
OUT = HERE / ("inside-no-name.mp4" if T.NO_NAME else "neonfaces-inside.mp4")
LENGTH = 18.0
# the six tones of the art plus its pale highlight: clip A's colours are snapped to these (it had an orange cell)
PALETTE = np.array([(0, 0, 0), (31, 37, 4), (65, 77, 18), (103, 121, 32), (148, 178, 29), (204, 255, 0),
                    (242, 255, 200)], np.float32)


def frames_of(video: Path, seconds: float) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(video), "-t", str(seconds), "-r", str(FPS),
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)


def snap(frame: np.ndarray) -> np.ndarray:
    px = frame.reshape(-1, 3).astype(np.float32)
    d = ((px[:, None, :] - PALETTE[None, :, :]) ** 2).sum(-1)
    return PALETTE[d.argmin(1)].astype(np.uint8).reshape(frame.shape)


def cells(frame: np.ndarray, size: int) -> np.ndarray:
    """Average colour in square cells (the grid of the start frame: x from 4)."""
    if size <= 1:
        return frame
    ox = 4 % size
    cols, rows = (W - ox) // size, H // size
    out = frame.copy()
    region = frame[:rows * size, ox:ox + cols * size].astype(np.float32)
    block = region.reshape(rows, size, cols, size, 3).mean(axis=(1, 3))
    out[:rows * size, ox:ox + cols * size] = block.repeat(size, 0).repeat(size, 1).astype(np.uint8)
    return out


def captioned(arr: np.ndarray, text: str | None) -> Image.Image:
    fr = Image.fromarray(arr)
    if text:
        T.caption(fr, text)
    return fr


def clip_a(out: Path):
    for i, f in enumerate(frames_of(HERE / "raw" / "a-inside.mp4", 3.5)):
        captioned(snap(f), "LOOK CLOSER." if i < 43 else "EVERY FACE IS A WALLET.").save(out / f"f{i:04d}.png")


def faces(out: Path, arts):
    """2.5 s: 20 set faces, a different person every 3 frames, alternating looks and genders."""
    manifest = {e["id"]: e for e in json.loads((ROOT / "art" / "portraits" / "manifest.json").read_text())}
    sets = [a["set"] for a in arts if "set" in a and a["piece"] == 0]
    rng = random.Random(518)
    rng.shuffle(sets)
    seen, picks = set(), []
    for n in sets:
        k = (manifest[f"set-{n}"]["look"], manifest[f"set-{n}"]["gender"])
        if k not in seen or len(seen) >= 12:
            seen.add(k)
            picks.append(n)
        if len(picks) == 20:
            break
    i = 0
    for n in picks:
        base = T.face(Image.open(T.ART / "images" / f"set-{n}.png"))
        for k in range(3):
            # a flash on every cut, towards the pale highlight (scaling the channels would turn the lime yellow)
            fr = base.copy() if k else Image.blend(base, Image.new("RGB", base.size, T.PALE), 0.22)
            T.caption(fr, "A SMALL PIECE OF THE MARKET INSIDE.")
            fr.save(out / f"f{i:04d}.png")
            i += 1


def card(out: Path):
    """3 s: the trailer's card, with the name only (no site until it's announced)."""
    eye = Image.open(T.ART / "images" / "set-124.png").convert("RGB").resize((360, 360), Image.NEAREST)
    base = Image.new("RGB", (W, H), T.INK)
    base.paste(eye, (110, 180))
    for k in range(4):
        base.paste(T.NEON, (90 + k, 160 + k, 1190 - k, 161 + k))
        base.paste(T.NEON, (90 + k, 559 - k, 1190 - k, 560 - k))
        base.paste(T.NEON, (90 + k, 160 + k, 91 + k, 560 - k))
        base.paste(T.NEON, (1189 - k, 160 + k, 1190 - k, 560 - k))
    if T.NO_NAME:
        T.draw_text(base, "THEY DON'T BLINK.", 820, 300, 6, T.NEON, "center")
        T.draw_text(base, "ROBINHOOD CHAIN", 820, 420, 5, T.DIM, "center")
    else:
        T.draw_text(base, "NEONFACES", 820, 318, 12, T.NEON, "center")
    dark = Image.eval(base, lambda v: v // 6)
    flicker = [0, 1, 0, 0, 1, 1, 0, 1]
    for i in range(72):
        (base if i >= len(flicker) or flicker[i] else dark).save(out / f"f{i:04d}.png")


def clip_b(out: Path):
    """4 s + 2.5 s: the pixelated person, then the cells resolve into the real face, which holds the stare."""
    pix = frames_of(HERE / "b-human.mp4", 4.0)
    real = frames_of(HERE / "raw" / "b-human.mp4", 4.0)
    n = min(len(pix), len(real))
    resolve = 36  # the last 1.5 s of the clip
    sizes = [10, 10, 10, 10, 8, 8, 8, 8, 6, 6, 6, 6, 5, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2]
    k = 0
    for i in range(n):
        j = i - (n - resolve)
        if j < 0:
            fr = pix[i]
        elif j < len(sizes):  # finer and finer cells, the natural colour coming through
            p = j / len(sizes)
            fr = (cells(real[i], sizes[j]).astype(np.float32) * p + pix[i].astype(np.float32) * (1 - p)).astype(np.uint8)
        else:
            fr = real[i]
        captioned(fr, "SOMEONE HAS TO KEEP WATCHING." if i >= 36 else None).save(out / f"f{k:04d}.png")
        k += 1
    last = Image.fromarray(real[n - 1])
    for i in range(60):  # the real face holds the stare: a slow push-in on the eyes, no blink
        z = 1.0 + 0.06 * (i / 59)
        cw, ch = int(W / z), int(H / z)
        cx, cy = W // 2, int(H * 0.45)
        fr = last.crop((cx - cw // 2, cy - ch // 2, cx - cw // 2 + cw, cy - ch // 2 + ch)).resize((W, H), Image.LANCZOS)
        T.caption(fr, "SOMEONE HAS TO KEEP WATCHING.")
        fr.save(out / f"f{k:04d}.png")
        k += 1


def main():
    if not (HERE / "b-human.mp4").exists():
        sys.exit("run pixelate.py first (b-human.mp4)")
    arts = T.art()
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        parts = {"a": lambda d: clip_a(d), "faces": lambda d: faces(d, arts), "asm": None, "card": card, "b": clip_b}
        for name, build in parts.items():
            d = tmp / name
            d.mkdir()
            if name == "asm":
                T.assembly(d)
                pattern = "c%04d.png"
            else:
                build(d)
                pattern = "f%04d.png"
            T.run(["-framerate", str(FPS), "-i", str(d / pattern), "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p",
                   str(tmp / f"{name}.mp4")])
        (tmp / "list.txt").write_text("".join(f"file '{tmp / f'{p}.mp4'}'\n".replace("\\", "/") for p in parts))
        T.run(["-f", "concat", "-safe", "0", "-i", str(tmp / "list.txt"), "-c", "copy", str(tmp / "video.mp4")])
        # audio: A's own sound + "Look closer." at once · the ticking · teaser 5 from its riser (the card's line
        # lands on the card) · B's own sound + "Someone has to keep watching." · a low tail under the real face
        T.run(["-i", str(tmp / "video.mp4"), "-i", str(HERE / "raw" / "a-inside.mp4"), "-i", str(TEASERS / "1-signal.mp4"),
               "-i", str(TEASERS / "3-eyes.mp4"), "-i", str(HERE / "raw" / "b-human.mp4"), "-i", str(TEASERS / "2-watching.mp4"),
               "-i", str(TEASERS / "5-soon.mp4"),
               "-filter_complex",
               "[1:a]atrim=0:3.5,afade=t=out:st=3.2:d=0.3[a1];"
               "[2:a]atrim=6.1:7.2,asetpts=PTS-STARTPTS,volume=1.3,afade=t=out:st=0.9:d=0.2,adelay=30|30[v1];"
               "[3:a]atrim=0:2.5,asetpts=PTS-STARTPTS,volume=3.2,afade=t=in:d=0.1,afade=t=out:st=2.2:d=0.3,adelay=3500|3500[a2];"
               "[6:a]atrim=1.2:7.0,asetpts=PTS-STARTPTS,afade=t=in:d=0.3,afade=t=out:st=5.4:d=0.4,adelay=6000|6000[a3];"
               "[4:a]atrim=0:4,asetpts=PTS-STARTPTS,afade=t=in:d=0.05,adelay=11500|11500[a4];"
               "[5:a]atrim=2.8:4.9,asetpts=PTS-STARTPTS,volume=1.3,afade=t=out:st=1.9:d=0.2,adelay=13000|13000[v2];"
               "[5:a]atrim=5.0:8.0,asetpts=PTS-STARTPTS,volume=0.8,afade=t=in:d=0.5,afade=t=out:st=2.0:d=1.0,adelay=15400|15400[a5];"
               f"[a1][v1][a2][a3][a4][v2][a5]amix=inputs=7:normalize=0,atrim=0:{LENGTH},alimiter=limit=0.89:level=false[a]",
               "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "aac",
               "-b:a", "192k", "-t", str(LENGTH), str(OUT)])
    print(OUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
