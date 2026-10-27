import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guard: the UI shows pixel icons (PixelIcon), never emoji. Fails with file:line for every
 * emoji in src/**\/*.{ts,tsx} (tests excluded), including emoji smuggled in as HTML entities
 * (&#x1F4CB;) or JS escapes (\u{1F4CB}, 📋). emoji-to-icon.ts is the one file allowed
 * to spell legacy emoji, as escapes, because it maps database values to icon names.
 */

// Pictographs, misc symbols, dingbats, arrows/shapes blocks, plus the emoji-presentation
// clock/media glyphs in U+23xx (watch, hourglass, stopwatch, play/pause/stop...).
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{231A}\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}]\u{FE0F}?/u;

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ESCAPE_ALLOWED = new Set([path.join("components", "pixel", "emoji-to-icon.ts")]);

function decodeEscapes(line: string): string {
  return line
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/\\u\{([0-9a-f]+)\}/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/\\u([0-9a-f]{4})\\u([0-9a-f]{4})/gi, (_, hi: string, lo: string) =>
      String.fromCharCode(parseInt(hi, 16), parseInt(lo, 16)),
    )
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("no emoji in the UI source", () => {
  it("src/**/*.{ts,tsx} contains no emoji (use PixelIcon)", () => {
    const hits: string[] = [];
    for (const file of sourceFiles(SRC_DIR)) {
      const rel = path.relative(SRC_DIR, file);
      const checkEscapes = !ESCAPE_ALLOWED.has(rel);
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, idx) => {
          const match = line.match(EMOJI) ?? (checkEscapes ? decodeEscapes(line).match(EMOJI) : null);
          if (match) hits.push(`src/${rel}:${idx + 1}  ${match[0]}  ${line.trim().slice(0, 80)}`);
        });
    }
    expect(hits, `emoji found; render a PixelIcon instead:\n${hits.join("\n")}`).toEqual([]);
  });
});
