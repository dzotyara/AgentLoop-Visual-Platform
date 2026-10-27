import { Container, Graphics, Text, TextStyle } from "pixi.js";

/**
 * Small pixel glyphs drawn with Graphics for the Pixi office scene, where emoji used to be
 * rendered as Text. Each glyph is centred on (0, 0) unless noted.
 */

/** A sheet of paper with ruled lines (task / report hand-offs). `h` is the glyph height in px. */
export function createDocGlyph(h = 16): Graphics {
  const w = Math.round(h * 0.75);
  const g = new Graphics();
  g.rect(-w / 2, -h / 2, w, h).fill(0xf8f4e8).stroke({ width: 1, color: 0x5a4020 });
  g.rect(-w / 2 + 2, -h / 2 - 1, w - 4, 3).fill(0x8b6b3a);
  for (let y = -h / 2 + 5; y < h / 2 - 2; y += 3) g.rect(-w / 2 + 2, y, w - 4, 1).fill(0x9a8a70);
  return g;
}

/** A coffee mug (or a ration can for the Tarkov skin), anchored at its centre. */
export function createMugGlyph(isTarkov: boolean): Graphics {
  const g = new Graphics();
  if (isTarkov) {
    g.rect(-3, -4, 6, 8).fill(0x7a7f5a).stroke({ width: 1, color: 0x3a3d2a });
    g.rect(-3, -1, 6, 2).fill(0xc9a43c);
    return g;
  }
  g.rect(-3, -3, 6, 7).fill(0xffffff).stroke({ width: 1, color: 0x6b4a2a });
  g.rect(-2, -2, 4, 2).fill(0x6b3a1a);
  g.rect(3, -1, 2, 3).stroke({ width: 1, color: 0x6b4a2a });
  return g;
}

/** Agent initial on a disc, used when an agent has no sprite. Anchored at its bottom centre. */
export function createInitialGlyph(name: string | null | undefined, size = 24): Container {
  const r = size / 2;
  const glyph = new Container();
  const disc = new Graphics();
  disc.circle(0, -r, r).fill(0x475569).stroke({ width: 1, color: 0x1e293b });
  glyph.addChild(disc);
  const label = new Text({
    text: (name?.trim().charAt(0) || "?").toUpperCase(),
    style: new TextStyle({ fontSize: Math.round(size * 0.55), fill: 0xffffff, fontWeight: "bold" }),
  });
  label.anchor.set(0.5, 0.5);
  label.position.set(0, -r);
  glyph.addChild(label);
  return glyph;
}
