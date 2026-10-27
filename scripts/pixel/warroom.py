"""War-room art: tileable textures, the map table, map pins, role stations and props. All 1x, same palette.

Objects (stations, props, pins) are built from primitives on char grids, one layer per part, and composited with
the per-layer auto-outline from pixel_lib. Textures are per-pixel RGB with seeded, wrap-around noise.
"""

from __future__ import annotations

import math
import random

from PIL import Image

from pixel_lib import PALETTE, blank, compose, hexc, to_image

# extra tones used only here (screen glass)
EXTRA = {
    "z": hexc("#16201b"),  # screen glass
    "Z": hexc("#1c2a23"),  # screen scanline
}
PAL = {**PALETTE, **EXTRA}


def rgb(ch: str) -> tuple[int, int, int, int]:
    return PAL[ch]


def shade(c, k: float):
    return (max(0, min(255, int(c[0] * k))), max(0, min(255, int(c[1] * k))), max(0, min(255, int(c[2] * k))), c[3] if len(c) > 3 else 255)


def mix(a, b, t: float):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)


# ------------------------------------------------------------------------------------------------- drawing helper

class Draw:
    def __init__(self, w: int, h: int):
        self.w, self.h = w, h
        self.g = blank(w, h)

    def px(self, x: int, y: int, ch: str) -> None:
        if 0 <= x < self.w and 0 <= y < self.h:
            self.g[y][x] = ch

    def rect(self, x0: int, y0: int, x1: int, y1: int, ch: str) -> None:
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                self.px(x, y, ch)

    def hline(self, x0: int, x1: int, y: int, ch: str) -> None:
        self.rect(x0, y, x1, y, ch)

    def vline(self, x: int, y0: int, y1: int, ch: str) -> None:
        self.rect(x, y0, x, y1, ch)

    def line(self, x0: int, y0: int, x1: int, y1: int, ch: str) -> None:
        dx, dy = abs(x1 - x0), -abs(y1 - y0)
        sx, sy = (1 if x0 < x1 else -1), (1 if y0 < y1 else -1)
        err = dx + dy
        while True:
            self.px(x0, y0, ch)
            if x0 == x1 and y0 == y1:
                return
            e2 = 2 * err
            if e2 >= dy:
                err += dy
                x0 += sx
            if e2 <= dx:
                err += dx
                y0 += sy

    def ellipse(self, x0: int, y0: int, x1: int, y1: int, ch: str) -> None:
        cx, cy = (x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2
        rx, ry = (x1 - x0 + 1) / 2, (y1 - y0 + 1) / 2
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1.0:
                    self.px(x, y, ch)


def render(w: int, h: int, layers, name: str) -> Image.Image:
    return to_image(compose(w, h, layers, name=name), PAL)


def desk(d: Draw, x0: int, x1: int, ytop: int, top_h: int = 6, front_h: int = 4, leg_h: int = 10,
         top: str = "v", grain: str = "u", front: str = "u", dark: str = "U", legs: str = "U") -> None:
    d.rect(x0, ytop, x1, ytop + top_h - 1, top)
    for y in range(ytop + 1, ytop + top_h - 1, 2):
        for x in range(x0 + 1, x1):
            if (x * 7 + y * 13) % 17 < 4:
                d.px(x, y, grain)
    fy = ytop + top_h
    d.rect(x0, fy, x1, fy + front_h - 1, front)
    d.hline(x0, x1, fy + front_h - 1, dark)
    ly = fy + front_h
    d.rect(x0 + 2, ly, x0 + 4, ly + leg_h - 1, legs)
    d.rect(x1 - 4, ly, x1 - 2, ly + leg_h - 1, legs)


# ------------------------------------------------------------------------------------------------------ textures

def tile_noise(w: int, h: int, cell: int, rng: random.Random):
    """Smooth value noise that wraps around (w and h must be multiples of cell)."""
    gw, gh = w // cell, h // cell
    lat = [[rng.random() for _ in range(gw)] for _ in range(gh)]

    def sm(t):
        return t * t * (3 - 2 * t)

    out = [[0.0] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            fx, fy = x / cell, y / cell
            ix, iy = int(fx), int(fy)
            tx, ty = sm(fx - ix), sm(fy - iy)
            a = lat[iy % gh][ix % gw]
            b = lat[iy % gh][(ix + 1) % gw]
            c = lat[(iy + 1) % gh][ix % gw]
            e = lat[(iy + 1) % gh][(ix + 1) % gw]
            out[y][x] = (a + (b - a) * tx) * (1 - ty) + (c + (e - c) * tx) * ty
    return out


def fbm(w, h, cells, rng):
    layers = [tile_noise(w, h, c, rng) for c in cells]
    weights = [1 / (i + 1) for i in range(len(cells))]
    tot = sum(weights)
    return [[sum(l[y][x] * wt for l, wt in zip(layers, weights)) / tot for x in range(w)] for y in range(h)]


def quant(v: float, tones: list, lo: float = 0.3, hi: float = 0.7):
    t = (v - lo) / (hi - lo)
    i = int(max(0, min(len(tones) - 1, t * len(tones))))
    return tones[i]


def floor_tile() -> Image.Image:
    rng = random.Random(1101)
    W = H = 32
    tones = [hexc("#6a6a66"), hexc("#73736f"), hexc("#7c7c77"), hexc("#85857f")]
    n = fbm(W, H, [16, 8, 4], rng)
    img = Image.new("RGBA", (W, H))
    px = img.load()
    for y in range(H):
        for x in range(W):
            c = quant(n[y][x], tones, 0.32, 0.68)
            r = rng.random()
            if r < 0.05:
                c = shade(c, 0.86)
            elif r < 0.08:
                c = shade(c, 1.1)
            px[x, y] = c
    # oil stain with a dithered rim
    sx, sy = 21, 20
    for y in range(-6, 7):
        for x in range(-7, 8):
            d = (x / 7) ** 2 + (y / 5.5) ** 2
            X, Y = (sx + x) % W, (sy + y) % H
            if d < 0.55 or (d < 1.0 and (X + Y) % 2 == 0):
                px[X, Y] = mix(px[X, Y], hexc("#4f5244"), 0.45)
    # hairline crack (random walk, wraps)
    crack = hexc("#525256")
    x, y = 3, 6
    for _ in range(26):
        px[x % W, y % H] = crack
        if rng.random() < 0.3:
            px[(x + 1) % W, y % H] = shade(crack, 1.25)
        x += rng.choice([1, 1, 0])
        y += rng.choice([1, 0, 1, 0, -1])
    # slab seam on the tile border = a slab grid when tiled
    seam, lip = hexc("#56565a"), hexc("#94948e")
    for i in range(W):
        px[i, 0] = seam
        px[0, i] = seam
        if px[i, 1] != crack:
            px[i, 1] = mix(px[i, 1], lip, 0.5)
        if px[1, i] != crack:
            px[1, i] = mix(px[1, i], lip, 0.5)
    return img


def wall_tile() -> Image.Image:
    rng = random.Random(2202)
    W, H = 32, 48
    tones = [hexc("#7a7a75"), hexc("#83837e"), hexc("#8c8c87"), hexc("#959590")]
    n = fbm(W, 32, [16, 8, 4], rng)
    img = Image.new("RGBA", (W, H))
    px = img.load()
    for y in range(H):
        for x in range(W):
            px[x, y] = hexc("#5e5e5b")
    # concrete panel 0..29
    for y in range(30):
        for x in range(W):
            c = quant(n[y][x], tones, 0.32, 0.68)
            if rng.random() < 0.05:
                c = shade(c, 0.88)
            if y % 10 == 9:  # formwork board lines
                c = shade(c, 0.9)
            px[x, y] = c
    for y in range(3):  # ceiling shadow
        for x in range(W):
            px[x, y] = shade(px[x, y], 0.62 + y * 0.1)
    for y in range(30):  # vertical panel joint on the tile border
        px[0, y] = hexc("#5a5a57")
        px[1, y] = shade(px[1, y], 1.08)
    # form-tie holes with rust streaks
    rust = [hexc("#a4542f"), hexc("#8a4a2c"), hexc("#7a5a44")]
    for hx, hy in ((8, 7), (24, 7), (8, 19), (24, 19)):
        px[hx, hy] = hexc("#3a3a3c")
        px[hx + 1, hy] = hexc("#3a3a3c")
        length = 3 + (hx * 3 + hy * 5) % 8
        for k in range(1, length):
            if hy + k >= 30:
                break
            t = k / length
            c = rust[min(2, int(t * 3))]
            if k < length - 1 or (hx + k) % 2 == 0:
                px[hx, hy + k] = mix(px[hx, hy + k], c, 0.75 - 0.5 * t)
            if k < length // 2:
                px[hx + 1, hy + k] = mix(px[hx + 1, hy + k], c, 0.4)
    # shadow line + pipe 31..38
    for x in range(W):
        px[x, 30] = hexc("#4f4f4d")
    pipe = [hexc("#1c1b22"), hexc("#b7c0ca"), hexc("#9aa4b0"), hexc("#7d8794"), hexc("#6b7480"), hexc("#4a515b"), hexc("#1c1b22")]
    for i, c in enumerate(pipe):
        for x in range(W):
            px[x, 31 + i] = c
    for x in range(W):  # rust freckles on the pipe
        if (x * 5) % 11 == 3:
            px[x, 34] = mix(px[x, 34], hexc("#a4542f"), 0.6)
    # clamp
    for y in range(30, 40):
        for x in range(19, 23):
            px[x, y] = hexc("#4a515b") if x in (19, 22) or y in (30, 39) else hexc("#6b7480")
    px[20, 35] = px[21, 35] = hexc("#1c1b22")
    for x in range(W):
        px[x, 38] = hexc("#3a3a3c")
        px[x, 39] = shade(hexc("#5e5e5b"), 0.8)
    # skirting 40..47: darker concrete, top lip, grime
    for y in range(40, H):
        for x in range(W):
            c = hexc("#5e5e5b") if (x * 3 + y * 7) % 13 else hexc("#55554f")
            if y == 40:
                c = hexc("#6e6e6a")
            if y >= 45:
                c = shade(c, 0.85)
            px[x, y] = c
    return img


def stripe_tile() -> Image.Image:
    W, H = 32, 8
    img = Image.new("RGBA", (W, H))
    px = img.load()
    for y in range(H):
        for x in range(W):
            if y in (0, H - 1):
                c = rgb("O")
            else:
                c = rgb("a") if (x + y) % 8 < 4 else rgb("x")
                if (x * 7 + y * 3) % 23 == 0:  # paint wear
                    c = rgb("A") if c == rgb("a") else rgb("C")
            px[x, y] = c
    return img


def map_table() -> Image.Image:
    rng = random.Random(3303)
    W, H = 256, 128
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    px = img.load()
    O = rgb("O")
    # wood frame (top-down) 0..121, front face 122..127
    wood = [hexc("#5c3c22"), hexc("#664429"), hexc("#704b2d"), hexc("#553820")]
    for y in range(H):
        for x in range(W):
            if y >= 121:
                c = hexc("#3f2a17") if y < 126 else hexc("#2e1f12")
                if (x * 13) % 31 == 0 and y < 126:
                    c = hexc("#4a3220")
            else:
                band = (y // 3 if (x < 10 or x > 245) is False else x // 3)
                c = wood[(band + (x // 37 if y < 10 or y > 111 else y // 29)) % 3]
                if (x * 7 + y * 11) % 29 == 0:
                    c = wood[3]
            px[x, y] = c
    # inner lip and plank joints on the frame
    for x in range(9, 247):
        px[x, 9] = hexc("#3a2716")
        px[x, 112] = hexc("#8a6040")
    for y in range(9, 113):
        px[9, y] = hexc("#3a2716")
        px[246, y] = hexc("#8a6040")
    for x in (64, 128, 192):
        for y in list(range(0, 9)) + list(range(113, 121)):
            px[x, y] = hexc("#3a2716")
    # corner brackets with bolts
    for cx, cy in ((1, 1), (W - 9, 1), (1, 113), (W - 9, 113)):
        for y in range(cy, cy + 8):
            for x in range(cx, cx + 8):
                px[x, y] = rgb("s") if (x - cx) in (0, 7) or (y - cy) in (0, 7) else rgb("t")
        px[cx + 3, cy + 3] = px[cx + 4, cy + 4] = rgb("S")
    # front-face shadow line
    for x in range(W):
        px[x, 121] = hexc("#2a1c10")
    # outline
    for x in range(W):
        px[x, 0] = O
        px[x, H - 1] = O
    for y in range(H):
        px[0, y] = O
        px[W - 1, y] = O

    # ------------------------------------------------------------- topographic map, x 10..245, y 10..111
    MX0, MY0, MX1, MY1 = 10, 10, 245, 111
    mw, mh = MX1 - MX0 + 1, MY1 - MY0 + 1
    hgt = fbm(240, 104, [40, 20, 10], rng)
    levels = [hexc("#b3a67c"), hexc("#a9a274"), hexc("#9c9c6a"), hexc("#8d9360"), hexc("#7e8758")]
    thr = [0.42, 0.5, 0.58, 0.66]

    def lvl(v):
        return sum(1 for t in thr if v > t)

    river_y = []
    for x in range(mw):
        river_y.append(int(mh * 0.62 + 9 * math.sin(x / 23.0) + 5 * math.sin(x / 9.0 + 1.3)))
    for y in range(mh):
        for x in range(mw):
            v = hgt[y][x]
            L = lvl(v)
            c = levels[L]
            # contour: level changes to the right or below
            if x + 1 < mw and lvl(hgt[y][x + 1]) != L or y + 1 < mh and lvl(hgt[y + 1][x]) != L:
                c = shade(c, 0.8)
            # forest stipple on high ground
            if L >= 3 and (x * 5 + y * 3) % 7 == 0 and (x // 4 + y // 4) % 2 == 0:
                c = shade(rgb("g"), 1.05)
            # faint dotted grid every 24px
            if (x % 24 == 0 and y % 2 == 0) or (y % 24 == 0 and x % 2 == 0):
                c = shade(c, 0.88)
            px[MX0 + x, MY0 + y] = c
    # river (with banks)
    water, bank = hexc("#5b8fb0"), hexc("#4a7590")
    for x in range(mw):
        ry = river_y[x]
        for dy in (-1, 0, 1):
            Y = ry + dy
            if 0 <= Y < mh:
                px[MX0 + x, MY0 + Y] = water
        for dy in (-2, 2):
            Y = ry + dy
            if 0 <= Y < mh:
                px[MX0 + x, MY0 + Y] = bank
    # a road: dashed khaki line crossing the river with a bridge
    road = hexc("#d4c49a")
    for y in range(mh):
        x = int(mw * 0.37 + 14 * math.sin(y / 17.0))
        if y % 4 != 3:
            px[MX0 + x, MY0 + y] = road
    # compass rose, bottom-right
    ink = hexc("#4a4436")
    cx, cy = MX1 - 12, MY1 - 12
    for k in range(-7, 8):
        px[cx + k, cy] = ink
        px[cx, cy + k] = ink
    for k in range(-3, 4):
        px[cx + k, cy + k] = ink
        px[cx + k, cy - k] = ink
    for k in range(-2, 3):
        px[cx + k, cy - 6] = rgb("R") if abs(k) < 2 else ink
    px[cx, cy - 8] = rgb("R")
    # paper edge highlight
    for x in range(MX0, MX1 + 1):
        px[x, MY0] = mix(px[x, MY0], hexc("#d8cca2"), 0.6)
    for y in range(MY0, MY1 + 1):
        px[MX0, y] = mix(px[MX0, y], hexc("#d8cca2"), 0.6)
    return img


# --------------------------------------------------------------------------------------------------------- pins

PIN_COLORS = {
    "working": ("b", "B", "i"),
    "blocked": ("R", "D", "j"),
    "waiting": ("a", "A", "y"),
    "watching": ("c", "C", "e"),
    "ready": ("n", "N", "f"),
    "error": ("D", "E", "R"),
    "merging": ("m", "Q", "M"),
}


def pin(base: str, dark: str, light: str) -> Image.Image:
    flagd = Draw(12, 18)
    flagd.rect(2, 2, 9, 6, base)
    flagd.hline(2, 9, 2, light)
    flagd.px(9, 4, ".")  # swallow-tail notch
    flagd.hline(2, 8, 6, dark)
    flagd.px(9, 6, dark)
    poled = Draw(12, 18)
    poled.vline(1, 1, 15, "t")
    poled.px(1, 1, "w")
    poled.vline(1, 13, 15, "s")
    shadow = Draw(12, 18)
    shadow.hline(1, 4, 17, "~")
    shadow.hline(3, 4, 16, "~")
    return render(12, 18, [(shadow.g, 0, 0, False), (poled.g, 0, 0), (flagd.g, 0, 0)], "pin")


# ----------------------------------------------------------------------------------------------------- stations

def station_argus() -> Image.Image:
    W, H = 64, 48
    tbl = Draw(W, H)
    desk(tbl, 2, 61, 26, top="k", grain="K", front="K", dark="u", legs="U")
    laptop = Draw(W, H)
    laptop.rect(5, 15, 17, 25, "S")  # lid
    laptop.rect(6, 16, 16, 24, "z")
    for y, (a, b) in zip((18, 20, 22), ((7, 13), (7, 11), (7, 14))):
        laptop.hline(a, b, y, "n")
    laptop.hline(9, 12, 17, "B")
    laptop.rect(4, 26, 18, 27, "s")  # base on the desk
    laptop.hline(5, 17, 26, "t")
    spot = Draw(W, H)  # spotting scope: short steel tube tilted up on a tripod
    spot.line(25, 19, 21, 28, "S")
    spot.line(26, 19, 30, 28, "S")
    spot.vline(25, 19, 28, "s")
    for i in range(3):
        spot.line(21, 12 + i, 29, 15 + i, "t" if i == 0 else "s" if i == 1 else "S")
    spot.rect(18, 10, 20, 15, "S")  # objective hood
    spot.vline(18, 11, 14, "b")
    spot.px(19, 11, "i")
    spot.rect(30, 15, 31, 17, "x")  # eyepiece
    spot.rect(24, 17, 26, 18, "S")  # head
    bag = Draw(W, H)  # sandbag rest under the stock
    bag.ellipse(49, 22, 61, 28, "k")
    bag.hline(51, 59, 23, "l")
    bag.hline(51, 59, 27, "K")
    bag.vline(55, 23, 27, "K")
    rifle = Draw(W, H)
    rifle.hline(35, 41, 21, "S")  # barrel
    rifle.rect(33, 20, 35, 22, "x")  # muzzle brake
    rifle.rect(38, 19, 47, 22, "g")  # handguard
    rifle.hline(38, 47, 19, "h")
    for x in (40, 42, 44):
        rifle.px(x, 21, "G")
    rifle.rect(47, 18, 53, 22, "S")  # receiver
    rifle.hline(47, 53, 18, "s")
    rifle.rect(50, 23, 52, 26, "S")  # magazine
    rifle.rect(53, 19, 59, 22, "g")  # stock
    rifle.rect(54, 23, 56, 24, "g")
    rifle.hline(53, 59, 19, "h")
    rifle.rect(60, 18, 60, 23, "x")  # butt pad
    rifle.line(41, 23, 38, 28, "S")  # bipod
    rifle.line(42, 23, 44, 28, "S")
    rifle.rect(40, 22, 42, 23, "S")
    scope = Draw(W, H)
    scope.rect(44, 15, 54, 16, "s")
    scope.hline(44, 54, 15, "t")
    scope.rect(42, 14, 44, 17, "S")
    scope.vline(42, 15, 16, "b")
    scope.rect(54, 15, 55, 16, "S")
    scope.px(47, 17, "S")
    scope.px(52, 17, "S")
    return render(W, H, [(tbl.g, 0, 0), (laptop.g, 0, 0), (spot.g, 0, 0), (bag.g, 0, 0), (rifle.g, 0, 0), (scope.g, 0, 0)], "station-argus")


def station_patch() -> Image.Image:
    W, H = 64, 48
    peg = Draw(W, H)
    peg.rect(5, 2, 58, 22, "k")
    for y in range(4, 22, 3):
        for x in range(7, 58, 3):
            peg.px(x, y, "K")
    peg.hline(5, 58, 2, "l")
    hammer = Draw(W, H)
    hammer.rect(12, 5, 19, 7, "S")
    hammer.hline(12, 19, 5, "t")
    hammer.rect(15, 8, 16, 18, "u")
    hammer.vline(15, 8, 18, "v")
    screw = Draw(W, H)
    screw.rect(24, 5, 26, 10, "R")
    screw.vline(24, 5, 10, "j")
    screw.vline(25, 11, 18, "t")
    wrench = Draw(W, H)
    wrench.ellipse(31, 4, 37, 9, "t")
    wrench.rect(33, 4, 35, 6, ".")
    wrench.rect(33, 10, 35, 19, "t")
    wrench.vline(35, 10, 19, "s")
    saw = Draw(W, H)
    saw.rect(41, 6, 54, 12, "t")
    for x in range(41, 55, 2):
        saw.px(x, 12, ".")
    saw.hline(41, 54, 6, "w")
    saw.rect(52, 4, 56, 9, "u")
    saw.rect(53, 6, 55, 7, ".")
    bench = Draw(W, H)
    desk(bench, 2, 61, 25, top="v", grain="u", front="u", dark="U", legs="U")
    vice = Draw(W, H)
    vice.rect(5, 16, 9, 24, "s")
    vice.rect(12, 16, 16, 24, "s")
    vice.hline(5, 9, 16, "t")
    vice.hline(12, 16, 16, "t")
    vice.rect(5, 21, 16, 24, "s")
    vice.rect(17, 20, 21, 20, "S")  # screw
    vice.vline(21, 18, 22, "S")
    vice.rect(10, 14, 11, 20, "k")  # clamped piece
    vice.rect(4, 24, 17, 25, "S")
    box = Draw(W, H)
    box.rect(40, 18, 56, 25, "R")
    box.hline(40, 56, 18, "j")
    box.hline(40, 56, 21, "D")
    box.rect(46, 15, 50, 16, "S")
    box.vline(46, 15, 17, "S")
    box.vline(50, 15, 17, "S")
    box.rect(47, 22, 49, 23, "t")
    bolts = Draw(W, H)
    bolts.rect(28, 23, 30, 24, "t")
    bolts.rect(33, 24, 34, 24, "t")
    return render(W, H, [(peg.g, 0, 0), (hammer.g, 0, 0), (screw.g, 0, 0), (wrench.g, 0, 0), (saw.g, 0, 0),
                         (bench.g, 0, 0), (vice.g, 0, 0), (box.g, 0, 0), (bolts.g, 0, 0)], "station-patch")


def station_medic() -> Image.Image:
    W, H = 64, 48
    legs = Draw(W, H)
    legs.line(8, 31, 38, 45, "s")
    legs.line(9, 31, 39, 45, "s")
    legs.line(38, 31, 8, 45, "t")
    legs.line(39, 31, 9, 45, "t")
    table = Draw(W, H)
    table.rect(3, 27, 44, 29, "e")
    table.hline(3, 44, 27, "w")
    table.rect(3, 30, 44, 31, "c")
    case = Draw(W, H)
    case.rect(10, 15, 32, 26, "w")
    case.rect(10, 25, 32, 26, "e")
    case.vline(32, 15, 26, "e")
    case.rect(19, 17, 23, 24, "n")
    case.rect(17, 19, 25, 22, "n")
    case.hline(18, 24, 24, "N")
    case.px(12, 15, "S")
    case.px(30, 15, "S")
    handle = Draw(W, H)
    handle.rect(17, 12, 25, 13, "S")
    handle.rect(19, 13, 23, 13, ".")
    roll = Draw(W, H)
    roll.rect(35, 21, 41, 26, "w")
    roll.vline(41, 21, 26, "e")
    roll.rect(37, 23, 38, 24, "e")
    bottle = Draw(W, H)
    bottle.rect(5, 19, 8, 26, "B")
    bottle.rect(6, 17, 7, 18, "w")
    bottle.vline(5, 20, 25, "b")
    bottle.rect(5, 21, 8, 23, "w")
    iv = Draw(W, H)
    iv.vline(55, 4, 44, "t")
    iv.vline(56, 4, 44, "s")
    iv.hline(50, 61, 45, "s")
    iv.px(51, 44, "s")
    iv.px(60, 44, "s")
    iv.hline(50, 61, 3, "t")
    iv.vline(50, 3, 5, "t")
    bag = Draw(W, H)
    bag.rect(47, 6, 53, 15, "w")
    bag.rect(47, 11, 53, 15, "i")
    bag.hline(47, 53, 6, "e")
    bag.vline(53, 7, 15, "e")
    bag.vline(50, 16, 17, "e")
    tube = Draw(W, H)
    tube.vline(50, 18, 30, "b")
    tube.line(50, 30, 44, 34, "b")
    return render(W, H, [(legs.g, 0, 0), (table.g, 0, 0), (handle.g, 0, 0), (case.g, 0, 0), (roll.g, 0, 0),
                         (bottle.g, 0, 0), (iv.g, 0, 0), (bag.g, 0, 0), (tube.g, 0, 0, False)], "station-medic")


def station_weaver() -> Image.Image:
    W, H = 64, 48
    tbl = Draw(W, H)
    desk(tbl, 2, 61, 28, leg_h=9, top="h", grain="g", front="g", dark="G", legs="G")
    crate = Draw(W, H)
    crate.rect(4, 15, 22, 27, "g")
    crate.hline(4, 22, 15, "h")
    crate.rect(4, 16, 22, 17, "G")
    crate.vline(4, 16, 27, "G")
    crate.vline(22, 16, 27, "G")
    crate.rect(8, 21, 18, 23, "a")  # stencil band
    for x in (10, 13, 16):
        crate.px(x, 22, "g")
    crate.rect(1 + 5, 19, 7, 19, "S")
    crate.rect(19, 19, 20, 19, "S")
    spool1 = Draw(W, H)
    spool1.ellipse(25, 17, 35, 27, "U")
    spool1.ellipse(26, 18, 34, 26, "r")
    for y in range(19, 26, 2):
        spool1.hline(27, 33, y, "q")
    spool1.ellipse(29, 21, 31, 23, "x")
    spool2 = Draw(W, H)
    spool2.ellipse(35, 20, 43, 28, "U")
    spool2.ellipse(36, 21, 42, 27, "b")
    for y in range(22, 27, 2):
        spool2.hline(37, 41, y, "B")
    spool2.ellipse(38, 23, 40, 25, "x")
    det = Draw(W, H)
    det.rect(46, 20, 58, 27, "g")
    det.hline(46, 58, 20, "h")
    det.rect(46, 26, 58, 27, "G")
    det.rect(49, 23, 51, 24, "a")
    det.rect(54, 23, 55, 24, "R")
    plunger = Draw(W, H)
    plunger.vline(52, 12, 19, "t")
    plunger.rect(47, 10, 57, 11, "S")
    plunger.hline(47, 57, 10, "s")
    wire = Draw(W, H)
    wire.line(46, 27, 41, 29, "R")
    wire.hline(30, 41, 30, "R")
    return render(W, H, [(tbl.g, 0, 0), (crate.g, 0, 0), (spool1.g, 0, 0), (spool2.g, 0, 0), (plunger.g, 0, 0),
                         (det.g, 0, 0), (wire.g, 0, 0, False)], "station-weaver")


def station_gate() -> Image.Image:
    W, H = 64, 48
    booth = Draw(W, H)
    booth.rect(3, 8, 23, 46, "g")
    booth.vline(23, 8, 46, "G")
    booth.rect(6, 12, 20, 22, "S")  # window frame
    booth.rect(7, 13, 19, 21, "b")
    booth.line(8, 20, 13, 14, "i")
    booth.line(10, 20, 15, 14, "i")
    booth.vline(13, 13, 21, "S")
    booth.rect(3, 23, 23, 24, "G")  # sill
    booth.rect(3, 38, 23, 46, "x")  # hazard skirt
    for x in range(3, 24):
        for y in range(38, 47):
            if (x + y) % 8 < 4:
                booth.px(x, y, "a")
    booth.rect(6, 27, 20, 34, "G")  # panel
    booth.rect(7, 28, 19, 33, "g")
    roof = Draw(W, H)
    roof.rect(1, 5, 25, 7, "S")
    roof.hline(1, 25, 5, "s")
    lamp = Draw(W, H)
    lamp.rect(11, 2, 14, 4, "a")
    lamp.hline(11, 14, 2, "y")
    post = Draw(W, H)
    post.rect(30, 22, 34, 46, "c")
    post.vline(34, 22, 46, "C")
    post.rect(29, 44, 35, 46, "C")
    weight = Draw(W, H)
    weight.rect(26, 24, 31, 29, "S")
    weight.hline(26, 31, 24, "s")
    arm = Draw(W, H)
    arm.rect(32, 25, 62, 27, "w")
    for x in range(32, 63):
        if (x // 4) % 2 == 0:
            arm.vline(x, 25, 27, "R")
    arm.hline(32, 62, 27, "e")
    for x in range(32, 63):
        if (x // 4) % 2 == 0:
            arm.px(x, 27, "D")
    hub = Draw(W, H)
    hub.rect(31, 24, 34, 28, "S")
    hub.px(32, 26, "t")
    sign = Draw(W, H)
    sign.vline(46, 28, 33, "S")
    sign.rect(42, 33, 50, 38, "R")
    sign.rect(43, 35, 49, 36, "w")
    return render(W, H, [(booth.g, 0, 0), (roof.g, 0, 0), (lamp.g, 0, 0), (post.g, 0, 0), (weight.g, 0, 0),
                         (arm.g, 0, 0), (hub.g, 0, 0), (sign.g, 0, 0)], "station-gate")


# -------------------------------------------------------------------------------------------------------- props

def crate() -> Image.Image:
    W, H = 24, 20
    top = Draw(W, H)
    top.rect(1, 1, 22, 5, "v")
    for y in (2, 4):
        top.hline(1, 22, y, "u")
    top.hline(1, 22, 1, "k")
    front = Draw(W, H)
    front.rect(1, 6, 22, 18, "u")
    for y in (9, 12, 15):
        front.hline(1, 22, y, "U")
    front.rect(1, 6, 3, 18, "v")
    front.rect(20, 6, 22, 18, "v")
    front.hline(1, 22, 6, "v")
    front.hline(1, 22, 18, "U")
    front.line(4, 17, 19, 7, "v")
    front.line(4, 16, 18, 7, "v")
    front.rect(9, 10, 14, 11, "k")  # stencil
    front.px(11, 10, "u")
    return render(W, H, [(top.g, 0, 0), (front.g, 0, 0)], "crate")


def barrel() -> Image.Image:
    W, H = 16, 22
    d = Draw(W, H)
    d.rect(1, 3, 14, 19, "g")
    d.rect(2, 20, 13, 20, "g")
    d.rect(2, 2, 13, 2, "g")
    d.vline(3, 3, 19, "h")
    d.vline(4, 3, 19, "h")
    d.rect(12, 3, 14, 19, "G")
    for y in (7, 14):
        d.hline(1, 14, y, "G")
        d.hline(1, 14, y - 1, "h")
    d.vline(9, 9, 13, "r")
    d.vline(10, 15, 18, "r")
    d.px(6, 16, "r")
    top = Draw(W, H)
    top.ellipse(1, 1, 14, 4, "S")
    top.ellipse(3, 2, 12, 3, "x")
    top.px(9, 2, "t")
    return render(W, H, [(d.g, 0, 0), (top.g, 0, 0)], "barrel")


def sandbags() -> Image.Image:
    W, H = 40, 16
    layers = []
    for i, x in enumerate((1, 10, 19, 28)):
        b = Draw(W, H)
        b.ellipse(x, 8, x + 10, 14, "k")
        b.hline(x + 2, x + 8, 9, "l")
        b.hline(x + 1, x + 9, 13, "K")
        b.px(x + 1, 11, "K")
        layers.append((b.g, 0, 0))
    for x in (5, 14, 23):
        b = Draw(W, H)
        b.ellipse(x, 2, x + 11, 9, "k")
        b.hline(x + 2, x + 9, 3, "l")
        b.hline(x + 1, x + 10, 8, "K")
        b.vline(x + 1, 5, 6, "K")
        layers.append((b.g, 0, 0))
    return render(W, H, layers, "sandbags")


def lamp() -> Image.Image:
    W, H = 16, 24
    cord = Draw(W, H)
    cord.vline(7, 0, 7, "O")
    glow = Draw(W, H)
    for y in range(9, 23):
        for x in range(1, 15):
            dx, dy = x + 0.5 - 8, y + 0.5 - 15
            if dx * dx + dy * dy < 40 and (x + y) % 2 == 0:
                glow.px(x, y, "~")
    sock = Draw(W, H)
    sock.rect(6, 8, 9, 10, "s")
    sock.hline(6, 9, 8, "t")
    bulb = Draw(W, H)
    bulb.ellipse(5, 11, 10, 18, "a")
    bulb.rect(6, 12, 7, 14, "y")
    bulb.px(6, 12, "w")
    cage = Draw(W, H)
    cage.vline(4, 11, 18, "S")
    cage.vline(11, 11, 18, "S")
    cage.hline(5, 10, 19, "S")
    cage.hline(4, 11, 15, "S")
    cage.px(5, 10, "S")
    cage.px(10, 10, "S")
    return render(W, H, [(cord.g, 0, 0, False), (sock.g, 0, 0), (bulb.g, 0, 0), (cage.g, 0, 0, False)], "lamp")


def screen() -> Image.Image:
    W, H = 48, 32
    d = Draw(W, H)
    d.rect(1, 1, 46, 30, "s")
    d.hline(1, 46, 1, "t")
    d.vline(1, 1, 30, "t")
    d.hline(1, 46, 30, "S")
    d.vline(46, 1, 30, "S")
    d.rect(5, 5, 42, 5, "S")  # inner bevel
    d.vline(5, 5, 25, "S")
    d.hline(5, 42, 25, "t")
    d.vline(42, 5, 25, "t")
    d.rect(6, 6, 41, 24, "z")
    for y in range(7, 24, 2):
        d.hline(6, 41, y, "Z")
    d.px(7, 7, "S")
    d.rect(39, 27, 40, 28, "n")  # power LED
    d.hline(8, 14, 27, "S")  # vent slots
    d.hline(8, 14, 28, "S")
    for x, y in ((3, 3), (44, 3), (3, 28), (44, 28)):
        d.px(x, y, "S")
    return render(W, H, [(d.g, 0, 0)], "screen")


def plate() -> Image.Image:
    W, H = 48, 12
    d = Draw(W, H)
    d.rect(1, 1, 46, 10, "t")
    d.hline(1, 46, 1, "w")
    d.vline(1, 1, 10, "e")
    d.hline(1, 46, 10, "s")
    d.vline(46, 1, 10, "s")
    d.rect(4, 3, 43, 8, "c")  # recessed blank field
    d.hline(4, 43, 3, "s")
    d.vline(4, 3, 8, "s")
    d.hline(4, 43, 8, "e")
    d.vline(43, 3, 8, "e")
    for x, y in ((2, 2), (45, 2), (2, 9), (45, 9)):
        d.px(x, y, "S")
    return render(W, H, [(d.g, 0, 0)], "plate")


def build_warroom() -> dict:
    out = {
        "floor": floor_tile(),
        "wall": wall_tile(),
        "stripe": stripe_tile(),
        "table": map_table(),
    }
    for state, (base, dark, light) in PIN_COLORS.items():
        out[f"pin-{state}"] = pin(base, dark, light)
    out.update({
        "station-argus": station_argus(),
        "station-patch": station_patch(),
        "station-medic": station_medic(),
        "station-weaver": station_weaver(),
        "station-gate": station_gate(),
        "crate": crate(),
        "barrel": barrel(),
        "sandbags": sandbags(),
        "lamp": lamp(),
        "screen": screen(),
        "plate": plate(),
    })
    return out
