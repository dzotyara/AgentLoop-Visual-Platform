import { Container, Graphics } from "pixi.js";
import type { MutableRefObject } from "react";
import type { RoomTheme, WallClockVisual } from "./model";
import { blendColor, drawAmbientGlow, drawBandGradient, drawWallClock, hashStr } from "./drawing-core";

/* ================================================================== */
/*  Tarkov decor: procedural military props for the "tarkov" office   */
/*  pack. Colors are fixed regardless of light/dark mode, like other  */
/*  pack palettes. Only called when decorStyle === "tarkov".          */
/* ================================================================== */

const TARKOV_PALETTE = {
  concrete: 0x2b2a25,
  concreteLight: 0x3a3830,
  concreteDark: 0x1d1c18,
  crack: 0x14130f,
  rust: 0x8a4a24,
  olive: 0x4b5130,
  oliveDark: 0x363b22,
  oliveLight: 0x6a7044,
  khaki: 0xa89a6a,
  khakiDark: 0x7f7450,
  wood: 0x7a5a34,
  woodDark: 0x553d22,
  woodLight: 0x9a7444,
  metal: 0x5d625a,
  metalDark: 0x3c403a,
  metalLight: 0x7c8278,
  stencil: 0xd8cfa8,
  hazard: 0xc9a43c,
  ink: 0x14130f,
  lamp: 0xffb45a,
  textLight: 0xe2d8b4,
  textMuted: 0xa89a6a,
};

const T = TARKOV_PALETTE;

/** Concrete bunker backdrop with cracks and rust stains (replaces the cream office background). */
function drawConcreteBackdrop(g: Graphics, w: number, h: number): void {
  g.roundRect(0, 0, w, h, 6).fill(T.concrete);
  drawBandGradient(g, 2, 2, w - 4, h - 4, T.concreteLight, T.concreteDark, 14, 0.7);
  for (let i = 0; i < 9; i++) {
    const sx = 20 + ((i * 173) % Math.max(40, w - 40));
    const sy = 20 + ((i * 251) % Math.max(40, h - 40));
    g.ellipse(sx, sy, 10 + (i % 4) * 5, 5 + (i % 3) * 3).fill({ color: T.rust, alpha: 0.06 });
  }
  for (let i = 0; i < 7; i++) {
    let cx = 16 + ((i * 211) % Math.max(32, w - 32));
    let cy = 16 + ((i * 137) % Math.max(32, h - 32));
    g.moveTo(cx, cy);
    for (let s = 0; s < 4; s++) {
      cx += ((i + s) % 2 === 0 ? 1 : -1) * (4 + ((i * 3 + s) % 5));
      cy += 5 + ((i + s * 2) % 4);
      g.lineTo(cx, cy);
    }
    g.stroke({ width: 0.6, color: T.crack, alpha: 0.35 });
  }
  for (let i = 0; i < 26; i++) {
    const sx = 10 + ((i * 97) % Math.max(20, w - 20));
    const sy = 10 + ((i * 131) % Math.max(20, h - 20));
    g.circle(sx, sy, i % 3 === 0 ? 1.1 : 0.7).fill({ color: T.khaki, alpha: 0.06 });
  }
  g.roundRect(2, 2, w - 4, h - 4, 5).stroke({ width: 1.5, color: T.metalDark, alpha: 0.6 });
  g.roundRect(0, 0, w, h, 6).stroke({ width: 3, color: T.concreteDark });
}

/** Yellow/black diagonal hazard band. */
function drawHazardStripe(g: Graphics, x: number, y: number, w: number, h: number): void {
  g.rect(x, y, w, h).fill({ color: T.ink, alpha: 0.85 });
  for (let sx = x + 1; sx < x + w - 1; sx += 8) {
    g.moveTo(sx, y + h)
      .lineTo(Math.min(sx + h, x + w - 1), y)
      .stroke({ width: 3, color: T.hazard, alpha: 0.8 });
  }
}

/** Olive ammo crate with battens, latches and stencil marks. */
function drawAmmoCrate(parent: Container, x: number, y: number, w: number = 22, h: number = 12): Graphics {
  const g = new Graphics();
  g.rect(x + 1, y + h, w, 1.5).fill({ color: 0x000000, alpha: 0.25 });
  g.roundRect(x, y, w, h, 1).fill(T.olive);
  g.rect(x, y, w, 2).fill(T.oliveLight);
  g.rect(x, y + h - 1.5, w, 1.5).fill(T.oliveDark);
  g.rect(x + 1.5, y + 1, 2, h - 2).fill(T.oliveDark);
  g.rect(x + w - 3.5, y + 1, 2, h - 2).fill(T.oliveDark);
  g.rect(x + w / 2 - 4, y + 1.5, 2, 2.5).fill(T.metalLight);
  g.rect(x + w / 2 + 2, y + 1.5, 2, 2.5).fill(T.metalLight);
  g.rect(x + 6, y + h / 2 - 0.5, w - 12, 1).fill({ color: T.stencil, alpha: 0.75 });
  g.rect(x + 6, y + h / 2 + 2, (w - 12) * 0.6, 1).fill({ color: T.stencil, alpha: 0.55 });
  parent.addChild(g);
  return g;
}

/** Plank supply crate with an X brace and a stencil arrow. */
function drawSupplyCrate(parent: Container, x: number, y: number, s: number = 16): Graphics {
  const g = new Graphics();
  g.rect(x + 1, y + s, s, 1.5).fill({ color: 0x000000, alpha: 0.25 });
  g.rect(x, y, s, s).fill(T.wood);
  for (let i = 1; i < 4; i++) {
    g.rect(x, y + (s / 4) * i - 0.3, s, 0.6).fill({ color: T.woodDark, alpha: 0.6 });
  }
  g.rect(x, y, s, s).stroke({ width: 1.4, color: T.woodDark });
  g.moveTo(x + 1, y + 1)
    .lineTo(x + s - 1, y + s - 1)
    .stroke({ width: 1.4, color: T.woodLight, alpha: 0.8 });
  g.moveTo(x + s / 2, y + 3)
    .lineTo(x + s / 2 + 2.5, y + 6)
    .lineTo(x + s / 2 - 2.5, y + 6)
    .fill({ color: T.ink, alpha: 0.55 });
  parent.addChild(g);
  return g;
}

/** Stacked sandbags in a staggered brick pattern. */
function drawSandbags(parent: Container, x: number, y: number, cols: number = 3, rows: number = 2): Graphics {
  const g = new Graphics();
  const bagW = 10;
  const bagH = 5;
  g.ellipse(x + (cols * bagW) / 2, y + rows * bagH + 1, (cols * bagW) / 2 + 2, 2).fill({ color: 0x000000, alpha: 0.2 });
  for (let r = rows - 1; r >= 0; r--) {
    const rowCols = r === rows - 1 ? cols : cols - 1;
    const offset = r === rows - 1 ? 0 : bagW / 2;
    for (let c = 0; c < rowCols; c++) {
      const bx = x + offset + c * bagW;
      const by = y + (rows - 1 - r) * bagH;
      const tone = blendColor(T.khaki, T.khakiDark, ((r * 3 + c) % 3) * 0.3);
      g.roundRect(bx, by, bagW - 0.5, bagH, 2).fill(tone);
      g.roundRect(bx, by, bagW - 0.5, bagH, 2).stroke({ width: 0.4, color: T.ink, alpha: 0.35 });
      g.moveTo(bx + 1.5, by + bagH / 2)
        .lineTo(bx + bagW - 2, by + bagH / 2)
        .stroke({ width: 0.3, color: T.ink, alpha: 0.25 });
    }
  }
  parent.addChild(g);
  return g;
}

/** Drooping camo netting along a wall: scalloped cord with leaf blobs. */
function drawCamoNet(parent: Container, x: number, y: number, w: number, seed: number = 0): Graphics {
  const g = new Graphics();
  const span = 24;
  const sag = (px: number) => y + Math.sin(((px - x) / span) * Math.PI) ** 2 * 4;
  g.moveTo(x, y);
  for (let px = x; px <= x + w; px += 3) g.lineTo(px, sag(px));
  g.stroke({ width: 0.8, color: T.ink, alpha: 0.5 });
  const leafColors = [T.olive, T.oliveDark, T.khakiDark, 0x5a4a2e, T.oliveLight];
  for (let px = x + 2, i = 0; px < x + w - 2; px += 4, i++) {
    const h = hashStr(`${seed}:${i}`);
    const ly = sag(px) + (h % 3) - 0.5;
    g.ellipse(px, ly, 2.4 + (h % 2), 1.6 + ((h >> 2) % 2) * 0.6).fill({
      color: leafColors[h % leafColors.length],
      alpha: 0.88,
    });
    if (h % 4 === 0) {
      g.rect(px - 0.5, ly + 1, 1, 3 + (h % 3)).fill({ color: leafColors[(h >> 3) % leafColors.length], alpha: 0.7 });
    }
  }
  parent.addChild(g);
  return g;
}

/** Jerry can with embossed X and a three-slot handle. */
function drawJerryCan(parent: Container, x: number, y: number, color: number = 0x7d2f1f): Graphics {
  const g = new Graphics();
  g.ellipse(x + 5, y + 13.5, 6, 1.5).fill({ color: 0x000000, alpha: 0.25 });
  g.roundRect(x, y, 10, 13, 1.5).fill(color);
  g.roundRect(x, y, 10, 13, 1.5).stroke({ width: 0.5, color: blendColor(color, 0x000000, 0.4) });
  g.moveTo(x + 2, y + 4)
    .lineTo(x + 8, y + 11)
    .moveTo(x + 8, y + 4)
    .lineTo(x + 2, y + 11)
    .stroke({ width: 0.8, color: blendColor(color, 0xffffff, 0.2), alpha: 0.6 });
  g.rect(x + 1, y - 2, 6, 2).fill(blendColor(color, 0x000000, 0.25));
  g.rect(x + 2, y - 1.5, 1, 1).fill(T.ink);
  g.rect(x + 4, y - 1.5, 1, 1).fill(T.ink);
  g.rect(x + 7.5, y - 2.5, 2, 2.5).fill(T.metal);
  parent.addChild(g);
  return g;
}

/** Field radio with knobs, grille and a blinking status LED. */
function drawFieldRadio(parent: Container, x: number, y: number): Container {
  const radio = new Container();
  const g = new Graphics();
  g.rect(x + 1, y + 10, 16, 1.2).fill({ color: 0x000000, alpha: 0.25 });
  g.roundRect(x, y, 16, 10, 1).fill(T.olive);
  g.roundRect(x + 1, y + 1, 9, 8, 0.5).fill(T.oliveDark);
  for (let i = 0; i < 3; i++) {
    g.rect(x + 2, y + 2.5 + i * 2, 7, 0.6).fill({ color: T.ink, alpha: 0.6 });
  }
  g.circle(x + 12.5, y + 3, 1.6).fill(T.metalDark);
  g.circle(x + 12.5, y + 7, 1.2).fill(T.metalDark);
  g.moveTo(x + 14, y)
    .lineTo(x + 15.5, y - 10)
    .stroke({ width: 0.6, color: T.metalLight });
  radio.addChild(g);
  const led = new Graphics();
  led.circle(x + 10.8, y + 1.6, 0.7).fill(0xff4433);
  led.onRender = () => {
    led.alpha = Math.floor(performance.now() / 600) % 2 === 0 ? 1 : 0.2;
  };
  radio.addChild(led);
  parent.addChild(radio);
  return radio;
}

/** Folding canvas cot with a rolled blanket. Footprint matches the default sofa (y-10..y+18). */
function drawCot(parent: Container, x: number, y: number, w: number = 80): Graphics {
  const g = new Graphics();
  g.ellipse(x + w / 2, y + 18, w / 2 + 4, 4).fill({ color: 0x000000, alpha: 0.18 });
  for (const lx of [x + 4, x + w - 6]) {
    g.moveTo(lx, y + 4)
      .lineTo(lx + 2, y + 17)
      .moveTo(lx + 2, y + 4)
      .lineTo(lx, y + 17)
      .stroke({ width: 1, color: T.metalDark });
  }
  g.roundRect(x, y - 2, w, 9, 2).fill(T.olive);
  g.roundRect(x, y - 2, w, 9, 2).stroke({ width: 0.6, color: T.oliveDark });
  g.rect(x + 2, y - 2, w - 4, 1).fill({ color: T.oliveLight, alpha: 0.6 });
  g.roundRect(x + 2, y - 8, 14, 7, 3).fill(T.khaki);
  g.roundRect(x + w - 24, y - 6, 20, 6, 3).fill(T.khakiDark);
  g.moveTo(x + w - 18, y - 6)
    .lineTo(x + w - 18, y)
    .moveTo(x + w - 11, y - 6)
    .lineTo(x + w - 11, y)
    .stroke({ width: 0.5, color: T.ink, alpha: 0.35 });
  parent.addChild(g);
  return g;
}

/** Bench made of planks resting on two ammo crates (same footprint as the sofa it replaces). */
function drawCrateBench(parent: Container, x: number, y: number, w: number = 80): void {
  drawAmmoCrate(parent, x + 2, y + 4, 18, 12);
  drawAmmoCrate(parent, x + w - 20, y + 4, 18, 12);
  const g = new Graphics();
  g.rect(x - 2, y - 1, w + 4, 5).fill(T.wood);
  g.rect(x - 2, y - 1, w + 4, 1.2).fill({ color: T.woodLight, alpha: 0.7 });
  g.rect(x - 2, y + 3, w + 4, 1).fill({ color: T.woodDark, alpha: 0.8 });
  g.roundRect(x + 30, y - 6, 16, 5, 2).fill(T.khakiDark);
  parent.addChild(g);
}

/**
 * Bare bulb on a cord. The glow flickers via onRender, so it stops on its own when the
 * scene is rebuilt and the node is destroyed.
 */
function drawFlickerBulb(parent: Container, x: number, y: number, glowColor: number, seed: number = 0): Container {
  const bulb = new Container();
  const glow = new Graphics();
  glow.ellipse(x, y + 16, 22, 7).fill({ color: glowColor, alpha: 0.06 });
  glow.ellipse(x, y + 13, 13, 4.5).fill({ color: T.lamp, alpha: 0.1 });
  glow.circle(x, y + 9, 4).fill({ color: T.lamp, alpha: 0.18 });
  bulb.addChild(glow);
  const g = new Graphics();
  g.moveTo(x, y)
    .lineTo(x, y + 5)
    .stroke({ width: 0.6, color: T.ink, alpha: 0.8 });
  g.rect(x - 1.2, y + 5, 2.4, 2).fill(T.metalDark);
  g.circle(x, y + 9, 2).fill(0xffe2a8);
  g.circle(x - 0.6, y + 8.4, 0.6).fill({ color: 0xffffff, alpha: 0.7 });
  bulb.addChild(g);
  const phase = (seed * 1.37) % 6.28;
  glow.onRender = () => {
    const t = performance.now() / 1000;
    const dip = Math.sin(t * 17 + phase) * Math.sin(t * 5.3 + phase * 2);
    glow.alpha = dip > 0.9 ? 0.3 : 0.85 + 0.15 * Math.sin(t * 2.4 + phase);
  };
  parent.addChild(bulb);
  return bulb;
}

/** Grey-green metal locker(s) with vents and rust spots. */
function drawMetalLocker(parent: Container, x: number, y: number, w: number = 14, h: number = 22): Graphics {
  const g = new Graphics();
  g.rect(x + 1.5, y + 1.5, w, h).fill({ color: 0x000000, alpha: 0.25 });
  g.rect(x, y, w, h).fill(T.metal);
  g.rect(x, y, w, h).stroke({ width: 0.6, color: T.metalDark });
  g.rect(x + 1, y + 1, w - 2, 1).fill({ color: T.metalLight, alpha: 0.6 });
  for (let i = 0; i < 3; i++) {
    g.rect(x + 2.5, y + 3 + i * 1.6, w - 5, 0.6).fill({ color: T.ink, alpha: 0.55 });
  }
  g.rect(x + w - 3.5, y + h / 2 - 1.5, 1, 3).fill(T.metalLight);
  g.circle(x + 3, y + h - 4, 1.4).fill({ color: T.rust, alpha: 0.55 });
  g.circle(x + w - 4, y + h * 0.35, 0.9).fill({ color: T.rust, alpha: 0.45 });
  parent.addChild(g);
  return g;
}

/** Dark stash crate with metal corners and a padlock. */
function drawStashCrate(parent: Container, x: number, y: number, w: number = 26, h: number = 14): Graphics {
  const g = new Graphics();
  g.rect(x + 1, y + h, w, 1.5).fill({ color: 0x000000, alpha: 0.3 });
  g.rect(x, y, w, h).fill(T.woodDark);
  g.rect(x, y, w, 3).fill(T.wood);
  g.rect(x, y + 3, w, 0.6).fill({ color: T.ink, alpha: 0.6 });
  for (const [cx, cy] of [
    [x, y],
    [x + w - 3, y],
    [x, y + h - 3],
    [x + w - 3, y + h - 3],
  ]) {
    g.rect(cx, cy, 3, 3).fill(T.metalLight);
  }
  g.roundRect(x + w / 2 - 2, y + 4, 4, 4, 0.8).fill(T.hazard);
  g.moveTo(x + w / 2 - 1.2, y + 4)
    .arc(x + w / 2, y + 4, 1.2, Math.PI, 0)
    .stroke({ width: 0.6, color: T.metalLight });
  parent.addChild(g);
  return g;
}

/** Map board with contour lines, pins and a route string. */
function drawTacticalMap(parent: Container, x: number, y: number, w: number = 38, h: number = 22): Graphics {
  const g = new Graphics();
  g.rect(x + 1.5, y + 1.5, w, h).fill({ color: 0x000000, alpha: 0.25 });
  g.rect(x, y, w, h).fill(T.woodDark);
  g.rect(x + 1.5, y + 1.5, w - 3, h - 3).fill(0x8b8a5e);
  g.ellipse(x + w * 0.35, y + h * 0.5, w * 0.18, h * 0.25).stroke({ width: 0.4, color: T.oliveDark, alpha: 0.7 });
  g.ellipse(x + w * 0.35, y + h * 0.5, w * 0.1, h * 0.14).stroke({ width: 0.4, color: T.oliveDark, alpha: 0.7 });
  g.moveTo(x + 2, y + h * 0.75)
    .quadraticCurveTo(x + w * 0.5, y + h * 0.55, x + w - 2, y + h * 0.85)
    .stroke({ width: 0.8, color: 0x5d7480, alpha: 0.8 });
  const pins = [
    [x + w * 0.25, y + h * 0.3],
    [x + w * 0.6, y + h * 0.45],
    [x + w * 0.8, y + h * 0.25],
  ];
  g.moveTo(pins[0][0], pins[0][1]);
  for (const [px, py] of pins.slice(1)) g.lineTo(px, py);
  g.stroke({ width: 0.4, color: 0xb03a2e, alpha: 0.85 });
  for (const [px, py] of pins) g.circle(px, py, 0.9).fill(0xd8463a);
  g.moveTo(x + w * 0.7, y + h * 0.62)
    .lineTo(x + w * 0.78, y + h * 0.74)
    .moveTo(x + w * 0.78, y + h * 0.62)
    .lineTo(x + w * 0.7, y + h * 0.74)
    .stroke({ width: 0.6, color: T.ink, alpha: 0.8 });
  parent.addChild(g);
  return g;
}

/** Window boarded up with nailed planks. */
function drawBoardedWindow(parent: Container, x: number, y: number, w: number = 24, h: number = 18): Graphics {
  const g = new Graphics();
  g.rect(x - 1, y - 1, w + 2, h + 2).fill(T.concreteDark);
  g.rect(x, y, w, h).fill(0x1a1e1c);
  g.rect(x + 1, y + 1, w - 2, h / 2).fill({ color: 0x3a4a52, alpha: 0.25 });
  for (const [y0, y1] of [
    [y + 3, y + h - 6],
    [y + h - 4, y + 5],
  ]) {
    g.moveTo(x - 1, y0)
      .lineTo(x + w + 1, y1)
      .stroke({ width: 3, color: T.wood });
    g.circle(x + 1.5, y0 + (y1 - y0) * 0.06, 0.5).fill(T.metalLight);
    g.circle(x + w - 1.5, y1 - (y1 - y0) * 0.06, 0.5).fill(T.metalLight);
  }
  parent.addChild(g);
  return g;
}

/** Small metal plate with a hazard triangle. */
function drawWarningSign(parent: Container, x: number, y: number): Graphics {
  const g = new Graphics();
  g.rect(x, y, 14, 11).fill(T.metal);
  g.rect(x, y, 14, 11).stroke({ width: 0.5, color: T.metalDark });
  g.moveTo(x + 7, y + 1.5)
    .lineTo(x + 12.5, y + 9.5)
    .lineTo(x + 1.5, y + 9.5)
    .fill(T.hazard);
  g.rect(x + 6.5, y + 4, 1, 3).fill(T.ink);
  g.rect(x + 6.5, y + 7.8, 1, 1).fill(T.ink);
  parent.addChild(g);
  return g;
}

/** Rusty barrel stove with a flickering fire (warm hideout light source). */
function drawBarrelStove(parent: Container, x: number, y: number): Container {
  const stove = new Container();
  const glow = drawAmbientGlow(stove, x + 10, y + 6, 30, T.lamp, 0.16);
  const g = new Graphics();
  g.ellipse(x + 10, y + 30, 12, 3).fill({ color: 0x000000, alpha: 0.25 });
  g.roundRect(x + 1, y + 6, 18, 24, 2).fill(T.rust);
  g.rect(x + 1, y + 12, 18, 1.2).fill({ color: T.ink, alpha: 0.5 });
  g.rect(x + 1, y + 22, 18, 1.2).fill({ color: T.ink, alpha: 0.5 });
  g.rect(x + 3, y + 7, 2, 22).fill({ color: 0xc07040, alpha: 0.35 });
  g.ellipse(x + 10, y + 6, 9, 2.5).fill(T.ink);
  stove.addChild(g);
  const fire = new Graphics();
  fire
    .moveTo(x + 4, y + 6)
    .lineTo(x + 7, y - 2)
    .lineTo(x + 10, y + 5)
    .lineTo(x + 13, y - 4)
    .lineTo(x + 16, y + 6)
    .fill(0xe0702a);
  fire
    .moveTo(x + 7, y + 6)
    .lineTo(x + 10, y)
    .lineTo(x + 13, y + 6)
    .fill(0xffc24a);
  stove.addChild(fire);
  fire.onRender = () => {
    const t = performance.now() / 1000;
    fire.alpha = 0.8 + 0.2 * Math.sin(t * 11) * Math.sin(t * 4.1);
    glow.alpha = 0.85 + 0.15 * Math.sin(t * 6.3);
  };
  parent.addChild(stove);
  return stove;
}

/** Metal field desk with a rugged laptop and a radio (CEO desk footprint: 64x34). */
function drawCommandDesk(parent: Container, x: number, y: number): void {
  const g = new Graphics();
  g.rect(x + 2, y + 34, 62, 2).fill({ color: 0x000000, alpha: 0.3 });
  g.roundRect(x, y, 64, 34, 2).fill(T.metalDark);
  g.roundRect(x + 1, y + 1, 62, 32, 1.5).fill(T.metal);
  g.rect(x + 1, y + 1, 62, 1).fill({ color: T.metalLight, alpha: 0.6 });
  g.roundRect(x + 19, y + 2, 26, 16, 1.5).fill(T.oliveDark);
  g.roundRect(x + 20.5, y + 3.5, 23, 12, 1).fill(0x1e3a22);
  for (let i = 0; i < 3; i++) {
    g.rect(x + 22.5, y + 6 + i * 3, 10 + ((i * 7) % 9), 0.8).fill({ color: 0x7ee08a, alpha: 0.7 });
  }
  g.roundRect(x + 22, y + 24, 20, 7, 1).fill(T.khaki);
  g.rect(x + 4, y + 20, 12, 9).fill({ color: 0x8b8a5e, alpha: 0.9 });
  g.rect(x + 4, y + 20, 12, 9).stroke({ width: 0.4, color: T.ink, alpha: 0.5 });
  parent.addChild(g);
  drawFieldRadio(parent, x + 46, y + 4);
}

/** Department room decor for the tarkov pack (replaces the default ceiling/wall/corner props). */
function drawTarkovDepartmentDecor(
  room: Container,
  rx: number,
  ry: number,
  roomW: number,
  roomH: number,
  theme: Pick<RoomTheme, "accent" | "wall">,
  deptIdx: number,
  wallClocksRef: MutableRefObject<WallClockVisual[]>,
): void {
  drawFlickerBulb(room, rx + roomW / 2, ry + 2, theme.accent, deptIdx);
  drawAmbientGlow(room, rx + roomW / 2, ry + roomH / 2, roomW * 0.4, T.lamp, 0.035);
  drawCamoNet(room, rx + 12, ry + 16, roomW - 24, deptIdx);

  drawTacticalMap(room, rx + roomW - 48, ry + 18);
  drawMetalLocker(room, rx + 6, ry + 14, 13, 22);
  drawMetalLocker(room, rx + 20, ry + 14, 13, 22);
  wallClocksRef.current.push(drawWallClock(room, rx + roomW - 16, ry + 12));
  drawBoardedWindow(room, rx + roomW / 2 - 12, ry + 16);
  if (roomW > 240) {
    drawBoardedWindow(room, rx + roomW / 2 - 40, ry + 16, 20, 16);
    drawBoardedWindow(room, rx + roomW / 2 + 20, ry + 16, 20, 16);
  }
  if (roomW > 200) {
    drawWarningSign(room, rx + 40, ry + 20);
  }

  drawSandbags(room, rx + 3, ry + roomH - 18, 2, 2);
  switch (deptIdx % 3) {
    case 0:
      drawAmmoCrate(room, rx + roomW - 42, ry + roomH - 18);
      drawJerryCan(room, rx + roomW - 16, ry + roomH - 20);
      break;
    case 1:
      drawStashCrate(room, rx + roomW - 32, ry + roomH - 20);
      drawFieldRadio(room, rx + roomW - 54, ry + roomH - 16);
      break;
    default:
      drawSupplyCrate(room, rx + roomW - 22, ry + roomH - 22);
      drawSupplyCrate(room, rx + roomW - 38, ry + roomH - 18, 12);
      drawJerryCan(room, rx + roomW - 52, ry + roomH - 18, T.oliveDark);
      break;
  }
}

/** Command post (CEO zone) props: netting, bulbs, map, sandbags, crates. */
function drawTarkovCeoDecor(layer: Container, officeW: number, accent: number): void {
  drawFlickerBulb(layer, officeW * 0.3, 2, accent, 11);
  drawFlickerBulb(layer, officeW * 0.7, 2, accent, 23);
  drawCamoNet(layer, 148, 11, Math.max(120, officeW - 300), 7);
  drawTacticalMap(layer, 14, 14, 16, 12);
  drawJerryCan(layer, 24, 34);
  drawSandbags(layer, 6, 60, 2, 2);
  drawSandbags(layer, officeW - 34, 60, 3, 2);
  drawStashCrate(layer, officeW - 64, 62);
}

/** Hideout (break room) props that keep the default furniture footprints so BREAK_SPOTS still line up. */
function drawTarkovHideoutDecor(
  layer: Container,
  brx: number,
  bry: number,
  brw: number,
  brh: number,
  accent: number,
  wallClocksRef: MutableRefObject<WallClockVisual[]>,
): void {
  drawAmbientGlow(layer, brx + brw / 2, bry + brh / 2, brw * 0.3, T.lamp, 0.09);
  drawFlickerBulb(layer, brx + brw / 3, bry + 2, accent, 31);
  drawFlickerBulb(layer, brx + (brw * 2) / 3, bry + 2, accent, 47);
  drawCamoNet(layer, brx + 14, bry + 16, brw - 28, 3);

  const baseX = brx + 16;
  drawBarrelStove(layer, baseX, bry + 20);
  drawJerryCan(layer, baseX + 26, bry + 36);
  drawCrateBench(layer, baseX + 50, bry + 56);
  drawStashCrate(layer, baseX + 144, bry + 58, 28, 12);

  const rightX = brx + brw - 16;
  drawMetalLocker(layer, rightX - 26, bry + 20, 22, 30);
  drawSandbags(layer, rightX - 48, bry + 40, 2, 2);
  drawCot(layer, rightX - 120, bry + 56);
  drawSupplyCrate(layer, rightX - 170, bry + 34, 18);
  drawSupplyCrate(layer, rightX - 152, bry + 34, 18);
  drawFieldRadio(layer, rightX - 166, bry + 24);

  drawTacticalMap(layer, brx + brw / 2 - 8, bry + 14, 16, 12);
  wallClocksRef.current.push(drawWallClock(layer, brx + brw / 2 + 30, bry + 18));
  drawAmmoCrate(layer, baseX + 16, bry + brh - 16, 16, 10);
}

export {
  TARKOV_PALETTE,
  drawConcreteBackdrop,
  drawHazardStripe,
  drawAmmoCrate,
  drawSupplyCrate,
  drawSandbags,
  drawCamoNet,
  drawJerryCan,
  drawFieldRadio,
  drawCot,
  drawCrateBench,
  drawFlickerBulb,
  drawMetalLocker,
  drawStashCrate,
  drawTacticalMap,
  drawBoardedWindow,
  drawWarningSign,
  drawBarrelStove,
  drawCommandDesk,
  drawTarkovDepartmentDecor,
  drawTarkovCeoDecor,
  drawTarkovHideoutDecor,
};
