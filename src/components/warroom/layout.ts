import type { PixelIconName } from "../pixel/PixelIcon";

/**
 * War-room geometry in logical units (1 unit = `scale` CSS px). The scene is a bunker seen from the front:
 * wall band on top, concrete floor, the map table in the middle (one pin per open PR), five role stations
 * around it. Sprites and textures are pixel art scaled with `image-rendering: pixelated`.
 */
export const SCENE_W = 400;
export const SCENE_H = 230;
export const WALL_H = 40;
export const STRIPE_H = 4;

export const TABLE = { x: 100, y: 72, w: 200, h: 100 };
/** Where pins may stand on the map (inside the table frame). */
const MAP = { x: TABLE.x + 14, y: TABLE.y + 14, w: TABLE.w - 28, h: TABLE.h - 32 };
const PIN_COLS = 6;
const PIN_ROWS = 3;

export const AGENT_H = 34; // a 13x22 sprite at ~1.55 units per art pixel
export const AGENT_W = Math.round((AGENT_H * 13) / 22);

export type StationKey = "argus" | "patch" | "medic" | "weaver" | "gate";

export type Station = {
  key: StationKey;
  label: string;
  role: string;
  icon: PixelIconName;
  /** Top-left of the station art (64x48). */
  x: number;
  y: number;
  /** Where the agent stands when idle (feet position). */
  home: { x: number; y: number };
  /** Wall monitor for the station (64x34). */
  screen: { x: number; y: number };
};

export const STATIONS: Record<StationKey, Station> = {
  argus: {
    key: "argus",
    label: "ARGUS",
    role: "Review",
    icon: "scope",
    x: 14,
    y: 52,
    home: { x: 88, y: 100 },
    screen: { x: 12, y: 4 },
  },
  patch: {
    key: "patch",
    label: "PATCH",
    role: "Fixes",
    icon: "wrench",
    x: 14,
    y: 150,
    home: { x: 88, y: 198 },
    screen: { x: 88, y: 4 },
  },
  medic: {
    key: "medic",
    label: "MEDIC",
    role: "CI",
    icon: "medkit",
    x: 322,
    y: 52,
    home: { x: 312, y: 100 },
    screen: { x: 248, y: 4 },
  },
  weaver: {
    key: "weaver",
    label: "WEAVER",
    role: "Conflicts",
    icon: "bomb",
    x: 322,
    y: 150,
    home: { x: 312, y: 198 },
    screen: { x: 324, y: 4 },
  },
  gate: {
    key: "gate",
    label: "GATE",
    role: "Ready",
    icon: "shield",
    x: 168,
    y: 174,
    home: { x: 246, y: 214 },
    screen: { x: 168, y: 4 },
  },
};

export const STATION_BY_AGENT: Record<string, StationKey> = {
  Argus: "argus",
  Patch: "patch",
  Medic: "medic",
  Weaver: "weaver",
  Gate: "gate",
};

/** Stable pin slots: PRs keep their spot between ticks as long as the set of open PRs is unchanged. */
export function pinSlots(keys: string[]): Map<string, { x: number; y: number }> {
  const sorted = [...keys].sort();
  const out = new Map<string, { x: number; y: number }>();
  const cols = Math.min(PIN_COLS, Math.max(1, sorted.length));
  const rows = Math.min(PIN_ROWS, Math.ceil(sorted.length / cols));
  sorted.slice(0, PIN_COLS * PIN_ROWS).forEach((key, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = MAP.x + ((col + 0.5) * MAP.w) / cols;
    // stagger rows so labels do not stack into a wall
    const y = MAP.y + ((row + 0.5) * MAP.h) / rows + (col % 2 ? 4 : -4);
    out.set(key, { x: Math.round(x), y: Math.round(y) });
  });
  return out;
}

/** Where an agent stands to work on a pin: just left/right of it, feet on the table edge row. */
export function workSpot(pin: { x: number; y: number }, slotIndex: number): { x: number; y: number } {
  const side = slotIndex % 2 === 0 ? -1 : 1;
  return { x: pin.x + side * 13, y: pin.y + 18 };
}

/** Font size in CSS px for `units` at `scale`, never below what stays readable in a small window. */
export function fz(units: number, scale: number, min = 11): number {
  return Math.max(min, Math.round(units * scale));
}
