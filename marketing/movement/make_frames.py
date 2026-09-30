"""Put the exact on-chain Face on the phone screen of a generated over-the-shoulder frame.

    python marketing/movement/make_frames.py raw/ots-54.png f54 frames/ots-54.png

The generator is asked for a screen of one flat acid lime colour (a green screen, and the light on the face stays
right). Here the screen is found as the largest lime area, its four corners fitted, and the Face drawn into it in
perspective: black screen, the square Face across its width, as a phone shows an image. The screen keeps the
generated frame's own shading (glare, falloff), fingers over the screen stay in front, and a faint glow spills
around the edges. <face> is a name in refs/ (f<set> or piece-337-<k>).
"""
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent


def screen_mask(rgb: np.ndarray) -> np.ndarray:
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    h, s, v = hsv[..., 0].astype(int), hsv[..., 1].astype(int), hsv[..., 2].astype(int)
    m = ((h >= 28) & (h <= 48) & (s >= 150) & (v >= 170)).astype(np.uint8)  # OpenCV hue: #CCFF00 is about 38
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
    if n < 2:
        raise SystemExit("no lime screen found")
    big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return (lab == big).astype(np.uint8)


def corners(mask: np.ndarray, wide: bool = False) -> np.ndarray:
    """Four corners of the screen, ordered top-left, top-right, bottom-right, bottom-left in the screen's own frame
    (its top is the short edge higher in the picture; the long one for a laptop, wide=True)."""
    hull = cv2.convexHull(cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0][0]).reshape(-1, 2)
    # each corner of the smallest enclosing rectangle pulls the screen's own nearest point: robust to a thumb
    # cutting into the screen (a polygon fit would take the notch for a corner) and it keeps the perspective
    box = cv2.boxPoints(cv2.minAreaRect(hull.astype(np.float32)))
    quad = np.float32([hull[np.argmin(((hull - b) ** 2).sum(1))] for b in box])
    # order around the centre, then rotate so edge 0-1 is the upper short edge
    c = quad.mean(0)
    quad = quad[np.argsort(np.arctan2(quad[:, 1] - c[1], quad[:, 0] - c[0]))]
    edges = [np.linalg.norm(quad[(i + 1) % 4] - quad[i]) for i in range(4)]
    short = 0 if edges[0] + edges[2] < edges[1] + edges[3] else 1
    if wide:
        short = 1 - short
    cand = [short, short + 2]
    top = min(cand, key=lambda i: (quad[i][1] + quad[(i + 1) % 4][1]))
    return np.roll(quad, -top, axis=0)


def screen_image(face: Image.Image, w: int, h: int) -> np.ndarray:
    scr = Image.new("RGB", (w, h), (0, 0, 0))
    if w > h:  # a laptop: the square Face at full height, centred
        scr.paste(face.convert("RGB").resize((h, h), Image.NEAREST), ((w - h) // 2, 0))
        return np.asarray(scr, np.float32)
    side = w
    f = face.convert("RGB").resize((side, side), Image.NEAREST)
    scr.paste(f, (0, int(h * 0.44 - side / 2)))
    return np.asarray(scr, np.float32)


def paste(frame: Image.Image, face: Image.Image, wide: bool = False) -> Image.Image:
    rgb = np.asarray(frame.convert("RGB"))
    mask = screen_mask(rgb)
    q = corners(mask, wide)
    wpx = int(np.linalg.norm(q[1] - q[0]))
    hpx = int(np.linalg.norm(q[3] - q[0]))
    k = 4  # draw the screen larger, then let the warp average it down: crisp cells, no jaggies
    src = screen_image(face, wpx * k, hpx * k)
    sq = np.float32([[0, 0], [wpx * k, 0], [wpx * k, hpx * k], [0, hpx * k]])
    # the fitted corners sit a little inside the rounded, anti-aliased lime edge: the picture goes 4% wider and
    # everything lime around the quad is covered too, so no lime rim is left
    c = q.mean(0)
    qx = c + (q - c) * 1.04
    M = cv2.getPerspectiveTransform(sq, qx)
    H, W = mask.shape
    warped = cv2.warpPerspective(src, M, (W, H), flags=cv2.INTER_AREA)
    # the screen area: lime pixels (fingers over the screen are not lime, so they stay), grown over the soft edge
    # plus the screen's rounded, anti-aliased rim: bright lime pixels up to 4 px out (lime-lit skin is darker)
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV).astype(int)
    rim = (hsv[..., 0] >= 25) & (hsv[..., 0] <= 50) & (hsv[..., 1] >= 90) & (hsv[..., 2] >= 140)
    near = cv2.dilate(mask, np.ones((9, 9), np.uint8)).astype(bool)
    area = mask.astype(bool) | (near & rim)
    alpha = cv2.GaussianBlur(area.astype(np.float32), (3, 3), 0.8)[..., None]
    # the generated screen's own shading: brighter/darker spots carry over as a gain around 1
    lum = rgb.astype(np.float32) @ np.float32([0.299, 0.587, 0.114])
    ref = np.median(lum[mask.astype(bool)])
    gain = cv2.GaussianBlur(np.clip(lum / max(ref, 1), 0.6, 1.25), (0, 0), 6)[..., None]
    shown = np.clip(warped * gain, 0, 255)
    shown = cv2.GaussianBlur(shown, (0, 0), 0.5)  # the lens, not a screenshot
    bloom = cv2.GaussianBlur(shown, (0, 0), 2.5) * 0.45  # an emitting screen: its lime bleeds a little
    shown = 255 - (255 - shown) * (255 - bloom) / 255
    out = rgb.astype(np.float32) * (1 - alpha) + shown * alpha
    # the old flat lime glowed on the edges (bezel, fingers); the new picture is darker: a faint glow of its own
    glow = cv2.GaussianBlur(shown * alpha, (0, 0), 10) * 0.35
    out = 255 - (255 - out) * (255 - glow * (1 - alpha)) / 255
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


def main():
    src, face, dst = sys.argv[1:4]
    frame = Image.open(HERE / src)
    img = Image.open(HERE / "refs" / f"{face}.png")
    out = HERE / dst
    out.parent.mkdir(exist_ok=True)
    paste(frame, img).save(out)
    print(out.relative_to(HERE))


if __name__ == "__main__":
    main()
