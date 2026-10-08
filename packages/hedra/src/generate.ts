/**
 * Typed generation helpers on top of HedraClient.
 *
 * Every call:
 *  - derives an idempotency key from a stable hash of (model, input), so a
 *    worker retry after a timeout recovers the original job instead of
 *    paying for a duplicate;
 *  - takes an ordered model allowlist and falls through to the next model
 *    when a model fails for a non-retryable reason (the "retry on next
 *    model" step of the QA loop);
 *  - returns the raw JobResult plus the model actually used and the cost.
 */
import { createHash } from "node:crypto";
import { HedraClient, HedraError, type JobResult, type MediaRef } from "./client.js";

export interface GenOutcome {
  model: string;
  job: JobResult;
  costUsd: number;
}

export function idemKey(scope: string, model: string, input: unknown): string {
  const h = createHash("sha256").update(JSON.stringify({ scope, model, input })).digest("hex");
  return `${scope}:${h.slice(0, 40)}`;
}

export const asset = (id: string): MediaRef => ({ source: "asset", asset_id: id });

async function withFallback(
  client: HedraClient,
  scope: string,
  models: string[],
  buildInput: (model: string) => Record<string, unknown>,
): Promise<GenOutcome> {
  let lastErr: unknown;
  for (const model of models) {
    const input = buildInput(model);
    try {
      const job = await client.run(model, input, idemKey(scope, model, input));
      return { model, job, costUsd: job.cost ?? 0 };
    } catch (e) {
      lastErr = e;
      // Retryable errors (rate limit, transient) are retried by the orchestrator,
      // not by swapping models. Non-retryable → try the next model.
      if (e instanceof HedraError && e.retryable) throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`all models failed for ${scope}`);
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export interface StillArgs {
  prompt: string;
  references: string[]; // Hedra asset ids
  aspectRatio?: "16:9" | "9:16" | "1:1";
  resolution?: string;
}

/** A still frame in the house style. gpt-image-2 by default. */
export function generateStill(client: HedraClient, scope: string, models: string[], a: StillArgs) {
  return withFallback(client, scope, models, (model) => {
    const base: Record<string, unknown> = {
      prompt: a.prompt,
      aspect_ratio: a.aspectRatio ?? "16:9",
    };
    if (a.resolution) base.resolution = a.resolution;
    if (a.references.length) base.images = a.references.map(asset);
    return base;
  });
}

// ---------------------------------------------------------------------------
// Video
// ---------------------------------------------------------------------------

export interface AnimatedStillArgs {
  prompt: string;
  startAssetId: string;
  durationMs?: 5000 | 10000;
  resolution?: string;
}

/** Set a still in motion. kling-25-turbo held frames best in the bake-off. */
export function animateStill(client: HedraClient, scope: string, models: string[], a: AnimatedStillArgs) {
  return withFallback(client, scope, models, (model) => {
    const input: Record<string, unknown> = {
      prompt: a.prompt,
      aspect_ratio: "16:9",
      duration_ms: a.durationMs ?? 5000,
      start_image: asset(a.startAssetId),
    };
    if (model.startsWith("kling")) input.resolution = a.resolution ?? "1080p";
    else {
      input.resolution = a.resolution ?? "720p";
      input.generate_audio = false;
    }
    return input;
  });
}

export interface ClipArgs {
  prompt: string;
  references: string[]; // house reference frame(s) + any character refs
  durationMs?: number;
  resolution?: string;
}

/** A new shot in the house style from reference images. wan-3-0 → minimax-h3. */
export function generateClip(client: HedraClient, scope: string, models: string[], a: ClipArgs) {
  return withFallback(client, scope, models, (model) => {
    const input: Record<string, unknown> = {
      prompt: a.prompt,
      aspect_ratio: "16:9",
      duration_ms: a.durationMs ?? 5000,
      images: a.references.map(asset),
    };
    if (model.startsWith("wan")) {
      input.resolution = a.resolution ?? "720p";
      input.generate_audio = false;
    } else if (model.startsWith("minimax")) {
      input.resolution = a.resolution ?? "768p";
    } else {
      input.resolution = a.resolution ?? "720p";
    }
    return input;
  });
}

export function upscale(client: HedraClient, scope: string, models: string[], videoAssetId: string) {
  return withFallback(client, scope, models, () => ({
    video: asset(videoAssetId),
    resolution: "1080p",
  }));
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

export interface SpeechArgs {
  text: string;
  voiceId: string;
  speed?: number;
  language?: string;
}

export function generateSpeech(client: HedraClient, scope: string, model: string, a: SpeechArgs) {
  return withFallback(client, scope, [model], () => ({
    text: a.text,
    voice_id: a.voiceId,
    speed: a.speed ?? 1.0,
    language: a.language ?? "en",
    stability: 1,
  }));
}

export function generateMusic(client: HedraClient, scope: string, models: string[], prompt: string, durationMs: number) {
  return withFallback(client, scope, models, () => ({ prompt, duration_ms: durationMs }));
}

export function generateSfx(client: HedraClient, scope: string, models: string[], prompt: string, durationMs: number) {
  return withFallback(client, scope, models, () => ({ prompt, duration_ms: durationMs }));
}
