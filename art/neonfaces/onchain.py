"""
On-chain encoding for NEONFACES + a byte-exact Python mirror of NeonRenderer's SVG.

Record (one per art piece):
    [0]      grid size G (20 / 24 / 30 / 40)
    [1..10]  trait indices, order = ONCHAIN_TRAITS
    [11..]   RLE pixels, row-major over G*G cells, one byte per run:
             (color << 5) | (length - 1), color 0..7, length 1..32

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

ONCHAIN_TRAITS = ["Crop", "Density", "Neon", "Edge", "Grain", "Light", "Expression", "Accessory", "Block", "Anomaly"]
TRAIT_VALUES = {
    "Crop": ["Eye", "Nose", "Brow", "Cheek", "Temple", "Mouth", "Profile-edge"],
    "Density": ["Sparse", "Mid", "Heavy"],
    "Neon": ["Standard", "Deep", "Hot"],
    "Edge": ["Stair-step", "Hard cut", "Bleed dither"],
    "Grain": ["Clean print", "Dusty", "Heavy scan"],
    "Light": ["Left", "Right", "Top"],
    "Expression": ["Flat", "Squint", "Glare", "Wide", "Tense"],
    "Accessory": ["None", "Mole", "Scar", "Stud", "Tape", "Visor"],
    "Block": ["Standard", "Fine", "Coarse"],
    "Anomaly": ["None", "Dead pixel", "Inverted blocks", "Extra-wide crop", "Double-eye fragment"],
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
        out.append(TRAIT_VALUES[t].index(traits[t]))
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
    runs = [(b >> 5, (b & 31) + 1) for b in rec[11:]]
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


def render_svg(art_id: int, rec: bytes) -> str:
    g, traits, runs = decode_record(rec)
    pal = palettes_hex()[traits["Neon"]]
    paths = {c: [] for c in range(8)}
    p = 0
    for c, n in runs:
        while n > 0:
            x, y = p % g, p // g
            seg = min(n, g - x)
            if c != BG:
                paths[c].append(f"M{x} {y}h{seg}v1h-{seg}z")
            p += seg
            n -= seg
    s = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {g} {g}" width="1200" height="1200" shape-rendering="crispEdges">',
        f'<rect width="{g}" height="{g}" fill="{pal[BG]}"/>',
    ]
    for c in (0, 1, 2, 3, 4, 6, 7):
        if paths[c]:
            s.append(f'<path fill="{pal[c]}" d="{"".join(paths[c])}"/>')

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
    elif grain == "Heavy scan":
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
def raster_preview(art_id: int, rec: bytes, size: int = 1200):
    import numpy as np
    from PIL import Image

    g, traits, runs = decode_record(rec)
    pal = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in palettes_hex()[traits["Neon"]]], dtype=np.float64)
    flat = []
    for c, n in runs:
        flat += [c] * n
    idx = np.array(flat, dtype=np.uint8).reshape(g, g)
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
    elif grain == "Heavy scan":
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
