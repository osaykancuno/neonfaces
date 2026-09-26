"""
NEONFACES renderer.

Pipeline for one Face:
  1. A procedural, photo-like luminance field of a full face is evaluated
     (skin, hair, brows, eyes, nose, mouth, key-light shadows, skin grain).
  2. Only a very tight window of that face is sampled (the Crop trait).
  3. The window is averaged into big blocks (the Block trait).
  4. Block luminance is quantized onto the NEON palette (the Edge trait).
  5. Accessories / anomalies are applied at block level.
  6. The grid is upscaled with hard edges and analog texture is added (Grain).

Everything is deterministic given (params, rng seed).
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from PIL import Image

OUT_SIZE = 1200

# --------------------------------------------------------------------------
# Palette
# --------------------------------------------------------------------------
NEON_FIELDS = {
    "Hot": (0xD6, 0xFF, 0x1F),
    "Standard": (0xCC, 0xFF, 0x00),
    "Deep": (0xBC, 0xEE, 0x00),
}
ICE = (0xF2, 0xFF, 0xC8)      # accessory highlight (stud / glint)
DEAD = (0xFF, 0xFF, 0xFF)     # dead-pixel anomaly
N_TONES = 6                   # 0 = black ... 5 = neon field
IDX_ICE = 6
IDX_DEAD = 7


def build_palette(neon: str) -> np.ndarray:
    """6 tones from black to the neon field. Mid tones are slightly desaturated
    towards olive/grey, like a posterized photo print."""
    n = np.array(NEON_FIELDS[neon], dtype=np.float64)
    tones = []
    for i in range(N_TONES):
        t = i / (N_TONES - 1)
        t = t ** 1.15
        c = n * t
        grey = c.mean()
        desat = 0.38 * math.sin(math.pi * t)  # only mid tones lose saturation
        c = c * (1 - desat) + grey * desat
        tones.append(c)
    tones[0] = np.array([0, 0, 0], dtype=np.float64)
    tones[-1] = n
    tones.append(np.array(ICE, dtype=np.float64))
    tones.append(np.array(DEAD, dtype=np.float64))
    return np.clip(np.round(np.array(tones)), 0, 255).astype(np.uint8)


# --------------------------------------------------------------------------
# Parameters
# --------------------------------------------------------------------------
@dataclass
class FaceParams:
    # traits
    crop: str = "Nose"
    density: str = "Mid"
    grain: str = "Clean Print"
    edge: str = "Stair Step"
    neon: str = "Standard"
    light: str = "Left"
    expression: str = "Flat"
    accessory: str = "None"
    anomaly: str = "None"
    block: str = "Standard"
    face: str = ""  # "Woman" / "Man" for set pieces; "" keeps the neutral close-up anatomy
    # continuous anatomy (sampled from the rng)
    eye_dx: float = 0.40
    eye_y: float = 0.0
    eye_w: float = 0.19
    eye_h: float = 0.075
    iris_r: float = 0.075
    gaze_x: float = 0.0
    gaze_y: float = 0.0
    brow_gap: float = 0.17
    brow_t: float = 0.05
    brow_arch: float = 0.05
    nose_len: float = 0.56
    nose_w: float = 0.12
    mouth_y: float = 0.88
    mouth_w: float = 0.29
    lip: float = 0.06
    hairline: float = -0.62
    face_w: float = 1.0
    skin: float = 0.93
    contrast: float = 1.25
    extra: dict = field(default_factory=dict)


BLOCK_GRID = {"Coarse": 20, "Standard": 24, "Fine": 30, "Micro": 40}

# crop -> (center x, center y, window size) in face units, x is mirrored per side
CROPS = {
    "Eye": (0.40, -0.02, 0.62),
    "Brow": (0.38, -0.22, 0.78),
    "Nose": (0.16, 0.26, 0.92),
    "Mouth": (0.10, 0.80, 0.86),
    "Temple": (0.72, -0.26, 0.86),
    "Cheek": (0.50, 0.30, 0.88),
    "Profile Edge": (0.92, 0.18, 1.05),
}


def sample_anatomy(p: FaceParams, rng: np.random.Generator) -> None:
    u = rng.uniform
    p.eye_dx = u(0.36, 0.44)
    p.eye_y = u(-0.03, 0.03)
    p.eye_w = u(0.16, 0.21)
    p.eye_h = u(0.060, 0.088)
    p.iris_r = u(0.066, 0.082)
    p.gaze_x = u(-0.55, 0.55)
    p.gaze_y = u(-0.2, 0.25)
    p.brow_gap = u(0.14, 0.21)
    p.brow_t = u(0.035, 0.07)
    p.brow_arch = u(0.02, 0.08)
    p.nose_len = u(0.50, 0.62)
    p.nose_w = u(0.10, 0.15)
    p.mouth_y = u(0.82, 0.94)
    p.mouth_w = u(0.25, 0.33)
    p.lip = u(0.045, 0.08)
    p.hairline = u(-0.78, -0.50)
    p.face_w = u(0.93, 1.06)
    p.skin = u(0.90, 0.97)
    p.contrast = u(1.15, 1.38)

    if p.face == "Woman":
        p.face_w *= 0.94
        p.brow_t *= 0.62
        p.brow_arch = p.brow_arch * 1.5 + 0.02
        p.brow_gap *= 1.08
        p.lip *= 1.45
        p.mouth_w *= 0.94
        p.eye_h *= 1.08
        p.nose_w *= 0.88
    elif p.face == "Man":
        p.face_w *= 1.04
        p.brow_t *= 1.35
        p.brow_arch *= 0.45
        p.brow_gap *= 0.86
        p.lip *= 0.78
        p.hairline = min(p.hairline + 0.06, -0.48)

    ex = p.expression
    if ex == "Squint":
        p.eye_h *= 0.55
        p.brow_gap *= 0.82
    elif ex == "Wide":
        p.eye_h *= 1.35
        p.brow_gap *= 1.25
        p.brow_arch *= 1.4
    elif ex == "Glare":
        p.eye_h *= 0.7
        p.brow_gap *= 0.7
        p.brow_t *= 1.25
    elif ex == "Tense":
        p.eye_h *= 0.85
        p.brow_gap *= 0.85


# --------------------------------------------------------------------------
# Field helpers
# --------------------------------------------------------------------------
def _g(x, y, cx, cy, sx, sy):
    return np.exp(-(((x - cx) / sx) ** 2 + ((y - cy) / sy) ** 2) * 0.5)


def _ss(e0, e1, v):
    t = np.clip((v - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def _value_noise(rng, shape, cells):
    """Smooth value noise sampled on `shape`, `cells` random lattice cells."""
    h, w = shape
    lat = rng.random((cells + 2, cells + 2))
    ys = np.linspace(0, cells, h)
    xs = np.linspace(0, cells, w)
    y0 = np.floor(ys).astype(int)
    x0 = np.floor(xs).astype(int)
    fy = ys - y0
    fx = xs - x0
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = lat[np.ix_(y0, x0)]
    b = lat[np.ix_(y0, x0 + 1)]
    c = lat[np.ix_(y0 + 1, x0)]
    d = lat[np.ix_(y0 + 1, x0 + 1)]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def _fbm(rng, shape, base=4, octaves=4):
    out = np.zeros(shape)
    amp, tot = 1.0, 0.0
    cells = base
    for _ in range(octaves):
        out += amp * _value_noise(rng, shape, cells)
        tot += amp
        amp *= 0.5
        cells *= 2
    return out / tot


# --------------------------------------------------------------------------
# The face
# --------------------------------------------------------------------------
def face_luminance(p: FaceParams, x: np.ndarray, y: np.ndarray, rng) -> np.ndarray:
    """Photo-like luminance (0 black .. 1 bright skin) of a face at points x,y.
    Face units: x in [-1, 1] across the face, y down, eyes near y=0."""
    lx = {"Left": -1.0, "Right": 1.0, "Top": 0.0}[p.light]
    top = 1.0 if p.light == "Top" else 0.0
    shade_sign = -lx  # side of the face that falls into shadow (+1 = right)

    L = np.full_like(x, p.skin)

    # ---- head silhouette ------------------------------------------------
    taper = 1.0 - {"Woman": 0.50, "Man": 0.30}.get(p.face, 0.42) * _ss(0.35, 1.45, y)
    hw = p.face_w * taper
    d = np.abs(x) / hw                          # 0 center .. 1 edge
    inside = ((np.abs(x) / hw) ** 2.3 + (np.abs(y - 0.05) / 1.42) ** 2.4) < 1.0

    # side falloff (form shadow)
    side = np.clip(np.sign(x) * shade_sign, 0, 1) if lx != 0 else 0.5
    L -= (0.20 + 0.55 * side) * _ss(0.42, 1.0, d)
    # terminator: a crisp shadow line on the dark side
    if lx != 0:
        L -= 0.25 * side * _ss(0.62, 0.72, d)

    # broad key-light gradient across the whole face
    if lx != 0:
        L -= 0.16 * (0.5 + 0.5 * np.tanh(2.2 * shade_sign * x))
    else:
        L -= 0.12 * _ss(-0.2, 1.2, y)

    # ---- eye sockets ----------------------------------------------------
    for e in (-1.0, 1.0):
        ex, ey = e * p.eye_dx, p.eye_y
        sh = 1.0 + 0.8 * max(0.0, e * shade_sign) + 0.6 * top
        L -= 0.30 * sh * _g(x, y, ex - e * 0.05, ey - 0.03, 0.26, 0.15)
        # inner corner / side of nose root is always deep
        L -= 0.34 * sh * _g(x, y, e * 0.17, ey + 0.02, 0.07, 0.12)
        # brow ridge catches light
        L += 0.08 * _g(x, y, ex, ey - p.brow_gap - 0.09, 0.22, 0.05)
        # lid crease
        cr_y = ey - p.eye_h - 0.055
        dxn = (x - ex) / (p.eye_w * 1.15)
        crease = np.exp(-((y - (cr_y + 0.03 * dxn ** 2)) / 0.026) ** 2) * (1 - _ss(0.6, 1.0, np.abs(dxn)))
        L -= 0.22 * crease
        # under-eye bag shadow
        L -= 0.12 * sh * _g(x, y, ex + e * 0.02, ey + p.eye_h + 0.07, 0.15, 0.03)

    # ---- nose -------------------------------------------------------------
    nl, nw = p.nose_len, p.nose_w
    ny = np.clip((y - 0.0) / nl, 0, 1)              # 0 at root .. 1 at tip
    along = _ss(-0.05, 0.1, y) * (1 - _ss(nl + 0.02, nl + 0.12, y))
    ss = shade_sign if lx != 0 else 1.0
    # bridge side shadow on the dark side (the long line from eye to nostril)
    side_x = ss * (0.06 + nw * 0.55 * ny)
    def _form(u):
        # sharp edge at the side of the nose, long falloff across the cheek
        return np.where(u < 0, np.exp(-(u / 0.025) ** 2), np.exp(-u / 0.13))
    L -= (0.50 if lx != 0 else 0.28) * along * _form(ss * (x - side_x))
    if lx == 0:
        L -= 0.28 * along * _form(-ss * (x + side_x))
    # bridge highlight
    L += 0.10 * along * np.exp(-((x + ss * 0.02) / 0.03) ** 2)
    # tip + under-tip shadow
    L += 0.06 * _g(x, y, 0, nl - 0.02, 0.07, 0.05)
    L -= 0.55 * _g(x, y, 0, nl + 0.07, 0.15 + nw * 0.4, 0.035) * (1 + 0.5 * top)
    # nostrils
    for e in (-1.0, 1.0):
        L -= 0.9 * _g(x, y, e * nw * 0.72, nl + 0.05, 0.045, 0.022)
        # alar crease (wing of the nose)
        wx, wy = e * (nw + 0.02), nl - 0.02
        r = np.hypot((x - wx) / 0.06, (y - wy) / 0.07)
        wing = np.exp(-((r - 1.0) / 0.22) ** 2) * (e * (x - wx) > -0.03)
        L -= (0.45 if e * ss > 0 else 0.25) * wing
        # nasolabial fold down to the mouth corner
        t = np.clip((y - (nl + 0.02)) / (p.mouth_y - nl), 0, 1)
        fx = e * (nw + 0.08 + 0.08 * t)
        fold = np.exp(-((x - fx) / 0.022) ** 2) * (y > nl) * (y < p.mouth_y + 0.02)
        L -= (0.35 if e * ss > 0 else 0.18) * fold * (1 - t * 0.5)

    # ---- mouth -------------------------------------------------------------
    mw, my = p.mouth_w, p.mouth_y
    mx = x / mw
    in_m = np.abs(mx) < 1.0
    droop = {"Tense": 0.035, "Glare": 0.02, "Flat": 0.0, "Squint": -0.01, "Wide": 0.0}[p.expression]
    curve = my + droop * mx ** 2 + 0.012 * np.cos(mx * math.pi * 1.5)
    lip = p.lip * (0.6 if p.expression == "Tense" else 1.0)
    upper = in_m & (y > curve - lip * np.clip(1 - mx ** 2, 0, 1) ** 0.5) & (y < curve)
    lower = in_m & (y > curve) & (y < curve + lip * 1.3 * np.clip(1 - mx ** 2, 0, 1) ** 0.5)
    L = np.where(upper, L - 0.46, L)
    L = np.where(lower, L - (0.24 if p.face == "Woman" else 0.12), L)
    if p.face == "Woman":  # lower-lip highlight
        L += 0.16 * lower * np.exp(-((y - (curve + lip * 0.75)) / (lip * 0.35)) ** 2)
    L -= 0.95 * np.exp(-((y - curve) / 0.016) ** 2) * (np.abs(mx) < 1.05)
    L -= 0.50 * _g(x, y, 0, my + lip * 1.3 + 0.05, mw * 0.6, 0.04)   # under-lip
    L -= 0.25 * _g(x, y, 0, my - lip - 0.07, 0.035, 0.05)              # philtrum
    for e in (-1.0, 1.0):
        L -= 0.35 * _g(x, y, e * mw * 1.02, curve + 0.0, 0.03, 0.03)   # corners

    # ---- cheekbone / jaw shadow on the dark side -----------------------------
    if lx != 0:
        t = ss
        L -= 0.28 * _g((x - t * 0.62) * 0.8 + (y - 0.45) * 0.6 * t, y, 0, 0.45, 0.10, 0.22)
    L -= 0.35 * _ss(1.05, 1.35, y)   # under-chin

    # ---- eyes (drawn over sockets) -------------------------------------------
    for e in (-1.0, 1.0):
        ex, ey = e * p.eye_dx, p.eye_y
        w, h = p.eye_w, p.eye_h
        dx = (x - ex) / w
        # almond: outer corner slightly raised
        tilt = 0.012 * e * (x - ex) / w
        up = ey - h * np.clip(1 - dx ** 2, 0, 1) ** 0.8 - tilt
        lo = ey + h * 0.78 * np.clip(1 - dx ** 2, 0, 1) ** 0.9 - tilt
        in_eye = (np.abs(dx) < 1) & (y > up) & (y < lo)
        L = np.where(in_eye, 0.50 - 0.12 * (1 - np.abs(dx)), L)
        ix = ex + p.gaze_x * w * 0.42
        iy = ey + p.gaze_y * h * 0.35
        ri = np.hypot(x - ix, y - iy)
        iris = in_eye & (ri < p.iris_r)
        L = np.where(iris, 0.10 + 0.08 * (ri / p.iris_r), L)
        L = np.where(in_eye & (ri < p.iris_r * 0.42), 0.0, L)
        # catch-light
        cl = in_eye & (np.hypot(x - (ix - 0.025 * (lx or -1)), y - (iy - 0.022)) < p.iris_r * 0.22)
        L = np.where(cl, 0.95, L)
        # upper lid line + lashes (thick, black)
        lid_t = 0.022 + 0.01 * (p.expression in ("Glare", "Squint")) + 0.01 * (p.face == "Woman")
        lid = (np.abs(dx) < 1.08) & (np.abs(y - up) < lid_t) & (y < up + lid_t * 0.4)
        L = np.where(lid, 0.02, L)
        # outer lash wedge
        ox = ex + e * w
        wl, wt, ws = (0.13, 0.024, 0.45) if p.face == "Woman" else (0.07, 0.018, 0.25)  # eyeliner wing
        wedge = (e * (x - ox) > -0.02) & (e * (x - ox) < wl) & (np.abs(y - (ey - 0.012 - ws * e * (x - ox))) < wt)
        L = np.where(wedge, 0.03, L)
        # lower lid line
        low = (np.abs(dx) < 0.95) & (np.abs(y - lo) < 0.008)
        L = np.where(low, L * 0.8, L)

    # ---- brows -----------------------------------------------------------------
    for e in (-1.0, 1.0):
        x_in, x_out = e * 0.14, e * (p.eye_dx + p.eye_w + 0.1)
        t = np.clip((x - x_in) / (x_out - x_in), -0.2, 1.2)
        tense = 0.05 if p.expression in ("Tense", "Glare") else 0.0
        by = p.eye_y - p.eye_h - p.brow_gap - p.brow_arch * np.sin(np.pi * np.clip(t, 0, 1)) + tense * (1 - np.clip(t, 0, 1)) ** 2
        th = p.brow_t * (1.15 - 0.6 * np.clip(t, 0, 1))
        in_range = (t > 0) & (t < 1)
        dist = np.abs(y - by) / th
        brow = np.exp(-(dist ** 4)) * in_range * _ss(0.0, 0.08, t) * (1 - _ss(0.9, 1.0, t))
        L = L * (1 - 0.95 * brow)

    # ---- hair ----------------------------------------------------------------
    hn = _fbm(rng, x.shape, base=3, octaves=3)
    hairline = p.hairline + 0.30 * x ** 2 + (hn - 0.5) * 0.22
    hair = y < hairline
    # small sideburn inside the silhouette + hair mass framing the head outside it
    sideburn = (np.abs(x) > hw * 0.95) & (y < 0.05 + (hn - 0.5) * 0.2)
    sideburn |= (~inside) & (y < 0.22 + (hn - 0.5) * 0.3) & (np.abs(x) < 1.4 * p.face_w)
    if p.face == "Woman":  # long hair falling past the jaw on both sides
        sideburn |= (~inside) & (y < 1.55 + (hn - 0.5) * 0.4) & (np.abs(x) < 1.45 * p.face_w)
        sideburn |= (np.abs(x) > hw * 0.80) & (y < 1.0 + (hn - 0.5) * 0.3) & (y > p.hairline - 0.2)
    strands = 0.04 + 0.10 * _fbm(rng, x.shape, base=12, octaves=2)
    hair_all = hair | sideburn
    if p.face == "Woman":
        # a lit fringe swept over one temple: strands run parallel to its edge, so the hair reads on any background
        u = (lx or 1.0) * x
        v = y - (p.hairline + 0.15 + 1.6 * np.clip(u - 0.05, 0, None) ** 2)
        fringe = (u > 0.05) & (v < 0)
        sheen = np.where(fringe, (0.5 + 0.5 * np.sin(v * 44 + hn * 5)) ** 2 * _ss(-0.5, -0.05, v),
                         (0.5 + 0.5 * np.sin(x * 52 + hn * 6)) ** 2 * 0.7)  # fringe follows its edge, side hair falls
        strands = np.where(fringe | sideburn, 0.06 + 0.46 * sheen, strands)
        hair_all = hair_all | fringe
    # soft hair edge
    L = np.where(hair_all, strands, L * (1 - 0.6 * np.exp(-((y - hairline) / 0.04) ** 2)))

    # ---- outside the head ----------------------------------------------------
    bg = p.extra.get("bg", 0.04)
    L = np.where(inside | hair_all, L, bg)
    # rim shadow where face meets background
    rim = np.exp(-((((np.abs(x) / hw) ** 2.3 + (np.abs(y - 0.05) / 1.42) ** 2.4) - 1.0) / 0.06) ** 2)
    L -= 0.35 * rim * (bg > 0.5)

    if p.face == "Man":  # short beard: jaw, chin and upper lip
        beard_zone = inside & (y > p.nose_len + 0.10) & ~hair_all
        beard_zone &= (np.abs(x) > p.mouth_w * 0.55) | (y > p.mouth_y + p.lip * 1.3 + 0.06) | (y < p.mouth_y - p.lip - 0.02)
        stub = _fbm(rng, x.shape, base=40, octaves=2)
        L = np.where(beard_zone, L - 0.18 - 0.26 * (stub > 0.55), L)

    # ---- skin texture + print contrast ---------------------------------------
    L += (_fbm(rng, x.shape, base=3, octaves=5) - 0.5) * 0.26
    shift = {"Sparse": 0.07, "Mid": -0.03, "Heavy": -0.14}[p.density]
    L = (L - 0.5) * p.contrast + 0.5 + shift
    return np.clip(L, 0.0, 1.0)


# --------------------------------------------------------------------------
# Window sampling and quantization
# --------------------------------------------------------------------------
@dataclass
class Window:
    cx: float
    cy: float
    size: float
    rot: float
    flip: bool

    def sample_points(self, res: int):
        t = (np.arange(res) + 0.5) / res - 0.5
        gx, gy = np.meshgrid(t * self.size, t * self.size)
        c, s = math.cos(self.rot), math.sin(self.rot)
        x = self.cx + c * gx - s * gy
        y = self.cy + s * gx + c * gy
        return x, y

    def to_grid(self, fx: float, fy: float, grid: int):
        """face coords -> (col, row) on the block grid (before flip)."""
        dx, dy = fx - self.cx, fy - self.cy
        c, s = math.cos(-self.rot), math.sin(-self.rot)
        gx = c * dx - s * dy
        gy = s * dx + c * dy
        col = (gx / self.size + 0.5) * grid
        row = (gy / self.size + 0.5) * grid
        return col, row


BAYER4 = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]) / 16.0 - 0.469


def quantize(lum: np.ndarray, edge: str) -> np.ndarray:
    """block luminance -> palette index (0..5)."""
    if edge == "Hard Cut":
        # three hard tones: black / olive / neon
        idx = np.where(lum < 0.30, 0, np.where(lum < 0.58, 2, 5))
        return idx.astype(np.uint8)
    if edge == "Bleed Dither":
        h, w = lum.shape
        bayer = np.tile(BAYER4, (h // 4 + 1, w // 4 + 1))[:h, :w]
        levels = np.array([0, 1, 3, 5])
        v = np.clip(lum * 1.05, 0, 1) * (len(levels) - 1) + bayer * 0.95
        k = np.clip(np.round(v), 0, len(levels) - 1).astype(int)
        return levels[k].astype(np.uint8)
    # Stair Step: full 6-tone ramp
    v = np.clip(lum, 0, 1) ** 1.05
    thresholds = np.array([0.20, 0.34, 0.47, 0.60, 0.72])
    return np.searchsorted(thresholds, v).astype(np.uint8)


def render_grid(p: FaceParams, win: Window, grid: int, rng, oversample: int = 8) -> np.ndarray:
    res = grid * oversample
    x, y = win.sample_points(res)
    lum = face_luminance(p, x, y, rng)
    blocks = lum.reshape(grid, oversample, grid, oversample).mean(axis=(1, 3))
    return blocks


# --------------------------------------------------------------------------
# Accessories and anomalies (block level)
# --------------------------------------------------------------------------
def _bright_cells(idx, lo=4, margin=2):
    g = idx.shape[0]
    ys, xs = np.where(idx >= lo)
    keep = (ys >= margin) & (ys < g - margin) & (xs >= margin) & (xs < g - margin)
    return list(zip(ys[keep], xs[keep]))


def apply_accessory(idx, p, win, grid, rng):
    acc = p.accessory
    if acc == "None":
        return idx
    g = grid
    cells = _bright_cells(idx)
    if not cells:
        cells = [(g // 2, g // 2)]
    r, c = cells[rng.integers(len(cells))]
    if acc == "Mole":
        idx[r, c] = 0
        if g >= 30:
            idx[r, min(c + 1, g - 1)] = 1
    elif acc == "Scar":
        n = int(rng.integers(4, 7))
        dc = 1 if rng.random() < 0.5 else -1
        for i in range(n):
            rr, cc = r + i, c + dc * i
            if 0 <= rr < g and 0 <= cc < g:
                idx[rr, cc] = 2
                if cc + dc >= 0 and cc + dc < g and idx[rr, cc + dc] >= 4:
                    idx[rr, cc + dc] = 3
    elif acc == "Stud":
        idx[r, c] = IDX_ICE
        if r + 1 < g:
            idx[r + 1, c] = 0
    elif acc == "Tape":
        w = int(rng.integers(max(4, g // 5), max(6, g // 3)))
        c0 = int(np.clip(c - w // 2, 0, g - w))
        r0 = int(np.clip(r, 0, g - 2))
        idx[r0, c0:c0 + w] = 4
        idx[r0 + 1, c0:c0 + w] = 3
        idx[r0, c0] = 3
        idx[r0 + 1, c0 + w - 1] = 2
    elif acc == "Visor":
        _, er = win.to_grid(p.eye_dx * (1 if win.cx >= 0 else -1), p.eye_y - p.eye_h * 0.4, g)
        row = int(round(er)) if 1 <= er < g - 1 else int(rng.integers(g // 5, g // 2))
        idx[row, :] = 0
        idx[row + 1 if row + 1 < g else row - 1, :] = 1
        glint = int(rng.integers(2, g - 4))
        idx[row, glint:glint + 2] = IDX_ICE
    return idx


def apply_anomaly(idx, p, grid, rng, extra_idx=None):
    a = p.anomaly
    g = grid
    if a == "Inverted Blocks":
        h = int(rng.integers(g // 4, g // 2))
        w = int(rng.integers(g // 4, g // 2))
        r0 = int(rng.integers(0, g - h))
        c0 = int(rng.integers(0, g - w))
        sub = idx[r0:r0 + h, c0:c0 + w]
        base = sub < N_TONES
        sub[base] = (N_TONES - 1) - sub[base]
    elif a == "Dead Pixel":
        cells = _bright_cells(idx, lo=0, margin=1)
        r, c = cells[rng.integers(len(cells))]
        n = int(rng.integers(3, 7))
        for _ in range(n):
            idx[r, c] = IDX_DEAD
            r = int(np.clip(r + rng.integers(-1, 2), 0, g - 1))
            c = int(np.clip(c + rng.integers(-1, 2), 0, g - 1))
    elif a == "Double-Eye Fragment" and extra_idx is not None:
        h = max(4, int(g * rng.uniform(0.28, 0.36)))
        w = max(6, int(g * rng.uniform(0.45, 0.6)))
        r0 = int(rng.integers(0, g - h))
        c0 = int(rng.integers(0, g - w))
        eg = extra_idx.shape[0]
        er0 = (eg - h) // 2
        ec0 = (eg - w) // 2
        idx[r0:r0 + h, c0:c0 + w] = extra_idx[er0:er0 + h, ec0:ec0 + w]
    return idx


# --------------------------------------------------------------------------
# Grain (output resolution)
# --------------------------------------------------------------------------
def to_image(idx, palette, grain, rng) -> Image.Image:
    g = idx.shape[0]
    rgb_small = palette[idx]
    scale = OUT_SIZE // g
    img = np.repeat(np.repeat(rgb_small, scale, axis=0), scale, axis=1).astype(np.float64)
    # pad if OUT_SIZE not divisible (never for the grids we use)
    if img.shape[0] != OUT_SIZE:
        img = np.array(Image.fromarray(img.astype(np.uint8)).resize((OUT_SIZE, OUT_SIZE), Image.NEAREST), dtype=np.float64)

    if grain == "Dusty":
        # dust specks: tiny squares one tone darker/lighter + a few hairs
        n = int(rng.integers(260, 420))
        for _ in range(n):
            s = int(rng.integers(3, 8))
            y0 = int(rng.integers(0, OUT_SIZE - s))
            x0 = int(rng.integers(0, OUT_SIZE - s))
            k = 0.72 if rng.random() < 0.7 else 1.18
            img[y0:y0 + s, x0:x0 + s] *= k
        for _ in range(int(rng.integers(2, 5))):
            y0 = int(rng.integers(0, OUT_SIZE))
            x0 = int(rng.integers(0, OUT_SIZE - 120))
            ln = int(rng.integers(40, 120))
            ys = (y0 + np.cumsum(rng.integers(-1, 2, ln))).clip(0, OUT_SIZE - 3)
            for i in range(ln):
                img[ys[i]:ys[i] + 3, x0 + i] *= 0.65
    elif grain == "Heavy Scan":
        # scanlines
        img[::6] *= 0.80
        img[1::6] *= 0.90
        # scanner streak
        x0 = int(rng.integers(0, OUT_SIZE - 40))
        img[:, x0:x0 + int(rng.integers(8, 30))] *= 1.10
        # row jitter (sensor drift) every few blocks
        for _ in range(int(rng.integers(3, 7))):
            y0 = int(rng.integers(0, OUT_SIZE - 20))
            hgt = int(rng.integers(6, 20))
            img[y0:y0 + hgt] = np.roll(img[y0:y0 + hgt], int(rng.integers(-18, 19)), axis=1)
        # coarse noise
        noise = rng.normal(0, 9, (OUT_SIZE // 4, OUT_SIZE // 4, 1))
        img += np.repeat(np.repeat(noise, 4, axis=0), 4, axis=1)

    img = np.clip(img, 0, 255).astype(np.uint8)
    im = Image.fromarray(img, "RGB")
    # palette PNG keeps files small (flat colors) without visible loss
    return im.quantize(colors=64, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)


# --------------------------------------------------------------------------
# Entry point for one Face
# --------------------------------------------------------------------------
def render_face(p: FaceParams, seed: int, with_image: bool = True) -> tuple[Image.Image | None, np.ndarray]:
    rng = np.random.default_rng(seed)
    sample_anatomy(p, rng)

    # background behind the head depends on density
    if p.density == "Heavy":
        p.extra["bg"] = 0.03
    elif p.density == "Sparse":
        p.extra["bg"] = 0.03 if rng.random() < 0.35 else 0.97
    else:
        p.extra["bg"] = 0.03 if rng.random() < 0.6 else 0.97

    block = "Micro" if p.anomaly == "Extra-Wide Crop" else p.block
    grid = BLOCK_GRID[block]
    cx, cy, size = CROPS[p.crop]
    side = -1.0 if rng.random() < 0.5 else 1.0
    size *= rng.uniform(0.9, 1.1)
    if p.anomaly == "Extra-Wide Crop":
        size *= 1.55
        cx *= 0.75
    win = Window(
        cx=side * cx + rng.uniform(-0.06, 0.06),
        cy=cy + rng.uniform(-0.06, 0.06),
        size=size,
        rot=math.radians(rng.uniform(-9, 9)),
        flip=rng.random() < 0.5,
    )

    lum = render_grid(p, win, grid, rng)
    idx = quantize(lum, p.edge)

    extra_idx = None
    if p.anomaly == "Double-Eye Fragment":
        ew = Window(cx=-win.cx if abs(win.cx) > 0.2 else p.eye_dx, cy=p.eye_y, size=0.55, rot=win.rot * 0.5, flip=False)
        extra_idx = quantize(render_grid(p, ew, grid, rng), p.edge)

    idx = apply_accessory(idx, p, win, grid, rng)
    idx = apply_anomaly(idx, p, grid, rng, extra_idx)
    if win.flip:
        idx = idx[:, ::-1].copy()

    if not with_image:
        return None, idx
    palette = build_palette(p.neon)
    return to_image(idx, palette, p.grain, rng), idx


# --------------------------------------------------------------------------
# Sets: one full face at 2G x 2G, split into 4 seamless G x G pieces
# --------------------------------------------------------------------------
PIECES = ["Left Eye", "Right Eye", "Left Mouth", "Right Mouth"]  # as seen: top-left, top-right, bottom-left, bottom-right


def render_set(p: FaceParams, seed: int) -> tuple[np.ndarray, list[str]]:
    """Full-face block grid (2G x 2G, palette indices) + the Accessory trait of each piece
    (the set's accessory only on the pieces where it actually shows)."""
    rng = np.random.default_rng(seed)
    sample_anatomy(p, rng)
    if p.density == "Heavy":
        p.extra["bg"] = 0.03
    else:
        p.extra["bg"] = 0.03 if rng.random() < (0.35 if p.density == "Sparse" else 0.6) else 0.97
    g = BLOCK_GRID[p.block]
    win = Window(
        cx=rng.uniform(-0.03, 0.03),
        cy=0.40 + rng.uniform(-0.03, 0.03),
        size=1.85 * rng.uniform(0.96, 1.04),
        rot=math.radians(rng.uniform(-4, 4)),
        flip=rng.random() < 0.5,
    )
    idx = quantize(render_grid(p, win, 2 * g, rng), p.edge)
    before = idx.copy()
    idx = apply_accessory(idx, p, win, 2 * g, rng)
    if win.flip:
        idx = idx[:, ::-1].copy()
        before = before[:, ::-1]
    acc = []
    for q in range(4):
        r0, c0 = (q // 2) * g, (q % 2) * g
        changed = (idx[r0:r0 + g, c0:c0 + g] != before[r0:r0 + g, c0:c0 + g]).any()
        acc.append(p.accessory if changed else "None")
    return idx, acc


def split_set(idx: np.ndarray) -> list[np.ndarray]:
    g = idx.shape[0] // 2
    return [idx[:g, :g].copy(), idx[:g, g:].copy(), idx[g:, :g].copy(), idx[g:, g:].copy()]
