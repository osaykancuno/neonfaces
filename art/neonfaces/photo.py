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


def landmarks(lum: np.ndarray) -> dict:
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
    strip = lum[max(0, eye_y - 6):eye_y + 7]
    cols = _smooth(strip.mean(axis=0), 11)
    lx = int(0.18 * w) + int(np.argmin(cols[int(0.18 * w):int(0.48 * w)]))
    rx = int(0.52 * w) + int(np.argmin(cols[int(0.52 * w):int(0.82 * w)]))
    cx = (lx + rx) / 2
    # mouth: the darkest row band in the middle third, 20-45% of the height below the eyes
    mid = lum[:, int(cx - 0.12 * w):int(cx + 0.12 * w)]
    mband = _smooth(mid.mean(axis=1), 7)
    m0, m1 = eye_y + int(0.20 * h), min(h - 1, eye_y + int(0.45 * h))
    mouth_y = m0 + int(np.argmin(mband[m0:m1]))
    unit = (mouth_y - eye_y) / MOUTH_Y
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
    block = "Micro" if p.anomaly == "Extra-wide crop" else p.block
    grid = BLOCK_GRID[block]
    cx, cy, size = CROPS[p.crop]
    size *= rng.uniform(0.9, 1.1)
    if p.anomaly == "Extra-wide crop":
        size *= 1.55
        cx *= 0.75
    win = Window(
        cx=side * cx + rng.uniform(-0.05, 0.05),
        cy=cy + rng.uniform(-0.05, 0.05),
        size=size,
        rot=math.radians(rng.uniform(-9, 9)),
        flip=False,
    )
    mirror = p.light == "Right" or (p.light == "Top" and rng.random() < 0.5)
    idx = quantize(photo_grid(lum, lm, p, win, grid, mirror), p.edge)
    extra_idx = None
    if p.anomaly == "Double-eye fragment":
        ew = Window(cx=-win.cx if abs(win.cx) > 0.2 else lm["eye_dx"], cy=0.0, size=0.55, rot=win.rot * 0.5, flip=False)
        extra_idx = quantize(photo_grid(lum, lm, p, ew, grid, mirror), p.edge)
    idx = apply_accessory(idx, p, win, grid, rng)
    idx = apply_anomaly(idx, p, grid, rng, extra_idx)
    return idx
