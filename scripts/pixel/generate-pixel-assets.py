"""Generates the AgentLoop pixel asset pack (original art, no logos).

  public/pixel/icons/<name>.png   16x16 RGBA icons, one for every name in PIXEL_ICON_NAMES
                                  (parsed from src/components/pixel/PixelIcon.tsx so the list can never drift)
                                  plus scripts/pixel/extra-icon-names.json (names not yet in that file)
  public/pixel/warroom/*.png      war-room textures, props, stations and map pins

Everything is written at 1x (one image pixel per art pixel); the UI scales with image-rendering: pixelated.
Output is deterministic: art is char grids + seeded procedural textures.

Layout:
  pixel_lib.py   palette, char grids, layered compositing with auto 1px outline
  icons.py       the 16x16 icon art
  warroom.py     war-room textures, stations, props, pins

Run: python3 scripts/pixel/generate-pixel-assets.py [--contact-sheet PATH]
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from PIL import Image, ImageDraw, ImageFont  # noqa: E402

from icons import build_icons  # noqa: E402
from pixel_lib import compose, save_png, to_image  # noqa: E402
from warroom import build_warroom  # noqa: E402

ROOT = HERE.parents[1]
ICON_SOURCE = ROOT / "src" / "components" / "pixel" / "PixelIcon.tsx"
# Names drawn in addition to PIXEL_ICON_NAMES (e.g. added on another branch first); merged and deduplicated.
EXTRA_ICON_FILE = HERE / "extra-icon-names.json"
ICON_OUT = ROOT / "public" / "pixel" / "icons"
WARROOM_OUT = ROOT / "public" / "pixel" / "warroom"


def icon_names() -> list[str]:
    src = ICON_SOURCE.read_text(encoding="utf-8")
    m = re.search(r"PIXEL_ICON_NAMES\s*=\s*\[(.*?)\]\s*as\s+const", src, re.S)
    if not m:
        raise SystemExit(f"could not find PIXEL_ICON_NAMES in {ICON_SOURCE}")
    body = re.sub(r"//[^\n]*", "", m.group(1))
    names = re.findall(r"""["']([a-z0-9-]+)["']""", body)
    if len(names) != len(set(names)):
        raise SystemExit("duplicate names in PIXEL_ICON_NAMES")
    for extra in json.loads(EXTRA_ICON_FILE.read_text(encoding="utf-8")):
        if extra not in names:
            names.append(extra)
    return names


def render_icon(name: str, spec) -> Image.Image:
    layers = spec if isinstance(spec[0], tuple) else [(spec, None, None)]
    return to_image(compose(16, 16, layers, name=name))


def contact_sheet(icons: dict[str, Image.Image], warroom: dict[str, Image.Image], path: Path) -> None:
    font = ImageFont.load_default()
    bg = (46, 44, 52, 255)
    cols, cell_w, cell_h = 10, 96, 64
    rows = (len(icons) + cols - 1) // cols
    icon_h = rows * cell_h + 16
    # war-room section at 3x, packed left-to-right
    scale, pad = 3, 12
    sheet_w = cols * cell_w
    x, y, line_h, placements = pad, icon_h + pad, 0, []
    for name, img in warroom.items():
        w, h = max(img.width * scale, 84), img.height * scale + 14
        if x + w > sheet_w - pad:
            x, y, line_h = pad, y + line_h + pad, 0
        placements.append((name, img, x, y))
        x += w + pad
        line_h = max(line_h, h)
    total_h = y + line_h + pad
    sheet = Image.new("RGBA", (sheet_w, total_h), bg)
    draw = ImageDraw.Draw(sheet)
    for i, (name, img) in enumerate(icons.items()):
        cx, cy = (i % cols) * cell_w, (i // cols) * cell_h
        # light + dark backdrop halves to check legibility on both
        draw.rectangle([cx + 4, cy + 4, cx + 41, cy + 41], fill=(70, 68, 78, 255))
        draw.rectangle([cx + 44, cy + 4, cx + 81, cy + 41], fill=(210, 206, 196, 255))
        big = img.resize((32, 32), Image.NEAREST)
        sheet.alpha_composite(big, (cx + 7, cy + 7))
        sheet.alpha_composite(img, (cx + 55, cy + 15))
        draw.text((cx + 4, cy + 46), name, fill=(230, 230, 220, 255), font=font)
    for name, img, px, py in placements:
        big = img.resize((img.width * scale, img.height * scale), Image.NEAREST)
        draw.rectangle([px, py, px + big.width - 1, py + big.height - 1], fill=(92, 90, 100, 255))
        sheet.alpha_composite(big, (px, py))
        draw.text((px, py + big.height + 2), name, fill=(230, 230, 220, 255), font=font)
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--contact-sheet", type=Path, default=None)
    args = ap.parse_args()

    names = icon_names()
    art = build_icons()
    missing = [n for n in names if n not in art]
    if missing:
        raise SystemExit(f"no art for icons: {', '.join(missing)}")
    extra = sorted(set(art) - set(names))
    if extra:
        print(f"note: art defined but not in PIXEL_ICON_NAMES (skipped): {', '.join(extra)}")

    icons: dict[str, Image.Image] = {}
    errors = []
    for n in names:
        try:
            icons[n] = render_icon(n, art[n])
        except ValueError as exc:
            errors.append(str(exc))
    if errors:
        raise SystemExit("icon errors:\n  " + "\n  ".join(errors))
    for n, img in icons.items():
        save_png(img, ICON_OUT / f"{n}.png")

    warroom = build_warroom()
    for n, img in warroom.items():
        save_png(img, WARROOM_OUT / f"{n}.png")

    print(f"wrote {len(icons)} icons to {ICON_OUT.relative_to(ROOT)} and {len(warroom)} war-room files to {WARROOM_OUT.relative_to(ROOT)}")
    if args.contact_sheet:
        contact_sheet(icons, warroom, args.contact_sheet)
        print(f"contact sheet: {args.contact_sheet}")


if __name__ == "__main__":
    main()
