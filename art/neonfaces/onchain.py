"""
On-chain encoding for NEONFACES + a byte-exact Python mirror of NeonRenderer's SVG.

Record (one per art piece):
    [0]      grid size G (20 / 24 / 30 / 40)
    [1..11]  trait indices, order = ONCHAIN_TRAITS (Face = 0 "None" on single close-ups)
    [12..]   RLE pixels, row-major over G*G cells, one byte per run:
             (color << 5) | (length - 1), color 0..7, length 1..32

A set is 4 records (art ids 3335 + 4k .. + 3): the pieces of one 2G x 2G face, in the order
left eye, right eye, left mouth, right mouth (top-left, top-right, bottom-left, bottom-right).
An assembled set renders as one SVG of the 4 records side by side (render_set_svg).

Chunk (one SSTORE2 contract, up to PER_CHUNK records):
    [2 bytes big-endian offset of record i, for i < n] + records
    n = first_offset / 2

Provenance (committed on-chain before mint, verified by NeonArt.seal()):
    h_0 = 0x00..00 ; h_{k+1} = keccak256(h_k || chunk_k) ; provenance = h_last
"""
from __future__ import annotations

from Crypto.Hash import keccak

from .render import build_palette

PER_CHUNK = 32

ONCHAIN_TRAITS = ["Crop", "Density", "Neon", "Edge", "Grain", "Light", "Expression", "Accessory", "Block", "Anomaly", "Face"]
HEADER = 1 + len(ONCHAIN_TRAITS)
ART_COUNT = 5555
TRAIT_VALUES = {
    "Crop": ["Eye", "Nose", "Brow", "Cheek", "Temple", "Mouth", "Profile Edge",
             "Left Eye", "Right Eye", "Left Mouth", "Right Mouth"],
    "Density": ["Sparse", "Mid", "Heavy"],
    "Neon": ["Standard", "Deep", "Hot"],
    "Edge": ["Stair Step", "Hard Cut", "Bleed Dither"],
    "Grain": ["Clean Print", "Dusty", "Heavy Scan"],
    "Light": ["Left", "Right", "Top"],
    "Expression": ["Flat", "Squint", "Glare", "Wide", "Tense"],
    "Accessory": ["None", "Mole", "Scar", "Stud", "Tape", "Visor"],
    "Block": ["Standard", "Fine", "Coarse"],
    "Anomaly": ["None", "Dead Pixel", "Inverted Blocks", "Extra-Wide Crop", "Double-Eye Fragment"],
    "Face": ["None", "Woman", "Man"],
}
NEON_ORDER = TRAIT_VALUES["Neon"]
BG = 5  # palette index of the neon field (drawn as the background rect)


def keccak256(data: bytes) -> bytes:
    k = keccak.new(digest_bits=256)
    k.update(data)
    return k.digest()


def palettes_hex() -> dict[str, list[str]]:
    out = {}
    for n in NEON_ORDER:
        out[n] = ["#%02x%02x%02x" % tuple(int(v) for v in c) for c in build_palette(n)]
    return out


# ----------------------------------------------------------------------------
# Encoding
# ----------------------------------------------------------------------------
def encode_record(idx, traits: dict) -> bytes:
    g = idx.shape[0]
    out = bytearray([g])
    for t in ONCHAIN_TRAITS:
        out.append(TRAIT_VALUES[t].index(traits.get(t, "None")))
    flat = [int(v) for v in idx.ravel()]
    i = 0
    while i < len(flat):
        c = flat[i]
        n = 1
        while i + n < len(flat) and flat[i + n] == c and n < 32:
            n += 1
        out.append((c << 5) | (n - 1))
        i += n
    return bytes(out)


def decode_record(rec: bytes):
    g = rec[0]
    traits = {t: TRAIT_VALUES[t][rec[1 + k]] for k, t in enumerate(ONCHAIN_TRAITS)}
    runs = [(b >> 5, (b & 31) + 1) for b in rec[HEADER:]]
    return g, traits, runs


def build_chunks(records: list[bytes]) -> list[bytes]:
    chunks = []
    for s in range(0, len(records), PER_CHUNK):
        recs = records[s:s + PER_CHUNK]
        header = bytearray()
        off = 2 * len(recs)
        body = bytearray()
        for r in recs:
            header += off.to_bytes(2, "big")
            off += len(r)
            body += r
        chunk = bytes(header + body)
        assert len(chunk) <= 24_575, "chunk exceeds contract size limit"
        chunks.append(chunk)
    return chunks


def provenance(chunks: list[bytes]) -> str:
    h = bytes(32)
    for c in chunks:
        h = keccak256(h + c)
    return "0x" + h.hex()


# ----------------------------------------------------------------------------
# SVG (must match NeonRenderer.renderSVG byte for byte)
# ----------------------------------------------------------------------------
def _dec2(v: int) -> str:
    return f"{v // 100}.{v % 100:02d}"


def _rand(art_id: int, i: int) -> int:
    return int.from_bytes(keccak256(art_id.to_bytes(32, "big") + i.to_bytes(32, "big")), "big")


# Gaze: the neon blooms the longer a Face stays with its holder (Unblinking >= 30 / 90 / 365 days).
# level -> (blur radius in blocks, glow strength); a sale resets it.
GAZE = {1: ("0.6", ".35"), 2: ("0.9", ".55"), 3: ("1.2", ".8")}
GAZE_NAMES = {1: "Steady", 2: "Fixed", 3: "Piercing"}
GAZE_DAYS = (30, 90, 365)


def gaze_level(days: int) -> int:
    return sum(days >= d for d in GAZE_DAYS)


def render_svg(art_id: int, rec: bytes, gaze: int = 0) -> str:
    return _svg(art_id, [rec], 1, gaze)


def render_set_svg(set_id: int, recs: list[bytes], gaze: int = 0) -> str:
    """Assembled set (set_id 1..555): the 4 pieces side by side on a 2G grid, grain keyed by 5555 + set_id."""
    return _svg(ART_COUNT + set_id, recs, 2, gaze)


def _svg(art_id: int, recs: list[bytes], side: int, gaze: int = 0) -> str:
    g, traits, _ = decode_record(recs[0])
    pal = palettes_hex()[traits["Neon"]]
    paths = {c: [] for c in range(8)}
    for q, rec in enumerate(recs):
        ox, oy = (q % 2) * g, (q // 2) * g
        p = 0
        for c, n in decode_record(rec)[2]:
            while n > 0:
                x, y = p % g, p // g
                seg = min(n, g - x)
                if c != BG:
                    paths[c].append(f"M{ox + x} {oy + y}h{seg}v1h-{seg}z")
                p += seg
                n -= seg
    g *= side
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {g} {g}" width="1200" height="1200" shape-rendering="crispEdges">']
    if gaze:
        blur, k = GAZE[gaze]
        s.append(
            f'<defs><filter id="b"><feGaussianBlur stdDeviation="{blur}"/><feComponentTransfer>'
            f'<feFuncR type="linear" slope="{k}"/><feFuncG type="linear" slope="{k}"/><feFuncB type="linear" slope="{k}"/>'
            '</feComponentTransfer><feBlend in="SourceGraphic" mode="screen"/></filter></defs><g filter="url(#b)">'
        )
    s.append(f'<rect width="{g}" height="{g}" fill="{pal[BG]}"/>')
    for c in (0, 1, 2, 3, 4, 6, 7):
        if paths[c]:
            s.append(f'<path fill="{pal[c]}" d="{"".join(paths[c])}"/>')
    if gaze:
        s.append("</g>")

    grain = traits["Grain"]
    if grain == "Dusty":
        dark, light = [], []
        for i in range(90):
            r = _rand(art_id, i)
            x = r % (g * 100)
            y = (r >> 32) % (g * 100)
            sz = 8 + (r >> 64) % 18
            seg = f"M{_dec2(x)} {_dec2(y)}h{_dec2(sz)}v{_dec2(sz)}h-{_dec2(sz)}z"
            (dark if (r >> 96) % 10 < 7 else light).append(seg)
        s.append(f'<path fill="#000" fill-opacity=".35" d="{"".join(dark)}"/>')
        s.append(f'<path fill="#fff" fill-opacity=".22" d="{"".join(light)}"/>')
    elif grain == "Heavy Scan":
        r = _rand(art_id, 1000)
        sx = r % (g * 100 - 100)
        sw = 20 + (r >> 32) % 80
        s.append(
            '<defs><pattern id="s" width="1" height=".5" patternUnits="userSpaceOnUse">'
            '<rect width="1" height=".15" fill-opacity=".28"/></pattern>'
            '<filter id="n" x="0" y="0" width="100%" height="100%">'
            f'<feTurbulence type="fractalNoise" baseFrequency="1.7" numOctaves="2" seed="{art_id % 997}"/>'
            '<feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 .5 0"/></filter></defs>'
            f'<rect width="{g}" height="{g}" fill="url(#s)"/>'
            f'<rect width="{g}" height="{g}" filter="url(#n)" opacity=".45"/>'
            f'<rect x="{_dec2(sx)}" width="{_dec2(sw)}" height="{g}" fill="#fff" fill-opacity=".08"/>'
        )
    s.append("</svg>")
    return "".join(s)


# ----------------------------------------------------------------------------
# Raster preview (PNG) of the same data — for the site / social, not canonical
# ----------------------------------------------------------------------------
def _grid(rec: bytes):
    import numpy as np

    g, _, runs = decode_record(rec)
    flat = []
    for c, n in runs:
        flat += [c] * n
    return np.array(flat, dtype=np.uint8).reshape(g, g)


def raster_set_preview(set_id: int, recs: list[bytes], size: int = 1200):
    import numpy as np

    t = [_grid(r) for r in recs]
    return raster_preview(ART_COUNT + set_id, recs[0], size, np.block([[t[0], t[1]], [t[2], t[3]]]))


def raster_preview(art_id: int, rec: bytes, size: int = 1200, idx=None):
    import numpy as np
    from PIL import Image

    _, traits, _ = decode_record(rec)
    pal = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in palettes_hex()[traits["Neon"]]], dtype=np.float64)
    if idx is None:
        idx = _grid(rec)
    g = idx.shape[0]
    scale = size // g
    img = np.repeat(np.repeat(pal[idx], scale, 0), scale, 1)
    grain = traits["Grain"]
    if grain == "Dusty":
        for i in range(90):
            r = _rand(art_id, i)
            x = (r % (g * 100)) * scale // 100
            y = ((r >> 32) % (g * 100)) * scale // 100
            sz = max(1, (8 + (r >> 64) % 18) * scale // 100)
            if (r >> 96) % 10 < 7:
                img[y:y + sz, x:x + sz] *= 0.65
            else:
                img[y:y + sz, x:x + sz] = img[y:y + sz, x:x + sz] * 0.78 + 255 * 0.22
    elif grain == "Heavy Scan":
        half = scale // 2
        for y0 in range(0, size, half):
            img[y0:y0 + max(1, int(half * 0.3))] *= 0.72
        rng = np.random.default_rng(art_id)
        noise = rng.normal(0, 10, (size // 4, size // 4, 1))
        img += np.repeat(np.repeat(noise, 4, 0), 4, 1)
        r = _rand(art_id, 1000)
        sx = (r % (g * 100 - 100)) * scale // 100
        sw = max(1, (20 + (r >> 32) % 80) * scale // 100)
        img[:, sx:sx + sw] = img[:, sx:sx + sw] * 0.92 + 255 * 0.08
    img = np.clip(img, 0, 255).astype(np.uint8)
    return Image.fromarray(img, "RGB")
