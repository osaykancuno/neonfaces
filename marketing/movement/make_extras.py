"""The five images and five GIFs of the movement, from the stills, the clips and the finished videos.

    python marketing/movement/make_extras.py        (after make_cut.py) -> out/i1..i5 (-4x5.png, -9x16.png), out/g1..g5.gif
    python marketing/movement/make_extras.py gifs2  -> out/g6..g12.gif (4:5 reaction GIFs of the second batch)

Images: the over-the-shoulder heroes (high, 2k) with the real Face on the screen, the line in the pixel font.
GIFs: 480 px wide loops of 2-3 s, well under X's 15 MB.
"""
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import make_cut as C  # noqa: E402
from make_frames import paste  # noqa: E402

OUT = HERE / "out"
LINES = {
    "i1": ("h1", "THEY DON'T BLINK."),
    "i2": ("h2", "THE MARKET NEVER CLOSES."),
    "i3": ("h3", "EVERY FACE IS A WALLET."),
    "i5": ("h5", "THE LONGER IT STAYS, THE HARDER IT STARES."),
}


def sign(img: Image.Image, line: str, y: int):
    two = C.text_width(line, 7) > 960  # caption() wraps it: the block moves up a line
    y -= 80 if two else 0
    C.caption(img, line, y=y, cell=7)
    C.draw_text(img, "NEONFACES", C.W // 2, y + (230 if two else 150), 5, C.DIM, "center")


def hero(shot: str, line: str, name: str):
    src = Image.open(HERE / "frames" / f"{shot}.png").convert("RGB")
    tall = src.resize((1080, 1920), Image.LANCZOS)
    t = tall.copy()
    sign(t, line, 1560)
    t.save(OUT / f"{name}-9x16.png")
    # 4:5: the part of the frame with the face and the screen (the lower middle of these shots)
    feed = tall.crop((0, 420, 1080, 1770)).copy()
    sign(feed, line, 1090)
    feed.save(OUT / f"{name}-4x5.png")


def grid4(name: str):
    """I4: the four people with the four pieces, 2 x 2, then the line."""
    tiles = []
    for p in ["p1", "p2", "p3", "p4"]:
        im = Image.open(HERE / "frames" / f"{p}.png").convert("RGB").resize((540, 965), Image.LANCZOS)
        tiles.append(im)
    tall = Image.new("RGB", (1080, 1920), C.INK)
    for k, im in enumerate(tiles):
        tall.paste(im.crop((0, 0, 540, 960)), ((k % 2) * 540, (k // 2) * 960))
    t = tall.copy()
    sign(t, "ONE FACE. FOUR PIECES.", 1560)
    t.save(OUT / f"{name}-9x16.png")
    feed = Image.new("RGB", (1080, 1350), C.INK)
    for k, im in enumerate(tiles):
        feed.paste(im.crop((0, 250, 540, 925)), ((k % 2) * 540, (k // 2) * 675))
    sign(feed, "ONE FACE. FOUR PIECES.", 1110)
    feed.save(OUT / f"{name}-4x5.png")


def gif(frames, name: str, fps=12, size=(480, 853)):
    with tempfile.TemporaryDirectory() as t:
        for i, f in enumerate(frames):
            Image.fromarray(f).resize(size, Image.LANCZOS).save(Path(t) / f"f{i:04d}.png")
        pattern = str(Path(t) / "f%04d.png")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", str(fps), "-i", pattern, "-vf",
                        "split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4",
                        "-loop", "0", str(OUT / f"{name}.gif")], check=True)


def every(gen, step=2):
    return [f for i, f in enumerate(gen) if i % step == 0]


def gifs():
    # G1 caught looking: she lifts her eyes to the lens (and back: a seamless loop)
    up = every(C.real("v1-a", 1.2, 3.6, "CAUGHT YOU LOOKING."))
    gif(up + up[::-1], "g1")
    # G2 switch on: the screen is dark, then the Face flickers in
    raw = Image.open(HERE / "raw" / "h3.png")
    dark = paste(raw, Image.new("RGB", (48, 48), (0, 0, 0))).resize((1080, 1920), Image.LANCZOS)
    lit = Image.open(HERE / "frames" / "h3.png").convert("RGB").resize((1080, 1920), Image.LANCZOS)
    d, li = np.asarray(dark), np.asarray(lit)
    seq = [d] * 8 + [li, d, li, li, d, d] + [li] * 16
    gif([C.with_caption(f, "SWITCH ON. STARE BACK.") for f in seq], "g2")
    # G3 the chart lives in the eye: bars rise in the pupil
    g3 = [np.asarray(C.chamber(i / 12, objects=False, bars=min(1.0, i / 18))) for i in range(30)]
    gif([C.with_caption(f, "THE CHART LIVES IN THE EYE.") for f in g3], "g3")
    # G4 click: the four pieces lock
    gif(every(C.assembly(3.0, "CLICK.")), "g4")
    # G5 Steady, Fixed, Piercing
    gif(every(C.gaze("f198", 4.8)), "g5")


def gif45(frames, name: str, fps=12):
    """A 4:5 GIF (480 x 600, the middle of the 9:16 frame, where the captions sit): reaction GIFs for replies."""
    gif([np.ascontiguousarray(f[360:1710]) for f in frames], name, fps, size=(480, 600))


def gifs2():
    """Reaction GIFs of the second batch (28 Sep): a line anyone can reuse in a reply, and always the collection in it
    (the founder: a real face turns into its Face, or the pixels alone)."""
    import make_launch as L

    def person(clip, t0, face, line, t_turn=3.7):
        s = every(C.real(clip, t0, t_turn, line)) + every(C.turn(clip, t_turn - 0.1, face, 2.4, line))
        return s + [s[-1]] * 10

    gif45(person("l-a", 1.8, "f130", "WHEN YOUR WALLET IS ON THE LIST."), "g6")
    gif45(person("m-a", 0.8, "f58", "THE NIGHT BEFORE THE MINT.", t_turn=2.6), "g7")
    gif45(person("n1-a", 1.6, "f336", "EVERYONE RUSHES. YOU DON'T."), "g8")
    face = Image.open(HERE / "refs" / "cam-539.png")
    s = every(C.real("c-a", 1.2, 3.0, "MY NEW PFP.")) + every(L.cam_turn(face, 2.0, "MY NEW PFP."))
    gif45(s + [s[-1]] * 10, "g9")
    s = every(C.turn("n3-c", 3.6, "f226", 3.0, "HOW THEY SEE YOU."))
    gif45(s + [s[-1]] * 8, "g10")
    # the pixels alone: a wall of Faces lighting up, and the count
    s = every(C.grid("f226", 3.0, "THEY DON'T BLINK.", seed=11))
    gif45(s + [s[-1]] * 8, "g11")
    gif45(every(L.counter(3.5, "5555 FACES.")), "g12")


def main():
    OUT.mkdir(exist_ok=True)
    for name, (shot, line) in LINES.items():
        hero(shot, line, name)
    grid4("i4")
    gifs()
    for f in sorted(OUT.glob("*")):
        print(f"out/{f.name}  {f.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    gifs2() if sys.argv[1:] == ["gifs2"] else main()
