"""Plan B's still (1 Oct): if the mint moves to neonfaces.xyz, the post that says so. Her Face (#419, the young woman
of the eye) in neon, on the dim wall of the collection, and where to mint. 4:5 for X.

    python marketing/movement/make_site_post.py     # -> out/l-site-mint-4x5.png (with today's time), out/l-site-mint-any-4x5.png
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import make_launch as ml  # noqa: E402
from make_cut import H, NEON, PALE, W, draw_text  # noqa: E402

TOP, H45 = 285, 1350  # the 4:5 crop of the 1080 x 1920 frame, a little higher than the videos' (the face sits high)


def still(lines, out):
    bg = Image.fromarray(ml.wall_bg(19, dim=0.13))
    d = ImageDraw.Draw(bg)
    for k in range(6):
        d.rectangle([60 + k, TOP + 60 + k, W - 61 - k, TOP + H45 - 61 - k], outline=NEON)
    size = 540
    bg.paste(ml.art_img(419, size), ((W - size) // 2, TOP + 150))
    y = TOP + 150 + size + 70
    for text, cell, col in lines:
        if text:
            draw_text(bg, text, W // 2, y, cell, col, "center")
        y += 11 * cell
    im = bg.crop((0, TOP, W, TOP + H45))
    im.save(HERE / "out" / out)
    print(f"out/{out}")


def banner(out, bw=2800, bh=800):
    """OpenSea's collection banner while the page can't sell (it shows 0 available): where the mint really is. 4:1 at
    twice OpenSea's 1400 x 350, everything inside the middle half so the phone crop keeps it."""
    rng = ml.random.Random(23)
    tile = 200
    im = Image.new("RGB", (bw, bh), (0, 0, 0))
    for y in range(0, bh, tile):
        for x in range(0, bw, tile):
            im.paste(ml.art_img(rng.randrange(5555), tile), (x, y))
    im = Image.fromarray((np.asarray(im).astype(np.float32) * 0.12).astype(np.uint8))
    d = ImageDraw.Draw(im)
    cx = bw // 2
    for k in range(5):
        d.rectangle([cx - 760 + k, 150 + k, cx + 760 - k, bh - 150 - k], outline=NEON)
    draw_text(im, "THE MINT IS ON", cx, 215, 8, PALE, "center")
    draw_text(im, "NEONFACES.XYZ", cx, 320, 13, NEON, "center")
    draw_text(im, "SAME LIST. SAME TERMS. THROUGH OPENSEA'S SEADROP.", cx, 500, 4, PALE, "center")
    im.save(HERE / "out" / out, optimize=True)
    print(f"out/{out} {bw}x{bh}")


ml.mc.FONT["%"] = ["11001", "11010", "00010", "00100", "01000", "01011", "10011"]


def split_still(out):
    """2 Oct: where 0.013 ETH goes, as the contracts split it (NeonPayout is immutable; OpenSea's fee is SeaDrop's)."""
    bg = Image.fromarray(ml.wall_bg(31, dim=0.09))
    d = ImageDraw.Draw(bg)
    for k in range(6):
        d.rectangle([60 + k, TOP + 60 + k, W - 61 - k, TOP + H45 - 61 - k], outline=NEON)
    y = TOP + 130
    draw_text(bg, "WHERE 0.013 ETH GOES", W // 2, y, 7, NEON, "center")
    rows = [("49.5%", "THE FACES' BASKETS", "A VAULT THAT CAN ONLY BUY THEM", NEON),
            ("10%", "OPENSEA", "ITS FEE ON SEADROP", PALE),
            ("13.5%", "TREASURY", "THE MULTISIG: ART, SITE, AUDIT", PALE),
            ("13.5%", "TEAM", "STREAMED OVER 6 MONTHS", PALE),
            ("13.5%", "GROWTH", "COLLABS AND REACH", PALE)]
    y += 130
    bar_x0, bar_w = 120, W - 240
    for pct, name, note, col in rows:
        v = float(pct.rstrip("%")) / 100
        d.rectangle([bar_x0, y, bar_x0 + int(bar_w * v / 0.5), y + 34], fill=col)
        draw_text(bg, pct, bar_x0, y + 50, 5, col, "left")
        draw_text(bg, name, bar_x0 + 210, y + 50, 5, col, "left")
        draw_text(bg, note, bar_x0, y + 100, 3, PALE, "left")
        y += 170
    draw_text(bg, "FIXED IN THE CONTRACTS. CHECK IT ON CHAIN.", W // 2, TOP + H45 - 150, 4, PALE, "center")
    bg.crop((0, TOP, W, TOP + H45)).save(HERE / "out" / out)
    print(f"out/{out}")


def list_still(out, names):
    """2 Oct: the communities on the list (the founder made them public) and the list stage alone (no public terms)."""
    bg = Image.fromarray(ml.wall_bg(37, dim=0.09))
    d = ImageDraw.Draw(bg)
    for k in range(6):
        d.rectangle([60 + k, TOP + 60 + k, W - 61 - k, TOP + H45 - 61 - k], outline=NEON)
    y = TOP + 120
    draw_text(bg, "ON THE LIST", W // 2, y, 9, NEON, "center")
    y += 130
    for n in names:
        draw_text(bg, n, W // 2, y, 5, PALE, "center")
        y += 68
    y += 30
    draw_text(bg, "3 FACES EACH AT 0.013 ETH", W // 2, y, 6, NEON, "center")
    draw_text(bg, "UNTIL 18:00 UTC TODAY", W // 2, y + 80, 5, NEON, "center")
    draw_text(bg, "MINT ON NEONFACES.XYZ", W // 2, y + 160, 4, PALE, "center")
    bg.crop((0, TOP, W, TOP + H45)).save(HERE / "out" / out)
    print(f"out/{out}")


def contracts_still(out):
    """2 Oct: the team's vesting and what the contracts fix (all read on-chain: VestingWallet start 28 Sep 18:54 UTC,
    duration 180 days, beneficiary the team wallet; NeonPayout immutable; the Safe 2-of-2 holds the admin role)."""
    bg = Image.fromarray(ml.wall_bg(43, dim=0.09))
    d = ImageDraw.Draw(bg)
    for k in range(6):
        d.rectangle([60 + k, TOP + 60 + k, W - 61 - k, TOP + H45 - 61 - k], outline=NEON)
    y = TOP + 120
    draw_text(bg, "THE TEAM WAITS TOO", W // 2, y, 7, NEON, "center")
    draw_text(bg, "OUR SHARE STREAMS OVER 180 DAYS", W // 2, y + 100, 4, PALE, "center")
    draw_text(bg, "IN A VESTING CONTRACT", W // 2, y + 150, 4, PALE, "center")
    facts = ["THE SPLIT IS FIXED IN NEONPAYOUT", "THE VAULT CAN ONLY BUY BASKETS", "5555 FACES. NO PROXY.",
             "TRANSFERS CAN NEVER BE PAUSED", "THE ART IS SEALED ON CHAIN", "ADMIN: A 2 OF 2 MULTISIG"]
    y += 270
    for f in facts:
        d.rectangle([140, y + 8, 164, y + 32], fill=NEON)
        draw_text(bg, f, 190, y, 4, PALE, "left")
        y += 100
    draw_text(bg, "EVERY CONTRACT IS VERIFIED.", W // 2, TOP + H45 - 200, 4, NEON, "center")
    draw_text(bg, "CHECK IT YOURSELF. NEONFACES.XYZ", W // 2, TOP + H45 - 140, 4, PALE, "center")
    bg.crop((0, TOP, W, TOP + H45)).save(HERE / "out" / out)
    print(f"out/{out}")


if __name__ == "__main__":
    if "--contracts" in sys.argv:
        contracts_still("l-contracts-4x5.png")
        sys.exit()
    if "--day2" in sys.argv:
        split_still("l-split-4x5.png")
        list_still("l-list-names-4x5.png", ["STONKBROKERS", "NORMIES", "NORMIES YACHT CLUB", "CRYPTOPUNKS", "BORED APE YACHT CLUB",
                                            "PUDGY PENGUINS", "NAKAMIGOS", "MEEBITS", "CHIMPERS", "ON THE WALL", "JPEG FRENS"])
        sys.exit()
    banner("opensea-banner-site.png")
    still([("THE MINT IS ON", 7, PALE), ("NEONFACES.XYZ", 11, NEON), ("", 3, PALE), ("TODAY 18:00 UTC", 7, NEON),
           ("SAME TERMS. CONNECT YOUR WALLET.", 5, PALE)], "l-site-mint-4x5.png")
    still([("THE MINT IS ON", 7, PALE), ("NEONFACES.XYZ", 11, NEON), ("", 3, PALE),
           ("CONNECT YOUR WALLET THERE.", 5, PALE)], "l-site-mint-any-4x5.png")
