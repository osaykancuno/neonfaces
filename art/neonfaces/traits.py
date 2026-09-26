"""
Trait system for NEONFACES.

Rarities are *exact*: every trait value gets a fixed count (largest-remainder
rounding of its weight), then the deck is shuffled. No luck involved, the
published rarity table is what ships.

The 5555 art pieces are 3335 single close-ups plus 555 sets of 4 pieces
(one full face split into left eye / right eye / left mouth / right mouth).
Art ids: singles [0, 3335), set k = 3335 + 4k .. 3335 + 4k + 3.

Stare tiers are the backbone: the tier decides the on-chain seed basket AND
biases the art (heavier stare = darker, more neon). Tiers are fixed by art id
range (singles and sets separately), so the totals are exact: 4444 / 833 / 278.
The four pieces of a set always share its tier. NeonSeeder mirrors these ranges.
"""
from __future__ import annotations

SUPPLY = 5555

# tier id (on-chain enum value) -> (trait name, count)
TIERS = {
    1: ("Glance", 4444),       # 80%  - common seed
    2: ("Watch", 833),         # 15%  - mid seed
    3: ("Heavy Stare", 278),   # 5%   - rich seed
}
assert sum(c for _, c in TIERS.values()) == SUPPLY

SINGLES = 3335
SETS = 555
assert SINGLES + 4 * SETS == SUPPLY
# tier -> count, singles and sets (each set = 4 pieces of the same tier)
SINGLE_TIERS = {1: 2668, 2: 501, 3: 166}
SET_TIERS = {1: 444, 2: 83, 3: 28}
for _t, (_, _c) in TIERS.items():
    assert SINGLE_TIERS[_t] + 4 * SET_TIERS[_t] == _c
PIECES = ["Left Eye", "Right Eye", "Left Mouth", "Right Mouth"]
# every set is a woman or a man, half and half inside each tier
FACE = {"Woman": 50, "Man": 50}

# Global traits: value -> weight (percent-ish, normalised)
GLOBAL = {
    "Crop": {
        "Eye": 20, "Nose": 18, "Brow": 14, "Cheek": 14,
        "Temple": 12, "Mouth": 12, "Profile Edge": 10,
    },
    "Grain": {"Clean Print": 45, "Dusty": 38, "Heavy Scan": 17},
    "Edge": {"Stair Step": 50, "Hard Cut": 30, "Bleed Dither": 20},
    "Light": {"Left": 42, "Right": 42, "Top": 16},
    "Expression": {"Flat": 34, "Squint": 22, "Glare": 18, "Wide": 14, "Tense": 12},
    "Accessory": {"None": 64, "Mole": 10, "Scar": 8, "Stud": 7, "Tape": 6, "Visor": 5},
    "Block": {"Standard": 53, "Fine": 25, "Coarse": 22},
    "Anomaly": {
        "None": 90.5, "Dead Pixel": 4.0, "Inverted Blocks": 2.5,
        "Extra-Wide Crop": 2.0, "Double-Eye Fragment": 1.0,
    },
}

# Tier-biased traits: tier -> value -> weight
BY_TIER = {
    "Density": {
        1: {"Sparse": 35, "Mid": 45, "Heavy": 20},
        2: {"Sparse": 15, "Mid": 45, "Heavy": 40},
        3: {"Sparse": 0, "Mid": 30, "Heavy": 70},
    },
    "Neon": {
        1: {"Standard": 60, "Deep": 25, "Hot": 15},
        2: {"Standard": 45, "Deep": 25, "Hot": 30},
        3: {"Standard": 25, "Deep": 15, "Hot": 60},
    },
}

# Set-level traits: shared by the 4 pieces (Crop is the piece, Anomaly is always None)
SET_TRAITS = ["Grain", "Edge", "Light", "Expression", "Accessory", "Block"]

# attribute order in metadata (Face and Set only on set pieces)
TRAIT_ORDER = [
    "Stare", "Crop", "Density", "Neon", "Edge", "Grain",
    "Light", "Expression", "Accessory", "Block", "Anomaly", "Face",
]


def exact_counts(weights: dict[str, float], n: int) -> dict[str, int]:
    """Largest remainder method: counts sum exactly to n."""
    tot = sum(weights.values())
    raw = {k: v / tot * n for k, v in weights.items()}
    counts = {k: int(v) for k, v in raw.items()}
    rest = n - sum(counts.values())
    for k in sorted(raw, key=lambda k: raw[k] - counts[k], reverse=True)[:rest]:
        counts[k] += 1
    return counts


def deck(weights: dict[str, float], n: int, rng) -> list[str]:
    cards: list[str] = []
    for k, c in exact_counts(weights, n).items():
        cards += [k] * c
    rng.shuffle(cards)
    return cards
