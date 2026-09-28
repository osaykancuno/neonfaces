"""Reference images for the generator: each cast member's source portrait and their Face, plus set #337's four pieces.

    python marketing/movement/make_refs.py    # -> marketing/movement/refs/ (git-ignored: portraits stay off GitHub)

p<set>.png   the set's source portrait (art/portraits, black and white), 1024 px
f<set>.png   the set's Face (art/output/images), 1024 px, nearest neighbour so the pixels stay square
piece-337-<k>.png   the four pieces of set #337 (landing/img), 1024 px
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent / "refs"
CAST = [54, 286, 419, 51, 385, 198,
        336, 57, 5, 378, 490, 211, 182, 60, 226, 539, 257,  # the second batch (28 Sep)
        56, 130, 471, 58]  # the launch-week scenes


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for s in CAST:
        Image.open(ROOT / f"art/portraits/set-{s}.png").convert("RGB").resize((1024, 1024), Image.LANCZOS).save(OUT / f"p{s}.png")
        Image.open(ROOT / f"art/output/images/set-{s}.png").convert("RGB").resize((1024, 1024), Image.NEAREST).save(OUT / f"f{s}.png")
    for k in range(4):
        Image.open(ROOT / f"landing/img/set-337-{k}.png").convert("RGB").resize((1024, 1024), Image.NEAREST).save(OUT / f"piece-337-{k}.png")
    print(f"{len(list(OUT.glob('*.png')))} files in {OUT}")


if __name__ == "__main__":
    main()
