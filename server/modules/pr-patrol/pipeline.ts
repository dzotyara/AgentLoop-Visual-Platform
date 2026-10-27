import type { DatabaseSync } from "node:sqlite";
import type { PrPatrolConfig } from "./config.ts";
import type { ActionKind, StepPolicy } from "./decide.ts";

/**
 * Pipeline settings edited from the loop graph: per agent step on/off, model and max attempts, plus the
 * global agent-slot and review-round caps. Stored in SQLite and layered over the env config on every
 * tick; `null` everywhere means "use the env default" (config.ts stays the source of defaults).
 */

export const PIPELINE_STEPS = ["fix_conflict", "fix_ci", "address_feedback", "review", "fix_review"] as const;

export type StepSettings = { enabled: boolean; model: string | null; maxAttempts: number | null };

export type PipelineSettings = {
  steps: Record<ActionKind, StepSettings>;
  maxConcurrent: number | null;
  maxReviewRounds: number | null;
};

export const PIPELINE_LIMITS = {
  maxAttempts: { min: 1, max: 10 },
  maxConcurrent: { min: 1, max: 8 },
  maxReviewRounds: { min: 0, max: 30 },
} as const;

/** CLI model ids/aliases: letters first (so a value can never read as a flag), then id-ish characters. */
const MODEL_RE = /^[A-Za-z][A-Za-z0-9._:/[\]-]{0,99}$/;

export function defaultPipeline(): PipelineSettings {
  const steps = {} as Record<ActionKind, StepSettings>;
  for (const k of PIPELINE_STEPS) steps[k] = { enabled: true, model: null, maxAttempts: null };
  return { steps, maxConcurrent: null, maxReviewRounds: null };
}

export function ensurePipelineSchema(db: DatabaseSync): void {
  db.exec(`
CREATE TABLE IF NOT EXISTS pr_patrol_pipeline (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);
`);
}

/** The env config with the global overrides applied: what the loop actually runs with. */
export function effectiveConfig(cfg: PrPatrolConfig, p: PipelineSettings): PrPatrolConfig {
  return {
    ...cfg,
    maxConcurrent: p.maxConcurrent ?? cfg.maxConcurrent,
    maxReviewRounds: p.maxReviewRounds ?? cfg.maxReviewRounds,
  };
}

/** The part decide() needs: which steps run and their attempt caps. */
export function stepPolicy(p: PipelineSettings): StepPolicy {
  const out: StepPolicy = {};
  for (const k of PIPELINE_STEPS) out[k] = { enabled: p.steps[k].enabled, maxAttempts: p.steps[k].maxAttempts };
  return out;
}

export type PipelineValidation = { ok: true; value: PipelineSettings } | { ok: false; errors: string[] };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function intOrNull(v: unknown, path: string, lim: { min: number; max: number }, errors: string[]): number | null {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < lim.min || v > lim.max) {
    errors.push(`${path}: expected an integer ${lim.min}..${lim.max} or null`);
    return null;
  }
  return v;
}

/**
 * Validates a (partial) update and merges it over `base`. Unknown keys at any level are rejected, so a
 * typo never silently does nothing. Model "default", "" or null clears the override.
 */
export function mergePipelineUpdate(base: PipelineSettings, input: unknown): PipelineValidation {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["body: expected an object"] };
  const next: PipelineSettings = {
    steps: Object.fromEntries(PIPELINE_STEPS.map((k) => [k, { ...base.steps[k] }])) as PipelineSettings["steps"],
    maxConcurrent: base.maxConcurrent,
    maxReviewRounds: base.maxReviewRounds,
  };
  for (const [key, value] of Object.entries(input)) {
    if (key === "maxConcurrent") next.maxConcurrent = intOrNull(value, key, PIPELINE_LIMITS.maxConcurrent, errors);
    else if (key === "maxReviewRounds")
      next.maxReviewRounds = intOrNull(value, key, PIPELINE_LIMITS.maxReviewRounds, errors);
    else if (key === "steps") {
      if (!isRecord(value)) {
        errors.push("steps: expected an object");
        continue;
      }
      for (const [step, patch] of Object.entries(value)) {
        if (!(PIPELINE_STEPS as readonly string[]).includes(step)) {
          errors.push(`steps.${step}: unknown step`);
          continue;
        }
        if (!isRecord(patch)) {
          errors.push(`steps.${step}: expected an object`);
          continue;
        }
        const target = next.steps[step as ActionKind];
        for (const [field, v] of Object.entries(patch)) {
          const path = `steps.${step}.${field}`;
          if (field === "enabled") {
            if (typeof v === "boolean") target.enabled = v;
            else errors.push(`${path}: expected a boolean`);
          } else if (field === "model") {
            if (v === null || v === "" || v === "default") target.model = null;
            else if (typeof v === "string" && MODEL_RE.test(v.trim())) target.model = v.trim();
            else errors.push(`${path}: expected a Claude model id, "default" or null`);
          } else if (field === "maxAttempts") {
            target.maxAttempts = intOrNull(v, path, PIPELINE_LIMITS.maxAttempts, errors);
          } else errors.push(`${path}: unknown key`);
        }
      }
    } else errors.push(`${key}: unknown key`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: next };
}

export function createPipelineStore(db: DatabaseSync, nowMs: () => number) {
  /** Stored settings over the defaults; a malformed row falls back to defaults for that entry. */
  function get(): PipelineSettings {
    const p = defaultPipeline();
    const rows = db.prepare("SELECT key, value_json FROM pr_patrol_pipeline").all() as Array<{
      key: string;
      value_json: string;
    }>;
    for (const row of rows) {
      let value: unknown;
      try {
        value = JSON.parse(row.value_json);
      } catch {
        continue;
      }
      const patch = row.key === "global" ? value : { steps: { [row.key]: value } };
      const merged = mergePipelineUpdate(p, patch);
      if (merged.ok) Object.assign(p, merged.value);
    }
    return p;
  }

  function save(p: PipelineSettings): void {
    const t = nowMs();
    const upsert = db.prepare(
      `INSERT INTO pr_patrol_pipeline (key, value_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    );
    db.exec("BEGIN");
    try {
      for (const k of PIPELINE_STEPS) upsert.run(k, JSON.stringify(p.steps[k]), t);
      upsert.run("global", JSON.stringify({ maxConcurrent: p.maxConcurrent, maxReviewRounds: p.maxReviewRounds }), t);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }

  return { get, save };
}

export type PipelineStore = ReturnType<typeof createPipelineStore>;

type Res = { status(code: number): Res; json(v: unknown): void };
type RouteApp = {
  get(path: string, h: (req: unknown, res: Res) => void): unknown;
  put(path: string, h: (req: { body?: unknown }, res: Res) => void): unknown;
};

/** GET/PUT /api/pr-patrol/pipeline. `defaults` are the env values each `null` falls back to. */
export function registerPipelineRoutes(app: RouteApp, pipeline: PipelineStore, cfg: PrPatrolConfig): void {
  const defaults = {
    maxConcurrent: cfg.maxConcurrent,
    maxAttempts: cfg.maxAttempts,
    maxReviewRounds: cfg.maxReviewRounds,
    model: cfg.model ?? null,
    review: cfg.review,
  };
  app.get("/api/pr-patrol/pipeline", (_req, res) => res.json({ pipeline: pipeline.get(), defaults }));
  app.put("/api/pr-patrol/pipeline", (req, res) => {
    const merged = mergePipelineUpdate(pipeline.get(), req.body);
    if (!merged.ok) {
      res.status(400).json({ ok: false, error: "invalid_pipeline", details: merged.errors });
      return;
    }
    pipeline.save(merged.value);
    res.json({ pipeline: merged.value, defaults });
  });
}
