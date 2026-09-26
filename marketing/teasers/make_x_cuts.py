"""X cuts of the teasers: a stronger first second and pixel captions for muted autoplay.

The Higgsfield virality proxy scored video 1 at hook 39 / sustain 85: it held attention
but opened on a near-black frame. Each cut keeps the length and the audio, and:
- replaces the first 0.4 s (the still start frame) with the clip's strongest frame,
- lifts the brightness of the first 2 s,
- draws the voice line in the collection's pixel font while it is spoken.
Run from the repo root (ffmpeg on PATH):
    python marketing/teasers/make_x_cuts.py
"""
import subprocess
import sys
import tempfile
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "posts"))
from make_posts import INK, PALE, draw_text, text_width  # noqa: E402

# clip, strongest frame (s), [(caption, start, end)]
CUTS = [
    ("1-signal", 7.0, [("THEY DON'T BLINK.", 0.0, 1.8)]),
    ("2-watching", 5.0, [("SOMEONE HAS TO KEEP WATCHING.", 2.9, 5.2)]),
    ("3-eyes", 4.0, [("THE MARKET NEVER CLOSES.", 3.7, 5.8)]),
    ("4-gaze", 5.5, [("THE STARE CAN WORK.", 0.0, 1.6)]),
    ("5-soon", 2.4, [("NEITHER DO I.", 5.4, 6.9)]),
]
CELL = 5


def caption_png(text, path):
    w = text_width(text, CELL) + 8 * CELL
    img = Image.new("RGBA", (w, 7 * CELL + 6 * CELL), INK + (190,))
    draw_text(img, text, 4 * CELL, 3 * CELL, CELL, PALE + (255,))
    img.save(path)


def run(args):
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def cut(name, hook_at, captions, tmp):
    src = HERE / f"{name}.mp4"
    hook = tmp / f"{name}-hook.png"
    run(["-ss", str(hook_at), "-i", str(src), "-frames:v", "1", str(hook)])
    inputs = ["-i", str(src), "-loop", "1", "-t", "0.4", "-framerate", "24", "-i", str(hook)]
    chain = [
        "[0:v]eq=brightness=0.06:contrast=1.12:enable='lt(t,2)'[b]",
        "[1:v]format=yuv420p[h]",
        "[b][h]overlay=0:0:enable='lt(t,0.4)'[v0]",
    ]
    last = "v0"
    for i, (text, start, end) in enumerate(captions):
        png = tmp / f"{name}-cap{i}.png"
        caption_png(text, png)
        inputs += ["-i", str(png)]
        chain.append(f"[{last}][{i + 2}:v]overlay=(W-w)/2:H-h-56:enable='between(t,{start},{end})'[v{i + 1}]")
        last = f"v{i + 1}"
    run([*inputs, "-filter_complex", ";".join(chain), "-map", f"[{last}]", "-map", "0:a",
         "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", "-c:a", "copy",
         "-t", "8", str(HERE / f"x-{name}.mp4")])


if __name__ == "__main__":
    only = sys.argv[1:]
    with tempfile.TemporaryDirectory() as t:
        for name, hook_at, captions in CUTS:
            if not only or name in only:
                cut(name, hook_at, captions, Path(t))
                print("x-" + name + ".mp4")
