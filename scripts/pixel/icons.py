"""16x16 icon art. Every entry is either a grid (centred, auto-outlined) or a list of layers (grid, x, y[, outline]).

Shapes are drawn without their outline; pixel_lib.compose adds the 1px #1c1b22 outline per layer.
"""

from __future__ import annotations

import math

from pixel_lib import G, along, disc, flip_h, flip_v, recolor, shape, stamp

# ----------------------------------------------------------------------------------------------------------- parts

PERSON = G("""
    ...bbbb...
    ..bbbbbb..
    ..bbbbbB..
    ..bbbbbB..
    ..bbbbBB..
    ...bbBB...
    ..........
    .bbbbbbbB.
    bbbbbbbbBB
    bbbbbbbbBB
    bbbbbbbbBB
    bbbbbbbbBB
""")

PERSON_S = G("""
    ..bb..
    .bbbB.
    .bbbB.
    ..bB..
    ......
    bbbbbB
    bbbbBB
    bbbbBB
""")

DOC = G("""
    wwwwwww...
    wCCCCwwe..
    wwwwwwwee.
    wCCCCCweee
    wwwwwwwwww
    wCCCCCCCCw
    wwwwwwwwww
    wCCCCCCCCw
    wwwwwwwwww
    wCCCCCCCCw
    wwwwwwwwww
    wCCCCCwwww
    wwwwwwwwww
""")

DOC_S = G("""
    wwwwwwww
    wCCCCCww
    wwwwwwww
    wCCCCCCw
    wwwwwwww
    wCCCCCCw
    wwwwwwww
    wCCCCwww
    wwwwwwww
""")

MAG = G("""
    ..tttt......
    .tbbbbt.....
    tbwwbbbt....
    tbwbbbbt....
    tbbbbbbt....
    tbbbbbbt....
    .tbbbbt.....
    ..ttttUU....
    ......UUU...
    .......UUU..
    ........UUU.
    .........UU.
""")

MAG_S = G("""
    .ttt...
    tbwbt..
    tbbbt..
    tbbbt..
    .tttU..
    ....UU.
    .....UU
""")

CHECK = G("""
    .........nn
    ........nnn
    .......nnn.
    nn....nnn..
    nnn..nnn...
    .nnnnnn....
    ..nnnn.....
    ...nn......
""")

CHECK_S = G("""
    ......n
    .....nn
    n...nn.
    nn.nn..
    .nnn...
    ..n....
""")

XMARK = G("""
    RR......RR
    RRR....RRR
    .RRR..RRR.
    ..RRRRRR..
    ...RRRR...
    ...RRRR...
    ..RRRRRR..
    .RRR..RRR.
    RRR....RRR
    RR......RR
""")

XMARK_S = G("""
    ww...ww
    .ww.ww.
    ..www..
    .ww.ww.
    ww...ww
""")

PLAY_S = G("""
    n...
    nn..
    nnn.
    nnnn
    nnn.
    nn..
    n...
""")

EXCLAM = G("""
    aa
    aa
    aa
    aa
    AA
    ..
    aa
    AA
""")

FLAG_SHAPE = G("""
    ss..........
    ssXXXXXXXXXX
    ssXXXXXXXXXX
    ssXXXXXXXXX.
    ssXXXXXXXX..
    ssXXXXXXXXX.
    ssYYYYYYYYYY
    ss..........
    ss..........
    ss..........
    ss..........
    ss..........
    ss..........
    SS..........
""")

NODE = G("""
    .XX.
    XXXX
    XXXX
    .XX.
""")

COIN_STACK = G("""
    .yyyyyy.
    yaaaaaay
    AAAAAAAA
    aaaaaaaa
    AAAAAAAA
    aaaaaaaa
    AAAAAAAA
    aaaaaaaa
    AAAAAAAA
""")


def gear(d: int, teeth: int = 8, ch: str = "s", shade: str = "S", hole: float = 1.4, depth: float = 1.7):
    c = d / 2

    def f(x: float, y: float):
        dx, dy = x - c, y - c
        r = math.hypot(dx, dy)
        th = math.atan2(dy, dx) + math.pi / teeth / 2
        body = c - depth
        tooth = math.cos(teeth * th) > 0.15
        if r <= hole:
            return None
        if r <= body or (r <= c - 0.05 and tooth):
            if r <= hole + 1.1:
                return shade
            return shade if dx + dy > c * 0.7 else ch
        return None

    return shape(d, d, f)


def ring(d: int, inner: float, ch: str, gap=None, shade=None):
    c = d / 2

    def f(x: float, y: float):
        dx, dy = x - c, y - c
        r = math.hypot(dx, dy)
        if not (inner <= r <= c - 0.1):
            return None
        if gap is not None:
            ang = math.degrees(math.atan2(-dy, dx)) % 360
            g0, g1 = gap
            if g0 <= ang <= g1:
                return None
        if shade and dx + dy > c * 0.6:
            return shade
        return ch

    return shape(d, d, f)


def person(color: str, shade: str):
    return recolor(PERSON, {"b": color, "B": shade})


def person_s(color: str, shade: str):
    return recolor(PERSON_S, {"b": color, "B": shade})


def flag(color: str, shade: str):
    return recolor(FLAG_SHAPE, {"X": color, "Y": shade})


def node(color: str):
    return recolor(NODE, {"X": color})


# ------------------------------------------------------------------------------------------------- procedural art

def _pencil():
    def eraser(t, d):
        return "q" if d > 0.7 else "r"

    def ferrule(t, d):
        return "S" if d > 0.7 else "t"

    def body(t, d):
        return "A" if d > 0.6 else ("y" if d < -0.9 else "a")

    def wood(t, d):
        return "x" if t > 0.9 else "l"

    return along(14, 14, (12.6, 1.4), (1.0, 13.0), [
        (0.0, 0.16, 1.9, 1.9, eraser),
        (0.16, 0.27, 1.9, 1.9, ferrule),
        (0.27, 0.74, 1.9, 1.9, body),
        (0.74, 1.0, 1.9, 0.3, wood),
    ])


def _wrench(ch="t", shade="s"):
    cx, cy = 10.0, 4.0

    def f(x, y):
        # head with an open jaw facing the top-right corner
        dx, dy = x - cx, y - cy
        if math.hypot(dx, dy) <= 3.7:
            al = (dx - dy) / math.sqrt(2)
            pe = (dx + dy) / math.sqrt(2)
            if al > -0.2 and abs(pe) < 1.25:
                return None
            return shade if pe > 1.6 else ch
        t = ((x - 2) * 6 + (y - 12) * -6) / 72
        d = ((x - 2) * -6 - (y - 12) * 6) / math.sqrt(72)
        if -0.05 <= t <= 1.0 and abs(d) <= 1.35:
            return shade if d < -0.5 else ch
        return None

    return shape(14, 14, f)


def _screwdriver():
    def handle(t, d):
        return "D" if d > 0.6 else "R"

    return along(14, 14, (1.2, 1.2), (12.8, 12.8), [
        (0.0, 0.42, 1.9, 1.9, handle),
        (0.42, 0.5, 1.2, 1.2, lambda t, d: "S"),
        (0.5, 1.0, 0.75, 0.75, lambda t, d: "t"),
    ])


def _brush():
    def bristles(t, d):
        band = int((t - 0.58) * 14 + (1 if d > 0 else 0))
        return "gkG"[band % 3]

    return along(14, 14, (13.0, 1.0), (1.2, 12.8), [
        (0.0, 0.48, 1.0, 1.0, lambda t, d: "U" if d > 0.3 else "u"),
        (0.48, 0.58, 1.6, 1.6, lambda t, d: "s" if d > 0.6 else "t"),
        (0.58, 1.0, 2.4, 1.6, bristles),
    ])


def _nib():
    def grip(t, d):
        return "S" if d > 0.5 else "s"

    def nib(t, d):
        if t > 0.5 and abs(d) < 0.45:
            return "O"
        if 0.38 <= t <= 0.5 and abs(d) < 0.9:
            return "O"
        return "A" if d > 0 else "y" if d < -1.6 else "a"

    return along(14, 14, (12.8, 1.2), (1.4, 12.6), [
        (0.0, 0.22, 1.6, 1.6, grip),
        (0.22, 0.3, 2.6, 2.9, lambda t, d: "t"),
        (0.3, 1.0, 2.9, 0.2, nib),
    ])


def _moon():
    def f(x, y):
        if math.hypot(x - 6, y - 6) > 5.9:
            return None
        if math.hypot(x - 8.6, y - 4.0) < 4.6:
            return None
        return "K" if (x - 6) + (y - 6) > 3 else "l"

    return shape(12, 12, f)


def _refresh():
    def f(x, y):
        dx, dy = x - 7, y - 8
        r = math.hypot(dx, dy)
        if not (3.9 <= r <= 5.95):
            return None
        ang = math.degrees(math.atan2(-dy, dx)) % 360
        if 8 <= ang <= 84:
            return None
        return "B" if dx + dy > 3.5 else "b"

    g = shape(14, 14, f)
    head = G("""
        b...
        bb..
        bbb.
        bbbb
        bbB.
        bB..
        B...
    """)
    return stamp(g, head, 7, 0)


def _conflict_arrow(ch, shade):
    def f(x, y):
        X, Y = int(x), int(y)
        if X >= 9 and Y <= 4 and (13 - X) + Y <= 4:
            return ch
        if X + Y in (13, 14) and Y >= 3 and X <= 10:
            return shade if X + Y == 14 else ch
        return None

    return shape(14, 14, f)


def _clock():
    face = disc(14, "w", "e")
    rim = ring(14, 5.9, "s")
    g = stamp(face, rim, 0, 0)
    hands = G("""
        ......x.......
        ......x.......
        ......x.......
        ......x.......
        ......xxxx....
    """)
    g = stamp(g, hands, 0, 3)
    g[7][6] = "R"
    return g


def _globe():
    return G("""
        .....bbbb.....
        ...bbnnbbbb...
        ..bnnnnnbbbb..
        .bbnnnnbbbnnb.
        .bbbnnbbbnnnb.
        bbbbnnbbbnnnnb
        bbbbbnbbbbnnbB
        bbbbbbbbbbnbbB
        bbnnbbbbbbbbbB
        .bnnnnbbbbbbB.
        .bbnnnnbbbnbB.
        ..bbnnnbbnnB..
        ...bbbbbbBB...
        .....BBBB.....
    """)


# ------------------------------------------------------------------------------------------------------- the icons

def build_icons() -> dict:
    I: dict = {}

    # navigation / app chrome ---------------------------------------------------------------------------------
    I["office"] = G("""
        eeeeeeeeeee
        ccccccccccC
        cbbcbbcbbcC
        cBBcBBcBBcC
        ccccccccccC
        cbbcbbcbbcC
        cBBcBBcBBcC
        ccccccccccC
        cbbcbbcbbcC
        cBBcBBcBBcC
        ccccccccccC
        ccccuuucccC
        ccccuuucccC
    """)
    I["agents"] = G("""
        ...gggggg...
        ..gggggggg..
        .gggggggggg.
        .GGGGGGGGGG.
        SSllllllllSS
        SSlOllllOlSS
        SSllllllllSS
        ..llllllll..
        ...llllll...
        ............
        ..gggggggg..
        .gggGggGggg.
        gggggggggggg
    """)
    I["library"] = G("""
        ggg.........
        ggg.rrr.....
        gkg.rrr.bbb.
        ggg.rkr.bbb.
        ggg.rrr.bwb.
        ggg.rrr.bbb.
        ggg.rrr.bbb.
        ggg.rrr.bbb.
        ggg.rkr.bbb.
        gkg.rrr.bwb.
        ggg.rrr.bbb.
        uuuuuuuuuuuu
        UUUUUUUUUUUU
    """)
    I["dashboard"] = G("""
        ....nnaaa....
        ..nnnxxxaaR..
        .nnxxxxxxxRR.
        .nxxxxxxwxxR.
        nnxxxxxwwxxRR
        nxxxxxxwxxxxR
        nxxxxxwxxxxxR
        nxxxxxwwxxxxR
        SSSSSSSSSSSSS
    """)
    I["tasks"] = G("""
        ...ssssss...
        wwwsSSSSswww
        wnnwwwwwwwww
        wnnwCCCCCCww
        wwwwwwwwwwww
        wnnwwwwwwwww
        wnnwCCCCCwww
        wwwwwwwwwwww
        wccwwwwwwwww
        wccwCCCCCCCw
        wwwwwwwwwwww
        wccwwwwwwwww
        wccwCCCCwwww
        wwwwwwwwwwww
    """)
    pr_lines = G("""
        ................
        ................
        ........c.......
        ....cc.cccccc...
        ....cccccccccc..
        ....cc.ccccccc..
        ....cc..c...cc..
        ....cc......cc..
        ....cc......cc..
        ....cc......cc..
        ....cc......cc..
        ....cc......cc..
        ....cc......cc..
        ................
        ................
        ................
    """)
    I["prs"] = [(pr_lines, 0, 0), (node("a"), 3, 1), (node("a"), 3, 11), (node("n"), 11, 11)]
    I["settings"] = gear(14)
    I["announcement"] = G("""
        ......kK....
        .....kkK...a
        ....kkkK.a.a
        ...kkkkK.a.a
        sskkkkkK.a.a
        sskkkkkK.a.a
        sskkkkkK.a.a
        sskkkkkK.a.a
        ...kkkkK.a.a
        ....kkkK.a.a
        .....kkK...a
        ......kK....
    """)
    I["report"] = G("""
        ....ssss....
        uuusSSSSsuuu
        uwwwwwwwwwwu
        uwCCCCCCCwwu
        uwwwwwwwwwwu
        uwCCCCCwwwwu
        uwwwwwwwwwwu
        uwCCCCCCCCwu
        uwwwwwwwwwwu
        uwCCCCwwwwwu
        uwwwwwwwwwwu
        uwwwwwwRRRwu
        uwwwwwwwwwwu
        uuuuuuuuuuuu
    """)
    pole = G("\n".join(["UU"] * 14))
    sign_r = G("""
        kkkkkkkkkkk.
        kkkkkkkkkkkk
        KKKKKKKKKKK.
    """)
    sign_l = recolor(flip_h(sign_r), {"k": "a", "K": "A"})
    I["decision"] = [(pole, 7, 1), (sign_r, 2, 2), (sign_l, 2, 8)]
    table = G("""
        vvvvvvvvvvvvvv
        uuuuuuuuuuuuuu
        .U..........U.
    """)
    # two people behind a table, a speech bubble above
    I["meeting"] = [
        (person_s("b", "B"), 1, 5),
        (person_s("k", "K"), 9, 5),
        (G("""
            .wwwwww.
            wCwCwCww
            .wwwwww.
            .....w..
        """), 4, 1),
        (table, 1, 11),
    ]
    I["sun"] = G("""
        ......aa......
        .aa...aa...aa.
        .aa........aa.
        ..............
        .....yyaa.....
        ....yyaaaa....
        aa..yaaaaA..aa
        aa..aaaaaA..aa
        ....aaaaAA....
        .....aAAA.....
        ..............
        .aa........aa.
        .aa...aa...aa.
        ......aa......
    """)
    I["moon"] = _moon()
    bars3 = G("""
        eeeeeeeeeeee
        eeeeeeeeeeee
        cccccccccccc
        ............
        eeeeeeeeeeee
        eeeeeeeeeeee
        cccccccccccc
        ............
        eeeeeeeeeeee
        eeeeeeeeeeee
        cccccccccccc
    """)
    I["menu"] = bars3
    I["close"] = recolor(XMARK, {"R": "e"})
    I["search"] = recolor(MAG, {"U": "S"})
    lens_diff = stamp(MAG, G("""
        nnnn
        ....
        RRRR
    """), 2, 3)
    lens_diff[3][2] = "b"
    I["review"] = lens_diff
    I["plus"] = G("""
        ....nnnn....
        ....nnnn....
        ....nnnn....
        ....nnnN....
        nnnnnnnnnnnn
        nnnnnnnnnnnN
        nnnnnnnnnnnN
        NNNNnnnNNNNN
        ....nnnN....
        ....nnnN....
        ....nnnN....
        ....NNNN....
    """)
    I["minus"] = G("""
        RRRRRRRRRRRR
        RRRRRRRRRRRD
        RRRRRRRRRRRD
        DDDDDDDDDDDD
    """)
    I["edit"] = _pencil()
    I["trash"] = G("""
        ....tttt....
        ....t..t....
        tttttttttttt
        SSSSSSSSSSSS
        .tttttttttt.
        .ttStStStSt.
        .ttStStStSt.
        .ttStStStSt.
        .ttStStStSt.
        .ttStStStSt.
        .ttStStStSt.
        .tttttttttt.
        ..ssssssss..
    """)
    I["refresh"] = _refresh()
    frame = G("""
        eeeeeeeeee
        eeeeeeeeee
        ee......ee
        ee......ee
        ee......ee
        ee......ee
        ee......ee
        ee......ee
        eeeeeeeeee
        cccccccccc
    """)
    arrow_ur = G("""
        ..bbbbbb
        ...bbbbb
        ....bbbb
        ...bbbbb
        ..bbb.bb
        .bbb...b
        bbb.....
        bb......
    """)
    I["external"] = [(frame, 1, 5), (arrow_ur, 7, 1)]
    I["copy"] = [(recolor(DOC_S, {"w": "e", "C": "c"}), 2, 1), (DOC_S, 6, 6)]
    tray = G("""
        cc..........cc
        cc..........cc
        cccccccccccccc
        CCCCCCCCCCCCCC
    """)
    arrow_down = G("""
        ...nnnn...
        ...nnnn...
        ...nnnN...
        ...nnnN...
        nnnnnnnnnN
        .nnnnnnnN.
        ..nnnnnN..
        ...nnnN...
        ....nN....
    """)
    I["download"] = [(tray, 1, 11), (arrow_down, 3, 1)]
    I["upload"] = [(tray, 1, 11), (recolor(flip_v(arrow_down), {"n": "b", "N": "B"}), 3, 1)]
    I["filter"] = G("""
        kkkkkkkkkkkk
        lllllllllllK
        .kkkkkkkkkK.
        ..kkkkkkkK..
        ...kkkkkK...
        ....kkkK....
        ....kkkK....
        ....kkkK....
        ....kkkK....
        ....kkkK....
        .....kkK....
        ......kK....
    """)
    arrow_up = G("""
        ..e..
        .eee.
        eeeee
        .eee.
        .eee.
        .eee.
        .eee.
        .eee.
        .eee.
        .ccc.
    """)
    I["sort"] = [(arrow_up, 2, 2), (flip_v(arrow_up), 9, 4)]
    I["lock"] = G("""
        ....tttt....
        ...tttttt...
        ..tt....tt..
        ..tt....tt..
        ..tt....tt..
        aaaaaaaaaaaa
        ayyyyyyyyyya
        aaaaaxxaaaaa
        aaaaaxxaaaaa
        aaaaaxxaaaaa
        aaaaaxxaaaaa
        aaaaaaaaaaaa
        AAAAAAAAAAAA
    """)
    I["unlock"] = G("""
        ......tttt..
        .....tttttt.
        .....tt..tt.
        .....tt..tt.
        .........tt.
        nnnnnnnnnnnn
        nhhhhhhhhhhn
        nnnnnxxnnnnn
        nnnnnxxnnnnn
        nnnnnxxnnnnn
        nnnnnxxnnnnn
        nnnnnnnnnnnn
        NNNNNNNNNNNN
    """)
    I["eye"] = G("""
        ....wwwwww....
        ..wwwbbbbwww..
        .wwwbbxxbbwww.
        wwwwbxwxxbwwww
        wwwwbxxxxbwwww
        .wwwbbxxbbwww.
        ..wwwbbbbwww..
        ....wwwwww....
    """)
    I["bell"] = G("""
        .....aa.....
        ....aaaa....
        ...ayaaaa...
        ...ayaaaA...
        ..ayaaaaaA..
        ..ayaaaaaA..
        ..aaaaaaaA..
        .aaaaaaaaaA.
        aaaaaaaaaaaA
        AAAAAAAAAAAA
        ............
        .....aa.....
        .....AA.....
    """)
    I["mail"] = G("""
        wwwwwwwwwwwwww
        wCwwwwwwwwwwCw
        wwCwwwwwwwwCww
        wwwCwwwwwwCwww
        wwwwCwwwwCwwww
        wwwwwCwwCwwwww
        wwwwwwCCwwwwww
        wwwwwwwwwwwwww
        wwwwwwwwwwwwww
        eeeeeeeeeeeeee
    """)
    I["chat"] = G("""
        .bbbbbbbbbbbb.
        bbbbbbbbbbbbbb
        bbbbbbbbbbbbbB
        bbbwwbwwbwwbbB
        bbbwwbwwbwwbbB
        bbbbbbbbbbbbbB
        bbbbbbbbbbbbbB
        .bbbbbbbbbbBB.
        ..bbb.........
        ..bb..........
        ..b...........
    """)
    I["user"] = person("b", "B")
    I["team"] = [(person_s("g", "G"), 1, 1), (person_s("k", "K"), 9, 1), (person("b", "B"), 3, 3)]
    I["folder"] = G("""
        AAAAA.........
        AAAAAAAAAAAAAA
        AAAAAAAAAAAAAA
        yyyyyyyyyyyyyy
        aaaaaaaaaaaaaa
        aaaaaaaaaaaaaa
        aaaaaaaaaaaaaa
        aaaaaaaaaaaaaa
        aaaaaaaaaaaaaa
        aaaaaaaaaaaaaa
        AAAAAAAAAAAAAA
    """)
    I["file"] = DOC
    I["clock"] = _clock()
    I["calendar"] = G("""
        ..ss....ss..
        RRssRRRRssRR
        RRRRRRRRRRRR
        DDDDDDDDDDDD
        wwwwwwwwwwww
        wCwwCwwCwwCw
        wwwwwwwwwwww
        wCwwCwwbbwCw
        wwwwwwwbbwww
        wCwwCwwwwwCw
        wwwwwwwwwwww
        eeeeeeeeeeee
    """)
    I["chart"] = G("""
        C.........bbb.
        C.........bbb.
        C.........bbB.
        C.....aaa.bbB.
        C.....aaa.bbB.
        C.....aaA.bbB.
        C.....aaA.bbB.
        C.nnn.aaA.bbB.
        C.nnn.aaA.bbB.
        C.nnN.aaA.bbB.
        C.nnN.aaA.bbB.
        C.nnN.aaA.bbB.
        CCCCCCCCCCCCCC
    """)
    I["star"] = G("""
        ......aa......
        ......aa......
        .....ayaa.....
        .....ayaa.....
        aaaaayyaaaaaaa
        .aaaaaaaaaaaA.
        ..aaaaaaaaaA..
        ...aaaaaaaA...
        ...aaaaaaaA...
        ..aaaaaaaaaA..
        ..aaaA..aaaA..
        .aaA......aaA.
        .aA........aA.
    """)
    I["flag"] = flag("R", "D")
    I["pin"] = G("""
        ...RRRR...
        .RRRRRRRR.
        .RRRwwRRRD
        RRRwwwwRRD
        RRRwwwwRRD
        .RRRwwRRRD
        .RRRRRRRD.
        ..RRRRRDD.
        ...RRRDD..
        ...RRRD...
        ....RD....
        ....RD....
    """)
    link_ring = G("""
        .tttttt.
        tttttttt
        tt....tt
        tt....ts
        ttttttss
        .sssss..
    """)
    I["link"] = [(link_ring, 1, 4), (recolor(link_ring, {"t": "b", "s": "B"}), 7, 6)]
    I["play"] = G("""
        n.........
        nnn.......
        nnnnn.....
        nnnnnnn...
        nnnnnnnnn.
        nnnnnnnnnN
        nnnnnnnnN.
        nnnnnnN...
        nnnnN.....
        nnN.......
        N.........
    """)
    I["pause"] = G("""
        aaaa..aaaa
        aaaA..aaaA
        aaaA..aaaA
        aaaA..aaaA
        aaaA..aaaA
        aaaA..aaaA
        aaaA..aaaA
        aaaA..aaaA
        aaaA..aaaA
        aaaA..aaaA
        AAAA..AAAA
    """)
    I["stop"] = G("""
        RRRRRRRRRR
        RRRRRRRRRD
        RRRRRRRRRD
        RRRRRRRRRD
        RRRRRRRRRD
        RRRRRRRRRD
        RRRRRRRRRD
        RRRRRRRRRD
        RRRRRRRRRD
        DDDDDDDDDD
    """)
    info = disc(14, "b", "B")
    info = stamp(info, G("""
        ww
        ww
        ..
        ..
        ww
        ww
        ww
        ww
        ww
        ww
    """), 6, 2)
    I["info"] = info
    I["warning"] = G("""
        ......aa......
        ......aa......
        .....aaaa.....
        .....aaaa.....
        ....aaxxaa....
        ....aaxxaa....
        ...aaaxxaaa...
        ...aaaxxaaa...
        ..aaaaxxaaaa..
        ..aaaaaaaaaa..
        .aaaaaxxaaaaa.
        .aaaaaxxaaaaa.
        aaaaaaaaaaaaaa
        AAAAAAAAAAAAAA
    """)
    I["error"] = stamp(disc(14, "R", "D"), G("""
        ww....ww
        www..www
        .wwwwww.
        ..wwww..
        ..wwww..
        .wwwwww.
        www..www
        ww....ww
    """), 3, 3)
    I["check"] = CHECK
    I["cross"] = XMARK
    I["pending"] = G("""
        UUUUUUUUUU
        .wwwwwwww.
        .waaaaaaw.
        ..waaaaw..
        ...waaw...
        ....aw....
        ....wa....
        ...wwaw...
        ..wwwaww..
        .wwwaaaww.
        .waaaaaaw.
        UUUUUUUUUU
    """)
    I["dot"] = disc(8, "b", "B")
    I["dot"][2][2] = "w"
    sparkle_big = G("""
        .....a.....
        .....a.....
        ....aaa....
        ....aaa....
        ..aaaaaaa..
        aaaaayaaaaa
        ..aaaaaaa..
        ....aaa....
        ....aaa....
        .....a.....
        .....a.....
    """)
    sparkle_small = G("""
        .w.
        www
        .w.
    """)
    I["sparkle"] = [(sparkle_big, 1, 4), (sparkle_small, 12, 1), (sparkle_small, 11, 11)]
    I["fire"] = G("""
        ......R.....
        ......RR....
        .....RRR....
        .....RRRR...
        ..R.RRRRR...
        ..RRRRaRRR.R
        .RRRRaaRRRRR
        .RRRaaaaRRRR
        RRRRaaaaaRRR
        RRRaaayaaRRR
        RRRaayyyaaRR
        .RRaayyyaRR.
        ..RRaaaaRR..
        ...DDDDDD...
    """)
    I["terminal"] = G("""
        ssssssssssssss
        sxxxxxxxxxxxxs
        sxnxxxxxxxxxxs
        sxxnxxxxxxxxxs
        sxxxnxxxxxxxxs
        sxxnxxxxxxxxxs
        sxnxxnnnnxxxxs
        sxxxxxxxxxxxxs
        sxxxxxxxxxxxxs
        ssssssssssssss
    """)
    I["code"] = G("""
        ........a.....
        ........a.....
        .......a......
        ..bb...a..bb..
        .bb....a...bb.
        bb....a.....bb
        .bb...a....bb.
        ..bb..a...bb..
        .....a........
        .....a........
    """)
    git_line = G("cccccccccccccc\ncccccccccccccc")
    git_node = stamp(disc(8, "r", "q"), G("ww\nww"), 3, 3)
    I["git"] = [(git_line, 1, 7), (git_node, 4, 4)]
    branch_lines = G("""
        ................
        ................
        ................
        ....cc..........
        ....cc..........
        ....cc......cc..
        ....cc......cc..
        ....cc.....cc...
        ....cc....cc....
        ....cc...cc.....
        ....cc.ccc......
        ....ccccc.......
        ....cc..........
        ................
        ................
        ................
    """)
    I["branch"] = [(branch_lines, 0, 0), (node("a"), 3, 1), (node("a"), 3, 11), (node("n"), 11, 2)]
    merge_lines = G("""
        ................
        ................
        ................
        ...cc......cc...
        ...cc......cc...
        ....cc....cc....
        .....cc..cc.....
        ......cccc......
        .......cc.......
        .......cc.......
        .......cc.......
        ................
        ................
        ................
        ................
        ................
    """)
    merge_head = G("""
        nnnnnnnn
        .nnnnnN.
        ..nnnN..
        ...nN...
    """)
    I["merge"] = [(merge_lines, 0, 0), (node("a"), 2, 1), (node("b"), 10, 1), (merge_head, 4, 10)]
    I["robot"] = G("""
        .....aa.....
        .....SS.....
        .tttttttttt.
        .tttttttttt.
        Stbbbttbbbts
        Stbwbttbwbts
        Stbbbttbbbts
        .tttttttttt.
        .ttSSSSSStt.
        .tttttttttt.
        ...ssssss...
    """)
    I["crown"] = G("""
        a....aa....a
        aa..aaaa..aa
        aaaaaaaaaaaa
        ayyyyyyyyyya
        aaRaabbaaRaa
        aaaaaaaaaaaa
        AAAAAAAAAAAA
    """)
    I["coffee"] = G("""
        ..w...w.....
        ...w...w....
        ..w...w.....
        ............
        eUUUUUUUe...
        kkkkkkkkkkk.
        kkkkkkkkK..k
        kkkkkkkkK..k
        kkkkkkkkK..k
        kkkkkkkkKkk.
        kkkkkkkkK...
        KKKKKKKKK...
    """)
    I["book"] = G("""
        qrrrrrrrrrr
        qrrrrrrrrrr
        qrrlllllrrr
        qrrlllllrrr
        qrrrrrrrrrr
        qrrrrrrrrrr
        qrrrrrrrrrr
        qrrrrrrrrrr
        qrrrrrrrrrr
        qrrrrrrrrrr
        qwwwwwwwwww
        qeeeeeeeeee
        qqqqqqqqqqq
    """)
    I["graduation"] = G("""
        ......ss......
        ....ssssss....
        ..ssssssssss..
        ssssssssssssss
        ..ssssssssss.a
        ....ssssss...a
        ...SSSssSSS..a
        ...SSSSSSSS.aa
        ...SSSSSSSS.aa
        ....SSSSSS....
    """)
    I["key"] = G("""
        .aaaa.........
        ayyaaa........
        aa..aaaaaaaaaa
        aa..aaaaaaaaaA
        aaaaaa...a.aA.
        .AAAA....A.AA.
    """)
    I["globe"] = _globe()
    I["phone"] = G("""
        SSSSSSSS
        SSSxxSSS
        SbbbbbbS
        SbwbbbbS
        SbbwbbbS
        SbbbbbbS
        SbbbbbbS
        SbbbbbbS
        SbbbbbbS
        SbbbbbbS
        SSSSSSSS
        SSSttSSS
        SSSSSSSS
    """)
    I["camera"] = G("""
        ...SSSS.......
        ssssssssssssss
        sssssSSSSsssas
        ssssSbbbbSssss
        sssSbbwbbbSsss
        sssSbwbbbbSsss
        sssSbbbbbbSsss
        sssSbbbbbbSsss
        ssssSbbbbSssss
        sssssSSSSsssss
        SSSSSSSSSSSSSS
    """)
    I["image"] = G("""
        eeeeeeeeeeeeee
        ebbbbbbbbbbbbe
        ebbbbbbbbaabbe
        ebbbbbbbbaabbe
        ebbbbbbbbbbbbe
        ebbbbgbbbbbbbe
        ebbbgggbbbbbbe
        ebbgggggbbgbbe
        ebggggggggggbe
        egggggggggGGGe
        egggggggGGGGGe
        eeeeeeeeeeeeee
    """)
    I["video"] = [
        (G(".SS.\nSttS\nSttS\n.SS."), 1, 1),
        (G(".SS.\nSttS\nSttS\n.SS."), 6, 1),
        (G("""
            ssssssssss..xx
            ssssssssssxxxx
            sRssssssssxxxx
            ssssssssssxxxx
            ssssssssssxxxx
            SSSSSSSSSS..xx
        """), 1, 7),
    ]
    I["music"] = G("""
        ....bbbbbbbb
        ....bbbbbbbb
        ....b......b
        ....b......b
        ....b......b
        ....b......b
        ....b......b
        ....b......b
        ....b......b
        ..bbb....bbb
        .bbbb...bbbB
        .bbB....bbB.
    """)
    note = G("""
        nnnnnnnnnnnn
        nNNNNNNNNNNn
        nNnnnwwnnnNn
        nNnnwNNwnnNn
        nNnnwNNwnnNn
        nNnnnwwnnnNn
        nNNNNNNNNNNn
        nnnnnnnnnnnn
    """)
    I["money"] = [(recolor(note, {"n": "N", "N": "G", "w": "h"}), 3, 2), (note, 1, 6)]
    I["gift"] = G("""
        .aaa....aaa.
        .a.aa..aa.a.
        .aaaaaaaaaa.
        RRRRRaaRRRRR
        RRRRRaaRRRRR
        DDDDDaaDDDDD
        .RRRRaaRRRR.
        .RRRRaaRRRR.
        .RRRRaaRRRR.
        .RRRRaaRRRR.
        .RRRRaaRRRR.
        .DDDDAADDDD.
    """)
    I["heart"] = G("""
        .RRR....RRR.
        RRRRR..RRRRR
        RwwRRRRRRRRR
        RwRRRRRRRRRD
        RRRRRRRRRRRD
        .RRRRRRRRRD.
        ..RRRRRRRD..
        ...RRRRRD...
        ....RRRD....
        .....RD.....
    """)
    I["bolt"] = G("""
        .....aaaaa
        ....ayaaa.
        ....yaaa..
        ...yaaa...
        ..yaaa....
        .yaaaaaaaa
        aaaaaaaaA.
        ....aaaA..
        ...aaaA...
        ...aaA....
        ..aaA.....
        ..aA......
        .aA.......
        .A........
    """)
    I["bug"] = G("""
        ...O.....O...
        ....O...O....
        .....SSS.....
        ....SSSSS....
        O..RRRORRR..O
        .OORRRORRROO.
        ..RRRRORRRR..
        OORRwRORRRROO
        ..RRRRORRRR..
        .ORRRRORRRRO.
        O.RRRRORRRR.O
        ...RRRORRR...
        ....RRORR....
    """)
    I["test"] = G("""
        ...eeeeee...
        ....wwww....
        ....weew....
        ....weew....
        ...weeeew...
        ...weeeew...
        ..weeeeeew..
        ..wnnnnnnw..
        .wnnnnwnnnw.
        .wnnnnnnnnw.
        wnnnwnnnnnNw
        wnnnnnnnnNNw
        wwwwwwwwwwww
    """)
    I["lightbulb"] = G("""
        ...aaaa...
        ..aaaaaa..
        .aayyaaaa.
        .ayyaaaaA.
        .aaaaaaaA.
        .aaaaaaaA.
        ..aaaaaA..
        ...aaaA...
        ...tttt...
        ...SSSS...
        ...tttt...
        ....SS....
    """)
    I["brain"] = G("""
        ...pppOppp...
        .ppPppOppPpp.
        .pPpppOpppPp.
        ppppPpOpPpppp
        pPppppOppppPp
        pppPppOppPppp
        pPppppOppppPp
        ppppPpOpPpppp
        .pPpppOpppPp.
        .pppPpOpPppp.
        ...pppOppp...
    """)
    I["palette"] = G("""
        ...vvvvvv...
        .vvvRRvvvvv.
        vvvvRRvvnnvv
        vbbvvvvvnnvv
        vbbvv..vvvvv
        vvvvv..vvaav
        vvvvvvvvvaav
        .vwwvvvvvvU.
        ..wwvvvvUU..
        ....UUUU....
    """)

    # pr-patrol ------------------------------------------------------------------------------------------------
    I["ci"] = [(gear(14), 1, 1), (PLAY_S, 6, 4)]
    I["reviewer"] = [(DOC, 1, 1), (MAG_S, 8, 8)]
    repo = G("""
        Sbbbbbbbbbb
        SbbbbbbbbbB
        SbbwbbbwbbB
        SbbwbbbwbbB
        SbbbwbwbbbB
        SbbbbwbbbbB
        SbbbbwbbbbB
        SbbbbwbbbbB
        SbbbbbbbbbB
        SwwwwwwwwwB
        SSSaaSSSSSS
        ...aa......
        ...aa......
    """)
    I["github"] = repo
    I["you"] = [(person("k", "K"), 1, 2), (EXCLAM, 13, 2)]
    I["queue"] = G("""
        aaaaaaaaaaaa
        AAAAAAAAAAAA
        ............
        cccccccccc..
        CCCCCCCCCC..
        ............
        cccccccc....
        CCCCCCCC....
        ............
        cccccc......
        CCCCCC......
    """)
    I["fix"] = [(_wrench(), 1, 1), (_screwdriver(), 1, 1)]
    I["conflict"] = [(_conflict_arrow("a", "A"), 1, 1), (flip_h(_conflict_arrow("R", "D")), 1, 1)]
    ready = flag("n", "N")
    ready = stamp(ready, G("""
        .....w
        ....w.
        w..w..
        .ww...
    """), 4, 1)
    I["ready"] = ready
    I["spend"] = [(COIN_STACK, 2, 1), (COIN_STACK[2:], 7, 6)]

    # departments ------------------------------------------------------------------------------------------------
    easel_legs = G("""
        ..U......U..
        .U........U.
        .U........U.
        U..........U
    """)
    board = G("""
        uuuuuuuuuuuu
        uwwwwwwwwwwu
        uwwwwwwwwRwu
        uwwwwwwwRwwu
        uwwwRwwRwwwu
        uwwRwRRwwwwu
        uwRwwwwwwwwu
        uwwwwwwwwwwu
        uuuuuuuuuuuu
    """)
    I["planning"] = [(easel_legs, 2, 10), (board, 2, 1)]
    I["dev"] = G("""
        ..ssssssssss..
        ..sxxxxxxxxs..
        ..sxnnnxxxxs..
        ..sxxxnnnxxs..
        ..sxnnxxxxxs..
        ..sxxxbbxxxs..
        ..sxxxxxxxxs..
        ..ssssssssss..
        tttttttttttttt
        SSSSSSSSSSSSSS
    """)
    I["design"] = _nib()
    seal = stamp(disc(10, "n", "N"), G("""
        .....w
        ....ww
        w..ww.
        ww.w..
        .ww...
    """), 2, 2)
    tails = G("""
        bb..bb
        bb..bb
        bb..bb
        b....b
    """)
    I["qa"] = [(tails, 5, 10), (seal, 3, 1)]
    shield = G("""
        tttttttsssss
        tttttttsssss
        tttttbbsssss
        ttttbbbbssss
        tttbbttbbsss
        ttbbtttsbbss
        tbbttbbssbbs
        .ttbbbbbbss.
        .tbbttssbbs.
        ..ttttssss..
        ...tttsss...
        ....ttss....
        .....ts.....
    """)
    I["security"] = shield
    I["devsecops"] = G("""
        hhhhhhhggggg
        hhhhhhhggggg
        hhhhhxxggggg
        hhhhxxxxgggg
        hhhhxxxxgggg
        hhhhhxxggggg
        hhhhhxxggggg
        .hhhxxxxggg.
        .hhhhhhgggg.
        ..hhhhhggg..
        ...hhhggg...
        ....hhgg....
        .....hg.....
    """)
    I["operations"] = [(gear(11, 8, "t", "s", 1.3, 1.7), 1, 4), (gear(8, 6, "a", "A", 1.1, 1.6), 7, 1)]
    I["ceo"] = G("""
        ...UUUUUU...
        ..UUUUUUUU..
        ..UllllllU..
        ..lOllllOl..
        ..llllllll..
        ...llllll...
        ............
        .SSSwwwwSSS.
        SSSSwRRwSSSS
        SSSSSRRSSSSS
        SSSSSRRSSSSS
        SSSSSSSSSSSS
    """)
    I["break"] = G("""
        ..rrrrrrrrrr..
        ..rrrrrrrrrr..
        ..rrrrrrrrrr..
        rrqqqqqqqqqqrr
        rrrrrrrrrrrrrr
        rrrrrrrrrrrrrr
        qqqqqqqqqqqqqq
        .U..........U.
    """)
    I["intel"] = G("""
        .....lllll....
        kkkkklllllkkkk
        kkkkklllllkRkR
        kggkkllllkkkRk
        kgggklllllkRkR
        kggkkllllRkkkk
        kkkkklllRlkkkk
        kkkkkllRllkkkk
        kkkRklllllkggk
        kRkkklllllkggk
        kkkkklllllkkkk
        .....lllll....
    """)
    I["workbench"] = G("""
        ....kkk.......
        .ttOkkkOtt....
        .sssKKKsss..t.
        .ssssssssst.t.
        .sssssssssttt.
        .ssssssssss.t.
        ...SSSSSS...t.
        ..SSSSSSSS....
        uuuuuuuuuuuuuu
        UUUUUUUUUUUUUU
    """)
    I["camo"] = _brush()
    I["medstation"] = G("""
        .....SSSS.....
        .....S..S.....
        wSwwwwwwwwwwSw
        wwwwwwnnwwwwwe
        wwwwwwnnwwwwwe
        wwwwnnnnnnwwwe
        wwwwnnnnnnwwwe
        wwwwwwnnwwwwwe
        wwwwwwnnwwwwwe
        wwwwwwwwwwwwwe
        eeeeeeeeeeeeee
    """)
    gen_box = G("""
        SSSSSSSSSSSSSS
        gggggggggggggg
        gGGgggggggggGG
        gggggggggggggg
        gGGgggggggggGG
        gggggggggggggg
        gGGgggggggggGG
        gggggggggggggg
        gGGgggggggggGG
        gggggggggggggg
        GGGGGGGGGGGGGG
        .S..........S.
    """)
    gen_box = stamp(gen_box, G("""
        ...aa.
        ..aa..
        .aaaa.
        aaaa..
        ..aa..
        .aa...
        .a....
    """), 4, 2)
    gen_box = stamp(gen_box, G("O\nO\nO\nO\nO\nO\nO"), 3, 2)
    gen_box = stamp(gen_box, G("O\nO\nO\nO\nO\nO\nO"), 10, 2)
    I["generator"] = gen_box
    logs = G("""
        uu........uu
        Uuuu....uuuU
        ..UUuuuuUU..
        .uuuUUUUuuu.
        uuU......Uuu
    """)
    flame = G("""
        ....R.....
        ....RR....
        ...RRR..R.
        ..RRaRR.R.
        .RRRaaRRR.
        .RRaayaRRR
        RRRaayyaRR
        RRaayyyaaR
        .RRaayyaR.
    """)
    I["hideout"] = [(logs, 2, 10), (flame, 3, 1)]

    # crew ------------------------------------------------------------------------------------------------------
    def scope(x, y):
        dx, dy = x - 6.5, y - 6.5
        r = math.hypot(dx, dy)
        if r < 1.1:
            return "R"
        if 4.6 <= r <= 5.9:
            return "e"
        if (int(x) == 6 or int(y) == 6) and 2.2 <= r <= 6.4:
            return "e"
        return None

    I["scope"] = shape(13, 13, scope)
    I["wrench"] = _wrench("t", "s")
    I["medkit"] = G("""
        ...gggggg...
        .gggggggggg.
        gGGGGGGGGGGg
        gggggggggggg
        gggwwwwwwggg
        gggwwnnwwggg
        gggwnnnnwggg
        gggwnnnnwggg
        gggwwnnwwggg
        gggwwwwwwggg
        gggggggggggg
        .GGGGGGGGGG.
    """)
    bomb_body = disc(10, "S", "x")
    bomb_body = stamp(bomb_body, G("tt\nt."), 2, 2)
    fuse = G("""
        ......a.a
        .......a.
        ......a.a
        .....k...
        ....k....
        ..tt.....
        ..ts.....
    """)
    I["bomb"] = [(bomb_body, 1, 5), (fuse, 5, 1)]
    I["shield"] = G("""
        ..SSSSSS..
        .SssssssS.
        SssssssssS
        SbbbbbbbbS
        SbwbbbbbbS
        SssssssssS
        SssssssssS
        SssstsssSS
        SsssssssSS
        SssssssssS
        SssssssssS
        SsssssssSS
        .SssssssS.
        ..SSSSSS..
    """)
    # extras (scripts/pixel/extra-icon-names.json) ------------------------------------------------------------
    I["rocket"] = G("""
        .....RR.....
        ....RRRD....
        ....wwwe....
        ...wwwwee...
        ...wwSSee...
        ...wSiBSe...
        ...wSBBSe...
        ...wwSSee...
        ..RwwwweeD..
        .RRwwwweeDD.
        .RR.SSSS.DD.
        .....aa.....
        ....ayya....
        .....aa.....
    """)
    I["trophy"] = G("""
        ..aaaaaaaa..
        aaayyaaaaAaa
        a.ayaaaaaA.a
        a.ayaaaaaA.a
        .aayaaaaaAa.
        ...aaaaaAA..
        ....aaaA....
        .....aA.....
        .....aA.....
        ...aaaaAA...
        ..UUUUUUUU..
        ..UUkkkkUU..
        ..UUUUUUUU..
    """)
    I["medal"] = [
        (G("""
            RRw..wRR
            .RRwwRR.
            ..RRRR..
            ...RR...
        """), 4, 1),
        (stamp(disc(10, "a", "A"), G("""
            ..yy..
            .yaay.
            ..yy..
        """), 2, 3), 3, 5),
    ]
    I["gem"] = G("""
        ..iibbbbBB..
        .iiibbbbBBB.
        iiiibbbbBBBB
        BBBBBBBBBBBB
        .ibbbbbbbBB.
        ..ibbbbbBB..
        ...ibbbBB...
        ....ibBB....
        .....bB.....
    """)
    return I

