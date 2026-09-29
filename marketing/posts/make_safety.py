"""The safety card: the reply pinned under the announcement (29 Sep). NEONCAM's lit page, like the link preview: neon
field with its dots, black type, the eye that never blinks in a black frame, the official links and the contract, and
the photo's black band with the rules. Run from the repo root:
    python marketing/posts/make_safety.py      # -> marketing/posts/6-safety.png (1200 x 1200)
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(ROOT / "marketing" / "movement"), str(ROOT / "art")]
import make_cut as mc  # noqa: E402  (the 5x7 pixel font of the films)

S = 1200
NEON, INK, PALE = (204, 255, 0), (0, 0, 0), (242, 255, 200)
DEEP = (40, 50, 8)
MONO = "C:/Windows/Fonts/consolab.ttf"  # links and the address must read exactly, lowercase included

img = Image.new("RGB", (S, S), NEON)
d = ImageDraw.Draw(img)
for y in range(11, S, 22):  # the lit page's dots
    for x in range(11, S, 22):
        d.rectangle([x, y, x + 1, y + 1], fill=(170, 212, 0))

# the eye that never blinks, cut from the logo, in a black frame with the site's offset shadow
eye = Image.open(ROOT / "brand" / "logo.png").convert("RGB").crop((0, 88, 512, 336))
eye = eye.resize((768, 372), Image.NEAREST)
x0, y0 = (S - eye.width - 16) // 2, 56
d.rectangle([x0 + 14, y0 + 14, x0 + eye.width + 30, y0 + eye.height + 30], fill=INK)
d.rectangle([x0, y0, x0 + eye.width + 16, y0 + eye.height + 16], fill=INK)
img.paste(eye, (x0 + 8, y0 + 8))

y = y0 + eye.height + 70
mc.draw_text(img, "OFFICIAL LINKS", S // 2, y, 9, INK, "center")
big = ImageFont.truetype(MONO, 50)
small = ImageFont.truetype(MONO, 31)
y += 108
for line in ("neonfaces.xyz", "opensea.io/collection/neonfaces"):
    d.text((S // 2, y), line, font=big, fill=INK, anchor="mt")
    y += 70
y += 22
mc.draw_text(img, "THE CONTRACT ON ROBINHOOD CHAIN", S // 2, y, 4, DEEP, "center")
y += 52
d.text((S // 2, y), "0x67384d956ac12f2C4a69167BF0DC67A3F72C1C1B", font=small, fill=INK, anchor="mt")

# the NEONCAM photo's band, taller: the rules in neon on black
band = 236
d.rectangle([0, S - band, S, S], fill=INK)
d.rectangle([0, S - band - 5, S, S - band - 2], fill=INK)
for k, (line, col) in enumerate([("WE NEVER DM FIRST.", NEON), ("NO AIRDROP. NO CLAIM.", NEON),
                                 ("NEVER SHARE YOUR SEED PHRASE.", PALE)]):
    mc.draw_text(img, line, S // 2, S - band + 36 + k * 62, 6, col, "center")

out = Path(__file__).resolve().parent / "6-safety.png"
img.save(out, optimize=True)
print(out, img.size)
