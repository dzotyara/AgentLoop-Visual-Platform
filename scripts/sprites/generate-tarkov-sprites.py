"""Generates the Tarkov-pack operator sprites (public/sprites/101..109-*.png).

Original pixel art in the chibi format of the stock sprites: a 13x22 grid, 39px per cell, dark outline,
frames D-1..3 (walking towards the viewer) plus L-1 / R-1. Run: python3 scripts/sprites/generate-tarkov-sprites.py
"""

from pathlib import Path

from PIL import Image

CELL = 39
OUT = Path(__file__).resolve().parents[2] / "public" / "sprites"

OUTLINE = (28, 27, 34, 255)
SKIN = (232, 180, 138, 255)
EYE = (34, 32, 40, 255)

BODY = [
    "..OOVVVVVOO..",
    ".OAVVPVPVVAO.",
    "OAAVVPVPVVAAO",
    "OAAVVVVVVVAAO",
    "OSAVBBBBBVASO",
    ".OOLLLOLLLOO.",
    "..OLLLOLLLO..",
    "..OLLLOLLLO..",
    "..OKKKOKKKO..",
    "..OKKKOKKKO..",
    "..OOOO.OOOO..",
]


def hexc(h: str) -> tuple[int, int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


OPERATORS = {
    # Argus — recon / marksman (reviews PRs): boonie hat, shemagh, ranger-green rig
    101: {
        "head": [
            "..OOOOOOOOO..",
            ".OHHHHHHHHHO.",
            ".OHHhHHHhHHO.",
            "OOHHHHHhHHHOO",
            "OHHHHHHHHHHHO",
            ".OSSSSSSSSSO.",
            ".OSSSSSSSSSO.",
            ".OSGgSSSGgSO.",
            ".OSSSSSSSSSO.",
            ".OMMMMMMMMMO.",
            "..OMmMMMmMO..",
        ],
        "overrides": {},
        "colors": {
            "H": "#5f6b3a", "h": "#434c27", "M": "#b9a27a", "m": "#9a8460", "g": "#7fa6c4",
            "V": "#4c5a3a", "P": "#66744a", "A": "#6d7550", "B": "#3a3426", "L": "#59613e", "K": "#3b2f25",
        },
    },
    # Patch — engineer (applies review fixes): coyote helmet, active headset, multicam, wrench
    102: {
        "head": [
            "...OOOOOOO...",
            "..OHHHHHHHO..",
            ".OHHHHHHHHHO.",
            ".OHHHhhhHHHO.",
            ".OHHHHHHHHHO.",
            "OEEHHHHHHHEEO",
            "OEESSSSSSSEEO",
            "OEESGSSSGSEEO",
            ".OSSSSSSSSSO.",
            ".OSSSmmmSSSO.",
            "..OSSSSSSSO..",
        ],
        "overrides": {(4, 11): "Y", (3, 12): "Y"},
        "colors": {
            "H": "#b39b6b", "h": "#8c774f", "E": "#26262b", "m": "#b9825f", "Y": "#e0b030",
            "V": "#a38b5f", "P": "#8f7a52", "A": "#8d8a5e", "B": "#3b3326", "L": "#7b7a54", "K": "#2f2a24",
        },
    },
    # Medic — field medic (fixes CI): olive helmet with goggles, green cross patch
    103: {
        "head": [
            "...OOOOOOO...",
            "..OHHHHHHHO..",
            ".OHHHHHHHHHO.",
            ".OHggggggHHO.",
            ".OHHHHHHHHHO.",
            "OHHSSSSSSSHHO",
            ".OSSSSSSSSSO.",
            ".OSSGSSSGSSO.",
            ".OSSSSSSSSSO.",
            ".OSSSmmmSSSO.",
            "..OSSSSSSSO..",
        ],
        "overrides": {(1, 5): "W", (1, 6): "C", (1, 7): "W", (2, 5): "C", (2, 6): "C", (2, 7): "C", (3, 5): "W", (3, 6): "C", (3, 7): "W"},
        "colors": {
            "H": "#4f5a39", "g": "#9cc3d6", "m": "#b9825f", "W": "#e8e8e0", "C": "#2e9b55",
            "V": "#56603f", "P": "#6a7450", "A": "#5e6846", "B": "#2f2b22", "L": "#4e5638", "K": "#2a261f",
        },
    },
    # Weaver seat (Veronica) — sapper (resolves merge conflicts): helmet with NVG mount, auburn hair with a braid
    # over the shoulder, dark kit, hazard-striped pouch
    104: {
        "head": [
            "...OOOOOOO...",
            "..OHHHNNHHO..",
            ".OHHHNNNHHHO.",
            ".OHHHHHHHHHO.",
            "OrHHHHHHHHHrO",
            "OrrSSSSSSSrrO",
            "OrrSSSSSSSrrO",
            "OrSlGSSSlGSrO",
            "OrSSSSSSSSSrO",
            "OrrSbSmmSbrrO",
            ".OrrSSSSSrrO.",
        ],
        "overrides": {
            (0, 10): "r", (1, 10): "r", (2, 10): "R", (3, 10): "r", (4, 10): "q",
            (3, 4): "Y", (3, 5): "N", (3, 6): "Y", (3, 7): "N", (3, 8): "Y",
        },
        "colors": {
            "H": "#3c4045", "N": "#15151a", "r": "#8a3a22", "R": "#6a2816", "q": "#26262b", "l": "#1c1b22",
            "m": "#b8505a", "b": "#e59a8a", "Y": "#d9b200",
            "V": "#2f3136", "P": "#44474d", "A": "#3a3d42", "B": "#1f2024", "L": "#2c2e33", "K": "#18181b",
        },
        # a baby dragon perched on her left shoulder, facing out so her face stays clear
        "pet": {
            "grid": [
                ".......W.",
                "..h.h..WW",
                ".xxxxx.WW",
                "xDkDDDxWW",
                "xDDDDDxWW",
                ".xxDDDxW.",
                "...xDDxW.",
                "..xDBDDx.",
                "..xDBBDx.",
                "..xDBBDx.",
                "...xDDDxx",
                "...xx.xDx",
                "........x",
            ],
            "colors": {"x": "#163d22", "D": "#3fae55", "B": "#d9e86a", "W": "#8fdc6a", "k": "#111111", "h": "#efe2b8"},
            # left edge of the sprite, feet one sub-pixel onto the shoulder (first body row)
            "x": 0,
            "feet_row": 11,
        },
    },
    # Gate — checkpoint sentry (declares PRs ready): ushanka, track suit with stripes
    105: {
        "head": [
            "...OOOOOOO...",
            "..OHHHHHHHO..",
            ".OHHHHHHHHHO.",
            "OFFFFfFFfFFFO",
            "OFFFFFFFFFFFO",
            "OFFSSSSSSSFFO",
            "OFFSSSSSSSFFO",
            "OFFSGSSSGSFFO",
            ".OFSSSSSSSFO.",
            ".OOSSmmmSSOO.",
            "..OSSSSSSSO..",
        ],
        "overrides": {(1, 6): "W", (2, 6): "W", (3, 6): "W", (2, 1): "W", (3, 1): "W", (2, 11): "W", (3, 11): "W"},
        "colors": {
            "H": "#4a4a50", "F": "#8a8a86", "f": "#6e6e6a", "m": "#a8775a", "W": "#e6e6e6",
            "V": "#2d4f9a", "P": "#2d4f9a", "A": "#2a4890", "B": "#24407e", "L": "#2d4f9a", "K": "#3a3a40",
        },
    },
    # Rivet — second fixer: grey cap with welding goggles, urban grey kit, hammer
    106: {
        "head": [
            "...OOOOOOO...",
            "..OHHHHHHHO..",
            ".OHggHHHggHO.",
            ".OHggHHHggHO.",
            "OHHHHHHHHHHHO",
            ".OSSSSSSSSSO.",
            ".OSSSSSSSSSO.",
            ".OSSGSSSGSSO.",
            ".OSSSSSSSSSO.",
            ".OSSbbbbbSSO.",
            "..ObbbbbbbO..",
        ],
        "overrides": {(4, 11): "T", (3, 12): "T"},
        "colors": {
            "H": "#3f4448", "g": "#c27a2c", "b": "#5a3e2b", "T": "#9aa0a6",
            "V": "#50565c", "P": "#3d4247", "A": "#5d646b", "B": "#2a2a2e", "L": "#474d53", "K": "#1f1f22",
        },
    },
    # Splice — third fixer: beanie with headlamp, neck gaiter, tan kit, copper wire spool
    107: {
        "head": [
            "...OOOOOOO...",
            "..OHHHHHHHO..",
            ".OHHHHHHHHHO.",
            ".OwwwWWWwwwO.",
            ".OHHHHHHHHHO.",
            ".OSSSSSSSSSO.",
            ".OSSSSSSSSSO.",
            ".OSSGSSSGSSO.",
            ".OSSSSSSSSSO.",
            ".OMMMMMMMMMO.",
            "..OMMMMMMMO..",
        ],
        "overrides": {(4, 11): "C", (3, 12): "C"},
        "colors": {
            "H": "#2f3a2a", "w": "#26262b", "W": "#f4f0c8", "M": "#6b6f4a", "C": "#c8642a",
            "V": "#9c8a62", "P": "#7f6f4c", "A": "#8a7d58", "B": "#3a3326", "L": "#6c6448", "K": "#2c2722",
        },
    },
    # Hawk seat (Timur) — second reviewer, marksman: black cap, headset, amber shooting glasses, stubble, grey-blue kit
    108: {
        "head": [
            "...OOOOOOO...",
            "..OCCCCCCCO..",
            ".OCCCCcCCCCO.",
            "OCCCCCCCCCCCO",
            ".OEECCCCCEEO.",
            "OEESSSSSSSEEO",
            "OEEGGGSGGGEEO",
            ".OSGgGSGgGSO.",
            ".OSSSSSSSSSO.",
            ".OSsSmmmSsSO.",
            "..OsssssssO..",
        ],
        "overrides": {(1, 5): "T", (1, 6): "T", (1, 7): "T"},
        "colors": {
            "C": "#1f2226", "c": "#3a3f45", "E": "#2a2c30", "G": "#1a1a1e", "g": "#d79a2b", "s": "#9a7a5e",
            "m": "#a8775a", "T": "#59606a",
            "V": "#4a5866", "P": "#3b4754", "A": "#556371", "B": "#262a30", "L": "#3f4a55", "K": "#1c1f24",
        },
    },
    # Owl seat (Dmitrly) — third reviewer, spotter: multicam boonie, binoculars on the chest, beard, tan kit
    109: {
        "head": [
            "...OOOOOOO...",
            "..OHhHHhHHO..",
            ".OHHHhHHhHHO.",
            "OHHhHHHHHhHHO",
            "OOOOOOOOOOOOO",
            ".OSSSSSSSSSO.",
            ".OSSSSSSSSSO.",
            ".OSSGSSSGSSO.",
            ".OSSSSSSSSSO.",
            ".ObbbmmmbbbO.",
            "..ObbbbbbbO..",
        ],
        "overrides": {(1, 4): "N", (1, 5): "N", (1, 7): "N", (1, 8): "N", (2, 4): "n", (2, 5): "N", (2, 7): "N", (2, 8): "n"},
        "colors": {
            "H": "#8f8458", "h": "#5d6a3e", "b": "#5a3e2b", "m": "#a8775a", "N": "#202024", "n": "#6fa3c0",
            "V": "#a3906a", "P": "#8a7a58", "A": "#9b8b63", "B": "#4a3d2b", "L": "#7d6f4f", "K": "#3a3126",
        },
    },
}


def frame_grid(op: dict, frame: str) -> list[list[str]]:
    body = [list(r) for r in BODY]
    for (r, c), ch in op["overrides"].items():
        body[r][c] = ch
    grid = [list(r) for r in op["head"]] + body
    legs_top = len(op["head"]) + 5  # first pants row
    if frame in ("D-2", "D-3"):
        cols = range(2, 6) if frame == "D-2" else range(7, 11)
        # lift one leg: drop a pants row and pull the rest of that leg up, leaving the floor row empty
        for r in range(legs_top + 1, len(grid) - 1):
            for c in cols:
                grid[r][c] = grid[r + 1][c]
        for c in cols:
            grid[-1][c] = "."
    if frame == "L-1":
        # profile hint: eyes slide one cell towards the walking direction
        for row in grid[: len(op["head"])]:
            for c in range(1, len(row)):
                if row[c] in ("G", "g") and row[c - 1] == "S":
                    row[c - 1], row[c] = row[c], "S"
    return grid


def render(op: dict, grid: list[list[str]]) -> Image.Image:
    palette = {"O": OUTLINE, "S": SKIN, "G": EYE, **{k: hexc(v) for k, v in op["colors"].items()}}
    img = Image.new("RGBA", (13 * CELL, len(grid) * CELL), (0, 0, 0, 0))
    px = img.load()
    for r, row in enumerate(grid):
        for c, ch in enumerate(row):
            if ch == ".":
                continue
            color = palette[ch]
            for y in range(r * CELL, (r + 1) * CELL):
                for x in range(c * CELL, (c + 1) * CELL):
                    px[x, y] = color
    return img


PET_SUB = CELL // 3  # pets are drawn at three times the sprite's resolution


def render_pet(pet: dict) -> tuple[Image.Image, tuple[int, int]]:
    """A pet overlay (finer grid than the operator) and where it goes: feet resting on `feet_row`."""
    grid = pet["grid"]
    img = Image.new("RGBA", (len(grid[0]) * PET_SUB, len(grid) * PET_SUB), (0, 0, 0, 0))
    px = img.load()
    for r, row in enumerate(grid):
        for c, ch in enumerate(row):
            if ch == ".":
                continue
            color = hexc(pet["colors"][ch])
            for y in range(r * PET_SUB, (r + 1) * PET_SUB):
                for x in range(c * PET_SUB, (c + 1) * PET_SUB):
                    px[x, y] = color
    top = pet["feet_row"] * CELL + PET_SUB - len(grid) * PET_SUB
    return img, (pet["x"], top)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for num, op in OPERATORS.items():
        pet = render_pet(op["pet"]) if "pet" in op else None
        for frame in ("D-1", "D-2", "D-3", "L-1"):
            img = render(op, frame_grid(op, frame))
            if pet:
                img.alpha_composite(*pet)
            img.save(OUT / f"{num}-{frame}.png")
        left = Image.open(OUT / f"{num}-L-1.png")
        left.transpose(Image.FLIP_LEFT_RIGHT).save(OUT / f"{num}-R-1.png")
    print(f"wrote {len(OPERATORS) * 5} sprites to {OUT}")


if __name__ == "__main__":
    main()
