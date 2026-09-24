"""
Trait system for NEONFACES.

Rarities are *exact*: every trait value gets a fixed count (largest-remainder
rounding of its weight), then the deck is shuffled. No luck involved, the
published rarity table is what ships.

Stare tiers are the backbone: the tier decides the on-chain seed basket AND
biases the art (heavier stare = darker, more neon). Art pieces are grouped by
tier; the on-chain Seeder assigns every minted token a tier and an index inside
that tier, and the reveal maps (tier, index) -> art piece.
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

# Global traits: value -> weight (percent-ish, normalised)
GLOBAL = {
    "Crop": {
        "Eye": 20, "Nose": 18, "Brow": 14, "Cheek": 14,
        "Temple": 12, "Mouth": 12, "Profile-edge": 10,
    },
    "Grain": {"Clean print": 45, "Dusty": 38, "Heavy scan": 17},
    "Edge": {"Stair-step": 50, "Hard cut": 30, "Bleed dither": 20},
    "Light": {"Left": 42, "Right": 42, "Top": 16},
    "Expression": {"Flat": 34, "Squint": 22, "Glare": 18, "Wide": 14, "Tense": 12},
    "Accessory": {"None": 64, "Mole": 10, "Scar": 8, "Stud": 7, "Tape": 6, "Visor": 5},
    "Block": {"Standard": 53, "Fine": 25, "Coarse": 22},
    "Anomaly": {
        "None": 90.5, "Dead pixel": 4.0, "Inverted blocks": 2.5,
        "Extra-wide crop": 2.0, "Double-eye fragment": 1.0,
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

# attribute order in metadata
TRAIT_ORDER = [
    "Stare", "Crop", "Density", "Neon", "Edge", "Grain",
    "Light", "Expression", "Accessory", "Block", "Anomaly",
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
