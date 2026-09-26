"""15-second presentation trailer, built from the collection's own art (art/output) + one generated opening shot.

    python marketing/trailer/make_trailer.py              (repo root; ffmpeg on PATH) -> neonfaces-trailer.mp4
    python marketing/trailer/make_trailer.py --no-name    -> trailer-no-name.mp4: the same cut, and the card
                                                             says THEY DON'T BLINK. / ROBINHOOD CHAIN, no name, no site

0.0-3.5   set #124 comes alive: the first 0.9 s of hero.mp4 (Veo 3.1 Lite from the pixel face: a hard glitch; after
          that Veo turned the face into a photo and added a microphone, so it is cut), then a push-in on the
          pixel face drawn here; sound and VO "They don't blink." from teaser 1
3.5-7.0   28 different people of the collection, one every eighth of a second
7.0-9.5   four pieces slide together into one face
9.5-11.0  zoom out on a wall of single close-ups
11.0-15.0 the NEONFACES card with the opening face, VO "They don't blink. Neither do I." (audio of teaser 5)
Captions are drawn in the collection's pixel font, for muted autoplay (what the virality report pointed at).
"""
import json
import random
import subprocess
import sys
import tempfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
ART = ROOT / "art" / "output"
TEASERS = ROOT / "marketing" / "teasers"
sys.path.insert(0, str(ROOT / "marketing" / "posts"))
from make_posts import DIM, INK, NEON, PALE, draw_text, text_width  # noqa: E402

W, H, FPS = 1280, 720, 24
SINGLES = 3335
NO_NAME = "--no-name" in sys.argv
OUT = HERE / ("trailer-no-name.mp4" if NO_NAME else "neonfaces-trailer.mp4")


def run(args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def art():
    return json.loads((ART / "art.json").read_text())


def trait(a, k):
    return next((x["value"] for x in a["attributes"] if x["trait_type"] == k), None)


def face(img: Image.Image, size=720) -> Image.Image:
    """Nearest-neighbour to `size` (whole cells) on a black 16:9 frame."""
    f = Image.new("RGB", (W, H), INK)
    im = img.convert("RGB").resize((size, size), Image.NEAREST)
    f.paste(im, ((W - size) // 2, (H - size) // 2))
    return f


def caption(frame: Image.Image, text: str, cell=5):
    w = text_width(text, cell) + 8 * cell
    x0, y0 = (W - w) // 2, H - 7 * cell - 70
    band = Image.new("RGB", (w, 13 * cell), INK)
    frame.paste(band, (x0, y0 - 3 * cell))
    draw_text(frame, text, W // 2, y0, cell, PALE, "center")


def montage(out: Path, arts):
    """3.5 s: 28 set faces, a different person every 3 frames, picked across genders and backgrounds."""
    manifest = {e["id"]: e for e in json.loads((ROOT / "art" / "portraits" / "manifest.json").read_text())}
    sets = [a["set"] for a in arts if "set" in a and a["piece"] == 0]
    rng = random.Random(124)
    rng.shuffle(sets)
    by_look = {}
    for n in sets:
        by_look.setdefault((manifest[f"set-{n}"]["look"], manifest[f"set-{n}"]["gender"]), []).append(n)
    keys = sorted(by_look)
    rng.shuffle(keys)
    picks = [by_look[k][i] for i in range(4) for k in keys if i < len(by_look[k])][:28]
    i = 0
    for n in picks:
        base = face(Image.open(ART / "images" / f"set-{n}.png"))
        for k in range(3):
            fr = base.copy()
            if k == 0:  # a flash on every cut
                fr = Image.eval(fr, lambda v: min(255, int(v * 1.25)))
            caption(fr, "THEY DON'T SMILE." if i < 42 else "THEY DON'T POSE.")
            fr.save(out / f"b{i:04d}.png")
            i += 1


def assembly(out: Path, n=208):
    """2.5 s: the four pieces of set #n slide in from the corners and lock."""
    first = SINGLES + 4 * (n - 1)
    pieces = [Image.open(ART / "images" / f"{first + q}.png").convert("RGB").resize((360, 360), Image.NEAREST) for q in range(4)]
    home = [(280, 0), (640, 0), (280, 360), (640, 360)]
    away = [(-120, -140), (120, -140), (-120, 140), (120, 140)]
    total, lock = 60, 40
    for i in range(total):
        t = min(1.0, i / lock)
        e = 1 - (1 - t) ** 3
        fr = Image.new("RGB", (W, H), INK)
        for q in range(4):
            dx, dy = away[q]
            fr.paste(pieces[q], (int(home[q][0] + dx * (1 - e)), int(home[q][1] + dy * (1 - e))))
        if lock <= i < lock + 3:  # the click
            fr = Image.eval(fr, lambda v: min(255, int(v * 1.35)))
        caption(fr, "FOUR PIECES. ONE FACE.")
        fr.save(out / f"c{i:04d}.png")


def wall(out: Path, arts):
    """1.5 s: from one close-up to a wall of them."""
    singles = [a["artId"] for a in arts if "set" not in a and trait(a, "Anomaly") == "None"]
    rng = random.Random(9)
    tiles = rng.sample(singles, 16 * 9)
    big = Image.new("RGB", (16 * 160, 9 * 160), INK)
    for k, aid in enumerate(tiles):
        big.paste(Image.open(ART / "images" / f"{aid}.png").convert("RGB").resize((160, 160), Image.NEAREST), ((k % 16) * 160, (k // 16) * 160))
    frames = 36
    for i in range(frames):
        t = (i / (frames - 1)) ** 2
        cw = int(320 + (big.width - 320) * t)
        ch = cw * 9 // 16
        cx, cy = big.width // 2, big.height // 2
        crop = big.crop((cx - cw // 2, cy - ch // 2, cx - cw // 2 + cw, cy - ch // 2 + ch))
        fr = crop.resize((W, H), Image.NEAREST)
        caption(fr, "THE ART LIVES ON THE CHAIN.")
        fr.save(out / f"d{i:04d}.png")


def card(out: Path, arts):
    """4 s: the opening face and the name, powering on like a neon sign."""
    # the face that opened the trailer closes it
    eye = Image.open(ART / "images" / "set-124.png").convert("RGB").resize((360, 360), Image.NEAREST)
    base = Image.new("RGB", (W, H), INK)
    base.paste(eye, (110, 180))
    for k in range(4):  # frame
        base.paste(NEON, (90 + k, 160 + k, 1190 - k, 161 + k))
        base.paste(NEON, (90 + k, 559 - k, 1190 - k, 560 - k))
        base.paste(NEON, (90 + k, 160 + k, 91 + k, 560 - k))
        base.paste(NEON, (1189 - k, 160 + k, 1190 - k, 560 - k))
    if NO_NAME:
        draw_text(base, "THEY DON'T BLINK.", 820, 300, 6, NEON, "center")
        draw_text(base, "ROBINHOOD CHAIN", 820, 420, 5, DIM, "center")
    else:
        draw_text(base, "NEONFACES", 820, 290, 12, NEON, "center")
        draw_text(base, "NEONFACES.XYZ", 820, 420, 5, DIM, "center")
    dark = Image.eval(base, lambda v: v // 6)
    flicker = [0, 1, 0, 0, 1, 1, 0, 1]  # off/on for the first frames, then steady
    for i in range(96):
        fr = base if i >= len(flicker) or flicker[i] else dark
        fr.save(out / f"e{i:04d}.png")


def push_in(out: Path, start: Image.Image):
    """2.6 s after the glitch: the neon powers on and the camera closes in on the eyes of the pixel face."""
    rng = random.Random(3)
    frames = 62
    for i in range(frames):
        z = 1.0 + 0.45 * (i / (frames - 1)) ** 1.5
        cw, ch = int(W / z), int(H / z)
        cx, cy = W // 2, int(H * 0.40)
        fr = start.crop((cx - cw // 2, cy - ch // 2, cx - cw // 2 + cw, cy - ch // 2 + ch)).resize((W, H), Image.NEAREST)
        if i < 8 and i % 3 == 1:  # the tube catching
            fr = Image.eval(fr, lambda v: v // 3)
        if i in (14, 15, 37):  # a row slips, like the glitch that opened it
            y0 = rng.randrange(120, 520)
            band = fr.crop((0, y0, W, y0 + 36))
            fr.paste(band, (rng.choice([-48, 48]), y0))
        caption(fr, "THEY DON'T BLINK.")
        fr.save(out / f"a{i:04d}.png")


def main():
    hero = HERE / "hero.mp4"
    if not hero.exists():
        sys.exit("marketing/trailer/hero.mp4 missing (the generated opening shot)")
    arts = art()
    with tempfile.TemporaryDirectory() as t:
        tmp = Path(t)
        montage(tmp, arts)
        assembly(tmp)
        wall(tmp, arts)
        card(tmp, arts)
        # hero: the Veo glitch (0-0.9 s), then the push-in on the pixel face
        cap = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        cap_rgb = Image.new("RGB", (W, H), INK)
        caption(cap_rgb, "THEY DON'T BLINK.")
        mask = Image.new("L", (W, H), 0)
        mask.paste(255, (0, H - 150, W, H - 40))
        cap.paste(cap_rgb, (0, 0), mask)
        cap.save(tmp / "hero-cap.png")
        run(["-i", str(hero), "-i", str(tmp / "hero-cap.png"), "-filter_complex",
             f"[0:v]scale={W}:{H},fps={FPS},trim=0:0.9,setpts=PTS-STARTPTS[h];[h][1:v]overlay=0:0[v]",
             "-map", "[v]", "-an", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", str(tmp / "a0.mp4")])
        push_in(tmp, Image.open(HERE / "hero-start.png").convert("RGB"))
        run(["-framerate", str(FPS), "-i", str(tmp / "a%04d.png"), "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", str(tmp / "a1.mp4")])
        (tmp / "hero.txt").write_text("".join(f"file '{tmp / p}'\n".replace("\\", "/") for p in ("a0.mp4", "a1.mp4")))
        run(["-f", "concat", "-safe", "0", "-i", str(tmp / "hero.txt"), "-c", "copy", str(tmp / "a.mp4")])
        for part in "bcde":
            run(["-framerate", str(FPS), "-i", str(tmp / f"{part}%04d.png"), "-c:v", "libx264", "-crf", "16",
                 "-pix_fmt", "yuv420p", str(tmp / f"{part}.mp4")])
        (tmp / "list.txt").write_text("".join(f"file '{tmp / p}.mp4'\n".replace("\\", "/") for p in "abcde"))
        run(["-f", "concat", "-safe", "0", "-i", str(tmp / "list.txt"), "-c", "copy", str(tmp / "video.mp4")])
        # audio: teaser 1 (zap + "They don't blink."), the ticking of teaser 3, then teaser 5 (riser, hit, the last line)
        run(["-i", str(tmp / "video.mp4"), "-i", str(TEASERS / "1-signal.mp4"), "-i", str(TEASERS / "3-eyes.mp4"), "-i", str(TEASERS / "5-soon.mp4"),
             "-filter_complex",
             "[1:a]atrim=0:3.5,afade=t=out:st=3.2:d=0.3[a1];"
             "[2:a]atrim=0:3.6,asetpts=PTS-STARTPTS,volume=3.2,afade=t=in:d=0.1,afade=t=out:st=3.3:d=0.3,adelay=3500|3500[a2];"
             "[3:a]atrim=0:7.8,asetpts=PTS-STARTPTS,adelay=7200|7200[a3];"
             "[a1][a2][a3]amix=inputs=3:normalize=0,atrim=0:15[a]",
             "-map", "0:v", "-map", "[a]", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-t", "15",
             str(OUT)])
    print(OUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
