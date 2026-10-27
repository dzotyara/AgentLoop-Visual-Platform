import express from "express";
import request from "supertest";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { PrPatrolConfig } from "./config.ts";
import {
  createPipelineStore,
  defaultPipeline,
  effectiveConfig,
  mergePipelineUpdate,
  registerPipelineRoutes,
  stepPolicy,
} from "./pipeline.ts";
import { ensurePrPatrolSchema } from "./store.ts";

const cfg = {
  maxConcurrent: 2,
  maxAttempts: 2,
  maxReviewRounds: 3,
  model: undefined,
  review: true,
} as PrPatrolConfig;

function harness() {
  const db = new DatabaseSync(":memory:");
  ensurePrPatrolSchema(db);
  const pipeline = createPipelineStore(db, () => 1_000);
  const app = express();
  app.use(express.json());
  registerPipelineRoutes(app, pipeline, cfg);
  return { db, app, pipeline };
}

describe("pipeline settings", () => {
  it("serves defaults, then persists a partial update", async () => {
    const { db, app, pipeline } = harness();
    try {
      const first = await request(app).get("/api/pr-patrol/pipeline").expect(200);
      expect(first.body.pipeline).toEqual(defaultPipeline());
      expect(first.body.defaults).toEqual({
        maxConcurrent: 2,
        maxAttempts: 2,
        maxReviewRounds: 3,
        model: null,
        review: true,
      });

      const put = await request(app)
        .put("/api/pr-patrol/pipeline")
        .send({ maxConcurrent: 4, steps: { fix_ci: { enabled: false, model: "claude-sonnet-5", maxAttempts: 3 } } })
        .expect(200);
      expect(put.body.pipeline.steps.fix_ci).toEqual({ enabled: false, model: "claude-sonnet-5", maxAttempts: 3 });
      expect(put.body.pipeline.steps.review).toEqual({ enabled: true, model: null, maxAttempts: null });

      // survives a fresh store over the same db, and "default" clears a model override
      const again = createPipelineStore(db, () => 2_000).get();
      expect(again.maxConcurrent).toBe(4);
      expect(again.steps.fix_ci.model).toBe("claude-sonnet-5");
      await request(app)
        .put("/api/pr-patrol/pipeline")
        .send({ steps: { fix_ci: { model: "default" } } })
        .expect(200);
      expect(pipeline.get().steps.fix_ci).toEqual({ enabled: false, model: null, maxAttempts: 3 });
    } finally {
      db.close();
    }
  });

  it("rejects unknown keys and out-of-range values without saving", async () => {
    const { db, app, pipeline } = harness();
    try {
      const bad = [
        { bogus: 1 },
        { steps: { merge_queue: { enabled: false } } },
        { steps: { fix_ci: { enabled: "no" } } },
        { steps: { fix_ci: { colour: "red" } } },
        { steps: { fix_ci: { maxAttempts: 0 } } },
        { steps: { fix_ci: { model: "--dangerous" } } },
        { maxConcurrent: 2.5 },
        { maxReviewRounds: -1 },
        [],
      ];
      for (const body of bad) {
        const res = await request(app).put("/api/pr-patrol/pipeline").send(body).expect(400);
        expect(res.body).toMatchObject({ ok: false, error: "invalid_pipeline" });
        expect(res.body.details.length).toBeGreaterThan(0);
      }
      expect(pipeline.get()).toEqual(defaultPipeline());
    } finally {
      db.close();
    }
  });

  it("layers overrides over the env config", () => {
    const merged = mergePipelineUpdate(defaultPipeline(), {
      maxReviewRounds: 0,
      steps: { review: { enabled: false }, fix_ci: { maxAttempts: 5 } },
    });
    expect(merged.ok).toBe(true);
    if (!merged.ok) return;
    const eff = effectiveConfig(cfg, merged.value);
    expect(eff.maxReviewRounds).toBe(0);
    expect(eff.maxConcurrent).toBe(2);
    expect(stepPolicy(merged.value)).toMatchObject({
      review: { enabled: false, maxAttempts: null },
      fix_ci: { enabled: true, maxAttempts: 5 },
    });
  });
});
