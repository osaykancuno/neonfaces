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


ml.mc.FONT["$"] = ["00100", "01111", "10100", "01110", "00101", "11110", "00100"]
ml.mc.FONT["+"] = ["00000", "00100", "00100", "11111", "00100", "00100", "00000"]


def tiers_still(out):
    """What the baskets hold (docs/ECONOMICS.md) and who gets which: the base for every Face at mint, the Watch and Heavy
    Stare top-ups drawn on-chain at the reveal (833 and 278 of 5555), the set bonus."""
    bg = Image.fromarray(ml.wall_bg(47, dim=0.09))
    d = ImageDraw.Draw(bg)
    for k in range(6):
        d.rectangle([60 + k, TOP + 60 + k, W - 61 - k, TOP + H45 - 61 - k], outline=NEON)
    draw_text(bg, "INSIDE EVERY FACE", W // 2, TOP + 120, 7, NEON, "center")
    rows = [("EVERY FACE", "5555", "$5 OF ONE STOCK TOKEN AT MINT", PALE),
            ("WATCH", "833", "+$5 AT THE REVEAL. $10 INSIDE", PALE),
            ("HEAVY STARE", "278", "+$10 AT THE REVEAL. $15 INSIDE", NEON),
            ("A FULL SET", "555", "+$5 ONCE, WHEN ASSEMBLED", PALE)]
    y = TOP + 270
    for name, n, what, col in rows:
        draw_text(bg, name, 130, y, 6, col, "left")
        draw_text(bg, n, W - 130 - ml.mc.text_width(n, 6), y, 6, col, "left")
        draw_text(bg, what, 130, y + 85, 4, PALE, "left")
        d.rectangle([130, y + 150, W - 130, y + 152], fill=(60, 72, 20))
        y += 200
    draw_text(bg, "TIERS ARE DRAWN ON CHAIN AT THE REVEAL.", W // 2, TOP + H45 - 200, 4, NEON, "center")
    draw_text(bg, "VALUES IN DOLLARS WHEN SET. THEY MOVE.", W // 2, TOP + H45 - 140, 4, PALE, "center")
    bg.crop((0, TOP, W, TOP + H45)).save(HERE / "out" / out)
    print(f"out/{out}")


def terms_still(out):
    """Not used (the founder, 3 Oct: the project is presented as it is today). The terms (top-ups and set bonus, a lower price for the communities' list, a Face more
    from the team's share for each of the first 18 Faces bought). No price on the image (the founder's rule)."""
    bg = Image.fromarray(ml.wall_bg(59, dim=0.09))
    d = ImageDraw.Draw(bg)
    for k in range(6):
        d.rectangle([60 + k, TOP + 60 + k, W - 61 - k, TOP + H45 - 61 - k], outline=NEON)
    draw_text(bg, "NEW TERMS", W // 2, TOP + 130, 9, NEON, "center")
    rows = [("THE SAME BASE", "$5 OF ONE STOCK TOKEN IN EVERY FACE"),
            ("SMALLER TOP-UPS", "WATCH +$5. HEAVY STARE +$10"),
            ("A LOWER PRICE", "FOR THE LIST OF OUR COMMUNITIES"),
            ("A FACE MORE", "FOR EACH OF THE FIRST 18 FACES")]
    y = TOP + 320
    for head, sub in rows:
        d.rectangle([130, y + 10, 156, y + 36], fill=NEON)
        draw_text(bg, head, 190, y, 6, PALE, "left")
        draw_text(bg, sub, 190, y + 80, 4, PALE, "left")
        y += 190
    draw_text(bg, "UP TO 15 PER WALLET. UNTIL 31 OCTOBER.", W // 2, TOP + H45 - 200, 4, NEON, "center")
    draw_text(bg, "NEONFACES.XYZ", W // 2, TOP + H45 - 140, 5, PALE, "center")
    bg.crop((0, TOP, W, TOP + H45)).save(HERE / "out" / out)
    print(f"out/{out}")


def listened_still(out):
    """2 Oct afternoon: the reset post (the price lowered to the basket floor, a Face more for every early Face, a safe mint)."""
    bg = Image.fromarray(ml.wall_bg(53, dim=0.09))
    d = ImageDraw.Draw(bg)
    for k in range(6):
        d.rectangle([60 + k, TOP + 60 + k, W - 61 - k, TOP + H45 - 61 - k], outline=NEON)
    draw_text(bg, "WE LISTENED", W // 2, TOP + 130, 9, NEON, "center")
    rows = [("A LOWER PRICE", "AS LOW AS THE BASKETS ALLOW"),
            ("A FACE MORE", "FOR EVERY FACE MINTED BEFORE"),
            ("ONE SAFE SIGNATURE", "TO OPENSEA'S SEADROP. NO APPROVALS"),
            ("A REAL BASKET", "STILL INSIDE EVERY FACE")]
    y = TOP + 320
    for head, sub in rows:
        d.rectangle([130, y + 10, 156, y + 36], fill=NEON)
        draw_text(bg, head, 190, y, 6, PALE, "left")
        draw_text(bg, sub, 190, y + 80, 4, PALE, "left")
        y += 190
    draw_text(bg, "UP TO 15 PER WALLET. UNTIL 31 OCTOBER.", W // 2, TOP + H45 - 200, 4, NEON, "center")
    draw_text(bg, "NEONFACES.XYZ", W // 2, TOP + H45 - 140, 5, PALE, "center")
    bg.crop((0, TOP, W, TOP + H45)).save(HERE / "out" / out)
    print(f"out/{out}")


if __name__ == "__main__":
    if "--listened" in sys.argv:
        listened_still("l-listened-4x5.png")
        sys.exit()
    if "--tiers" in sys.argv:
        tiers_still("l-tiers2-4x5.png")
        sys.exit()
    if "--terms" in sys.argv:
        terms_still("l-terms-4x5.png")
        sys.exit()
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
