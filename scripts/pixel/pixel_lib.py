"""Shared helpers for the pixel asset generator: palette, char grids, layered compositing with auto-outline.

A grid is a list of rows of single-char palette keys ('.' = transparent). A layer is drawn onto a canvas and,
unless told otherwise, gets a 1px dark outline on every transparent pixel 4-adjacent to one of its colours.
Layers are composited in order, so a later layer's outline cleanly separates it from what is underneath.
"""

from __future__ import annotations

import math
from typing import Callable, Iterable, Optional, Sequence

from PIL import Image


def hexc(h: str, a: int = 255) -> tuple[int, int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


# One shared palette. Lowercase = base tone, uppercase = shade (mostly), a few extra highlights.
PALETTE: dict[str, tuple[int, int, int, int]] = {
    "O": hexc("#1c1b22"),  # outline
    "x": hexc("#2a2a30"),  # near-black fill (screens, stripes)
    "g": hexc("#5f6b3a"),  # olive
    "G": hexc("#434c27"),
    "h": hexc("#7d8a4c"),  # light olive
    "k": hexc("#b39b6b"),  # khaki
    "K": hexc("#8c774f"),
    "l": hexc("#d4c49a"),  # light khaki / skin
    "r": hexc("#a4542f"),  # rust
    "q": hexc("#74381e"),
    "c": hexc("#8a8a86"),  # concrete
    "C": hexc("#5e5e5b"),
    "e": hexc("#b4b4ae"),
    "s": hexc("#6b7480"),  # steel
    "S": hexc("#4a515b"),
    "t": hexc("#9aa4b0"),
    "n": hexc("#3fae5a"),  # signal green
    "N": hexc("#2a7d40"),
    "a": hexc("#e0a030"),  # amber
    "A": hexc("#a87020"),
    "y": hexc("#f2c45a"),
    "R": hexc("#c8423a"),  # red
    "D": hexc("#8c2a25"),
    "E": hexc("#5c1a17"),  # very dark red
    "b": hexc("#4aa3d8"),  # sky
    "B": hexc("#2c6e9e"),
    "i": hexc("#8cc8ec"),  # light sky
    "j": hexc("#e07a6e"),  # light red
    "f": hexc("#7fd08f"),  # light green
    "w": hexc("#e8e8e0"),  # white
    "u": hexc("#7a5230"),  # wood
    "U": hexc("#553820"),
    "v": hexc("#9c6c40"),
    "p": hexc("#c98a86"),  # dusty pink (brain only)
    "P": hexc("#9c5f5c"),
    "m": hexc("#8a5cd6"),  # merge-queue purple
    "M": hexc("#b79cf0"),
    "Q": hexc("#5f3d9e"),
    "~": (0, 0, 0, 90),  # soft shadow, never outlined
}

NO_OUTLINE_SOURCE = {"O", "~"}

Grid = list[list[str]]


def G(text: str) -> Grid:
    """Parse a multi-line string of equal-width rows (indentation and blank lines ignored)."""
    rows = [ln.strip() for ln in text.strip("\n").splitlines() if ln.strip()]
    width = len(rows[0])
    for r in rows:
        if len(r) != width:
            raise ValueError(f"ragged grid row {r!r} (want width {width}) in\n{text}")
    return [list(r) for r in rows]


def size(g: Grid) -> tuple[int, int]:
    return (len(g[0]) if g else 0, len(g))


def blank(w: int, h: int) -> Grid:
    return [["."] * w for _ in range(h)]


def recolor(g: Grid, mapping: dict[str, str]) -> Grid:
    return [[mapping.get(ch, ch) for ch in row] for row in g]


def stamp(base: Grid, glyph: Grid, x: int, y: int) -> Grid:
    out = [row[:] for row in base]
    for r, row in enumerate(glyph):
        for c, ch in enumerate(row):
            if ch != "." and 0 <= y + r < len(out) and 0 <= x + c < len(out[0]):
                out[y + r][x + c] = ch
    return out


def flip_h(g: Grid) -> Grid:
    return [row[::-1] for row in g]


def flip_v(g: Grid) -> Grid:
    return [row[:] for row in g[::-1]]


def shape(w: int, h: int, fn: Callable[[float, float], Optional[str]]) -> Grid:
    """Rasterise fn evaluated at pixel centres."""
    return [[fn(x + 0.5, y + 0.5) or "." for x in range(w)] for y in range(h)]


def disc(d: int, ch: str, shade: Optional[str] = None, slack: float = 0.1) -> Grid:
    c = d / 2
    lim = c - slack

    def f(x: float, y: float) -> Optional[str]:
        if math.hypot(x - c, y - c) > lim:
            return None
        if shade and (x - c) + (y - c) > c * 0.75:
            return shade
        return ch

    return shape(d, d, f)


def seg_param(px: float, py: float, a: tuple[float, float], b: tuple[float, float]) -> tuple[float, float]:
    """(t along a->b, signed perpendicular distance)."""
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    ln2 = dx * dx + dy * dy
    t = ((px - ax) * dx + (py - ay) * dy) / ln2
    ln = math.sqrt(ln2)
    d = ((px - ax) * dy - (py - ay) * dx) / ln
    return t, d


def along(
    w: int,
    h: int,
    a: tuple[float, float],
    b: tuple[float, float],
    segs: Sequence[tuple[float, float, float, float, Callable[[float, float], str]]],
) -> Grid:
    """Draw a tool along the axis a->b: segs = (t0, t1, half_width_at_t0, half_width_at_t1, colour_fn(t, d))."""

    def f(x: float, y: float) -> Optional[str]:
        t, d = seg_param(x, y, a, b)
        for t0, t1, hw0, hw1, fn in segs:
            if t0 <= t <= t1:
                k = (t - t0) / (t1 - t0) if t1 > t0 else 0
                hw = hw0 + (hw1 - hw0) * k
                if abs(d) <= hw:
                    return fn(t, d)
                return None
        return None

    return shape(w, h, f)


Layer = tuple  # (grid, x, y) or (grid, x, y, outline: bool)


def compose(w: int, h: int, layers: Iterable[Layer], name: str = "?", strict: bool = True) -> list[list[Optional[str]]]:
    canvas: list[list[Optional[str]]] = [[None] * w for _ in range(h)]
    for layer in layers:
        grid, x, y = layer[0], layer[1], layer[2]
        outline = layer[3] if len(layer) > 3 else True
        gw, gh = size(grid)
        if x is None:
            x = (w - gw) // 2
        if y is None:
            y = (h - gh) // 2
        lay: list[list[Optional[str]]] = [[None] * w for _ in range(h)]
        for r, row in enumerate(grid):
            for c, ch in enumerate(row):
                if ch == ".":
                    continue
                X, Y = x + c, y + r
                if not (0 <= X < w and 0 <= Y < h):
                    if strict:
                        raise ValueError(f"{name}: pixel ({X},{Y}) falls outside the {w}x{h} canvas")
                    continue
                lay[Y][X] = ch
        if outline:
            adds = []
            for Y in range(h):
                for X in range(w):
                    ch = lay[Y][X]
                    if ch is None or ch in NO_OUTLINE_SOURCE:
                        continue
                    if strict and (X in (0, w - 1) or Y in (0, h - 1)):
                        raise ValueError(f"{name}: coloured pixel ({X},{Y}) touches the edge, no room for its outline")
                    for nx, ny in ((X + 1, Y), (X - 1, Y), (X, Y + 1), (X, Y - 1)):
                        if 0 <= nx < w and 0 <= ny < h and lay[ny][nx] is None:
                            adds.append((nx, ny))
            for nx, ny in adds:
                lay[ny][nx] = "O"
        for Y in range(h):
            for X in range(w):
                if lay[Y][X] is not None:
                    canvas[Y][X] = lay[Y][X]
    return canvas


def to_image(canvas: list[list[Optional[str]]], palette: Optional[dict] = None) -> Image.Image:
    pal = palette or PALETTE
    h = len(canvas)
    w = len(canvas[0])
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    px = img.load()
    for y in range(h):
        for x in range(w):
            ch = canvas[y][x]
            if ch is not None:
                px[x, y] = pal[ch]
    return img


def save_png(img: Image.Image, path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, format="PNG", optimize=True)
