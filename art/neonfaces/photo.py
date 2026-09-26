"""
Faces from portraits: the pixel pipeline applied to photographic portraits of people who don't exist.

A portrait (square, grayscale, head filling the frame) is mapped onto the same face units the procedural
renderer uses (x across the face, eye line at y = 0, mouth near y = 0.86), so crops, windows, blocks, edges,
grain, accessories and anomalies work exactly as before. Only the luminance source changes.

The Light trait is kept honest: side-lit portraits are lit from the left of the frame and are mirrored for
"Right"; "Top" portraits are lit from above.
"""
from __future__ import annotations

import math

import numpy as np
from PIL import Image

from .render import (
    BLOCK_GRID, CROPS, FaceParams, Window, apply_accessory, apply_anomaly, quantize,
)

SIZE = 512
MOUTH_Y = 0.86  # face units from the eye line to the mouth line


def load_portrait(path) -> np.ndarray:
    """Grayscale 0..1 at SIZE x SIZE, levels stretched between the 1st and 99th percentile."""
    im = Image.open(path).convert("L")
    side = min(im.size)
    im = im.crop(((im.width - side) // 2, (im.height - side) // 2, (im.width + side) // 2, (im.height + side) // 2))
    a = np.asarray(im.resize((SIZE, SIZE), Image.LANCZOS), dtype=np.float64) / 255.0
    lo, hi = np.percentile(a, [1, 99])
    return np.clip((a - lo) / max(hi - lo, 1e-3), 0.0, 1.0)


def _smooth(v: np.ndarray, k: int) -> np.ndarray:
    return np.convolve(v, np.ones(k) / k, mode="same")


MODELS = __import__("pathlib").Path(__file__).resolve().parents[1] / "models"
YUNET = MODELS / "face_detection_yunet_2023mar.onnx"   # opencv_zoo, sha256 8f2383e4…2552fa4
SFACE = MODELS / "face_recognition_sface_2021dec.onnx"  # opencv_zoo, sha256 0ba9fbfa…87c34e79
_cv: dict = {}


def _bgr(lum: np.ndarray) -> np.ndarray:
    g = (np.clip(lum, 0, 1) * 255).astype(np.uint8)
    return np.dstack([g, g, g])


def detect(lum: np.ndarray):
    """The most confident face found by YuNet (OpenCV): [x, y, w, h, eye, eye, nose, mouth corner, mouth corner,
    score] in pixels, or None."""
    if not YUNET.exists():
        return None
    import cv2
    h, w = lum.shape
    if "yunet" not in _cv:
        _cv["yunet"] = cv2.FaceDetectorYN.create(str(YUNET), "", (w, h), 0.7, 0.3, 5000)
    det = _cv["yunet"]
    det.setInputSize((w, h))
    _, faces = det.detect(_bgr(lum))
    if faces is None or len(faces) == 0:
        return None
    return max(faces, key=lambda f: f[-1] * f[2] * f[3])


def identity(lum: np.ndarray, face) -> np.ndarray | None:
    """SFace identity embedding (unit length) of a detected face, for the "different people" check."""
    if face is None or not SFACE.exists():
        return None
    import cv2
    if "sface" not in _cv:
        _cv["sface"] = cv2.FaceRecognizerSF.create(str(SFACE), "")
    rec = _cv["sface"]
    f = rec.feature(rec.alignCrop(_bgr(lum), face)).ravel()
    return f / (np.linalg.norm(f) + 1e-9)


def landmarks(lum: np.ndarray) -> dict:
    """Eye line, face centre and scale (the face unit in pixels) of a frontal portrait: from YuNet's five points
    when a face is found, from dark bands otherwise."""
    face = detect(lum)
    if face is not None:
        e1, e2 = face[4:6], face[6:8]
        m1, m2 = face[10:12], face[12:14]
        lx, rx = sorted([e1[0], e2[0]])
        eye_y = (e1[1] + e2[1]) / 2
        mouth_y = (m1[1] + m2[1]) / 2
        unit = float(np.mean([(mouth_y - eye_y) / MOUTH_Y, (rx - lx) / 0.80]))
        return {"eye_y": float(eye_y), "cx": float((lx + rx) / 2), "unit": unit,
                "eye_dx": float((rx - lx) / 2 / unit), "fallback": False, "detector": "yunet"}
    return _landmarks_bands(lum)


def _landmarks_bands(lum: np.ndarray) -> dict:
    """Eye line, eye centres and mouth line from dark bands (portraits are frontal and centred).
    Returns pixel coordinates and the face unit in pixels."""
    h, w = lum.shape
    # eyes: the darkest row band between 22% and 55% of the height, in two windows either side of the centre
    rows = slice(int(0.22 * h), int(0.55 * h))
    left, right = lum[:, int(0.22 * w):int(0.46 * w)], lum[:, int(0.54 * w):int(0.78 * w)]
    band = _smooth(left.mean(axis=1) + right.mean(axis=1), 9)
    eye_y = rows.start + int(np.argmin(band[rows]))
    # brows sit above the eyes and are often darker: if a second dark band lies 4-12% lower, that is the eye line
    below = slice(eye_y + int(0.04 * h), min(h, eye_y + int(0.12 * h)))
    if below.stop > below.start and band[below].min() < band[eye_y] + 0.06:
        eye_y = below.start + int(np.argmin(band[below]))
    # face extent at the cheeks (a little under the eyes): skin is lighter than the background
    cheek = _smooth(lum[min(h - 1, eye_y + int(0.06 * h)):min(h, eye_y + int(0.10 * h))].mean(axis=0), 15)
    bg = np.median(np.concatenate([cheek[: int(0.06 * w)], cheek[-int(0.06 * w):]]))
    skin = cheek > bg + 0.35 * (np.percentile(cheek, 90) - bg)
    c = w // 2
    left_edge, right_edge = c, c
    while left_edge > 0 and skin[left_edge - 1]:
        left_edge -= 1
    while right_edge < w - 1 and skin[right_edge + 1]:
        right_edge += 1
    cx = (left_edge + right_edge) / 2 if right_edge - left_edge > 0.25 * w else w / 2
    # eye centres: darkest columns of the eye strip, each side of the face centre
    strip = lum[max(0, eye_y - 6):eye_y + 7]
    cols = _smooth(strip.mean(axis=0), 11)
    a0, a1 = int(cx - 0.26 * w), int(cx - 0.06 * w)
    b0, b1 = int(cx + 0.06 * w), int(cx + 0.26 * w)
    lx = a0 + int(np.argmin(cols[a0:a1]))
    rx = b0 + int(np.argmin(cols[b0:b1]))
    # mouth: the darkest row band under the nose, 16-34% of the height below the eyes (not the chin shadow)
    mid = lum[:, int(cx - 0.10 * w):int(cx + 0.10 * w)]
    mband = _smooth(mid.mean(axis=1), 7)
    m0, m1 = eye_y + int(0.16 * h), min(h - 1, eye_y + int(0.34 * h))
    mouth_y = m0 + int(np.argmin(mband[m0:m1]))
    # three independent scales, the median wins: eye to mouth, eye to eye, cheek to cheek
    scales = [(mouth_y - eye_y) / MOUTH_Y, (rx - lx) / 0.80]
    if right_edge - left_edge > 0.25 * w:
        scales.append((right_edge - left_edge) / 2 / 0.92)
    unit = float(np.median(scales))
    # sanity: fall back to the framing the prompts ask for
    fallback = not (0.25 * h < unit < 0.55 * h) or abs(cx - w / 2) > 0.12 * w
    if fallback:
        eye_y, cx, unit = int(0.38 * h), w / 2, 0.40 * h
        lx, rx = cx - 0.16 * w, cx + 0.16 * w
    return {"eye_y": float(eye_y), "cx": float(cx), "unit": float(unit), "eye_dx": float((rx - lx) / 2 / unit),
            "fallback": fallback}


def _bilinear(lum: np.ndarray, px: np.ndarray, py: np.ndarray) -> np.ndarray:
    h, w = lum.shape
    px = np.clip(px, 0, w - 1.001)
    py = np.clip(py, 0, h - 1.001)
    x0, y0 = np.floor(px).astype(int), np.floor(py).astype(int)
    fx, fy = px - x0, py - y0
    a, b = lum[y0, x0], lum[y0, x0 + 1]
    c, d = lum[y0 + 1, x0], lum[y0 + 1, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def photo_grid(lum, lm, p: FaceParams, win: Window, grid: int, mirror: bool, oversample: int = 8) -> np.ndarray:
    """Block luminance of `win` (face units) over the portrait, with the print contrast of the traits."""
    x, y = win.sample_points(grid * oversample)
    if mirror:
        x = -x
    v = _bilinear(lum, lm["cx"] + x * lm["unit"], lm["eye_y"] + y * lm["unit"])
    shift = {"Sparse": 0.07, "Mid": -0.03, "Heavy": -0.14}[p.density]
    v = (v - 0.5) * p.contrast + 0.5 + shift
    blocks = np.clip(v, 0, 1).reshape(grid, oversample, grid, oversample).mean(axis=(1, 3))
    return blocks


def _params_from(lm, p: FaceParams, rng) -> None:
    p.eye_dx, p.eye_y, p.eye_h = lm["eye_dx"], 0.0, 0.075
    p.contrast = rng.uniform(1.15, 1.35)


def render_photo_set(lum, lm, p: FaceParams, seed: int):
    """Full face at 2G x 2G from a portrait + the Accessory of each piece (only where it shows)."""
    rng = np.random.default_rng(seed)
    _params_from(lm, p, rng)
    g = BLOCK_GRID[p.block]
    win = Window(
        cx=rng.uniform(-0.04, 0.04),
        cy=0.43 + rng.uniform(-0.04, 0.04),
        size=2.30 * rng.uniform(0.96, 1.04),
        rot=math.radians(rng.uniform(-3, 3)),
        flip=False,
    )
    mirror = p.light == "Right" or (p.light == "Top" and rng.random() < 0.5)
    idx = quantize(photo_grid(lum, lm, p, win, 2 * g, mirror), p.edge)
    before = idx.copy()
    idx = apply_accessory(idx, p, win, 2 * g, rng)
    acc = []
    for q in range(4):
        r0, c0 = (q // 2) * g, (q % 2) * g
        changed = (idx[r0:r0 + g, c0:c0 + g] != before[r0:r0 + g, c0:c0 + g]).any()
        acc.append(p.accessory if changed else "None")
    return idx, acc


def render_photo_face(lum, lm, p: FaceParams, seed: int, side: float):
    """A single close-up: the Crop window of the portrait, on one side of the face (`side` = -1 / +1)."""
    rng = np.random.default_rng(seed)
    _params_from(lm, p, rng)
    block = "Micro" if p.anomaly == "Extra-Wide Crop" else p.block
    grid = BLOCK_GRID[block]
    cx, cy, size = CROPS[p.crop]
    # every single is framed its own way: tighter or looser, off-centre, slightly turned
    size *= rng.uniform(0.78, 1.28)
    if p.anomaly == "Extra-Wide Crop":
        size *= 1.55
        cx *= 0.75
    win = Window(
        cx=side * cx + rng.uniform(-0.12, 0.12),
        cy=cy + rng.uniform(-0.10, 0.10),
        size=size,
        rot=math.radians(rng.uniform(-14, 14)),
        flip=False,
    )
    mirror = p.light == "Right" or (p.light == "Top" and rng.random() < 0.5)
    idx = quantize(photo_grid(lum, lm, p, win, grid, mirror), p.edge)
    extra_idx = None
    if p.anomaly == "Double-Eye Fragment":
        ew = Window(cx=-win.cx if abs(win.cx) > 0.2 else lm["eye_dx"], cy=0.0, size=0.55, rot=win.rot * 0.5, flip=False)
        extra_idx = quantize(photo_grid(lum, lm, p, ew, grid, mirror), p.edge)
    idx = apply_accessory(idx, p, win, grid, rng)
    idx = apply_anomaly(idx, p, grid, rng, extra_idx)
    return idx
