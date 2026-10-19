import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { HedraClient, AssetMirror } from "@explainer/hedra";
import type { ProgressEvent, Stage } from "@explainer/schemas";
import { OpenAILLM, type LLM } from "./providers/llm.js";
import { AnthropicLLM, claudeModel } from "./providers/anthropic.js";
import { ExaSearch, type Search } from "./providers/search.js";
import { FallbackAligner, HttpAligner, OpenAIAligner, type Aligner } from "./providers/alignment.js";
import type { ArtifactStore } from "./providers/store.js";
import type { FrameSampler } from "./providers/frames.js";
import { HttpAnimator, type Animator } from "./providers/animator.js";

export interface HouseStyle {
  name: string;
  styleText: string;
  backgrounds: Record<"dark" | "light", { hex: string; use: string }>;
  palette: { ink: string; accents: string[] };
  referenceFrames: Record<"dark" | "light", { assetId: string; subject: string }>;
  voice: {
    model: string;
    voiceId: string;
    speed: number;
    deeperSpeed: number;
    wordsPerMinute: number;
    fallbackModel: string;
  };
  models: Record<string, string[]>;
  clip: { defaultDurationMs: number; maxDurationMs: number; resolution: string; animatedStillResolution: string };
}

export function loadHouseStyle(path?: string): HouseStyle {
  const here = dirname(fileURLToPath(import.meta.url));
  const p = path ?? resolve(here, "../../../config/house-style.json");
  return JSON.parse(readFileSync(p, "utf8")) as HouseStyle;
}

/** Everything a stage needs. Built once per process; swapped in tests. */
export interface Ctx {
  llm: LLM;
  search: Search;
  hedra: HedraClient;
  mirror: AssetMirror;
  aligner: Aligner;
  frames: FrameSampler;
  animator: Animator;
  store: ArtifactStore;
  style: HouseStyle;
  /** ANIMATION_AUTHOR=model: the language model writes each Illustrated motion scene's animation (template as the fallback). */
  modelAnimation?: boolean;
  now(): string;
}

/** Whether the language model writes the Illustrated animation itself (ANIMATION_AUTHOR=model) rather than filling the templates. */
export function modelWritesAnimation(env: NodeJS.ProcessEnv = process.env): boolean {
  return /^(model|claude|on|1|true|yes)$/i.test((env.ANIMATION_AUTHOR ?? "").trim());
}

export function makeProgress(ctx: Ctx, projectId: string, stage: Stage) {
  return (message: string, fraction: number, preview?: ProgressEvent["preview"]) =>
    ctx.store.progress({ projectId, stage, message, fraction, preview, at: ctx.now() });
}

/**
 * Longest video we make, in seconds: MAX_VIDEO_SECONDS, default 3 minutes. Research
 * that would need longer is condensed to fit, which also bounds Hedra spend per video.
 */
export function maxVideoSeconds(): number {
  const v = Number(process.env.MAX_VIDEO_SECONDS);
  return Number.isFinite(v) && v >= 60 ? Math.min(480, Math.floor(v)) : 180;
}

/** Which language model runs the pipeline: Claude when an Anthropic key is set (or LLM_PROVIDER says so), else OpenAI. */
export function llmProvider(env: NodeJS.ProcessEnv = process.env): "anthropic" | "openai" {
  const chosen = env.LLM_PROVIDER?.toLowerCase();
  if (chosen === "anthropic" || chosen === "openai") return chosen;
  return env.ANTHROPIC_API_KEY ? "anthropic" : "openai";
}

/** The model the pipeline writes with, for the setup page and logs. */
export function llmModelName(env: NodeJS.ProcessEnv = process.env): string {
  return llmProvider(env) === "anthropic" ? claudeModel(env.LLM_MODEL) : env.LLM_MODEL || "gpt-6.1-sol";
}

export function ctxFromEnv(store: ArtifactStore, frames: FrameSampler): Ctx {
  const env = process.env;
  const need = (k: string) => {
    const v = env[k];
    if (!v) throw new Error(`${k} is not set`);
    return v;
  };
  const provider = llmProvider(env);
  // Word timing for captions is transcription, which stays with OpenAI (whisper); without that key it is estimated.
  const noTranscription: Aligner = { align: async () => { throw new Error("OPENAI_API_KEY is not set, so the narration is not transcribed"); } };
  return {
    llm: provider === "anthropic" ? new AnthropicLLM(need("ANTHROPIC_API_KEY")) : new OpenAILLM(need("OPENAI_API_KEY")),
    search: new ExaSearch(need("EXA_API_KEY")),
    hedra: new HedraClient({ apiKey: need("HEDRA_API_KEY"), baseUrl: env.HEDRA_API_BASE, webhookUrl: env.HEDRA_WEBHOOK_URL }),
    mirror: new AssetMirror({
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION ?? "us-east-1",
      bucket: need("S3_BUCKET"),
      accessKeyId: need("S3_ACCESS_KEY_ID"),
      secretAccessKey: need("S3_SECRET_ACCESS_KEY"),
      publicBase: need("ASSETS_PUBLIC_BASE"),
    }),
    // Word timing for captions and cues: a WhisperX-class service if configured, else OpenAI's
    // transcription (same key), else estimated from the text.
    aligner: new FallbackAligner(env.ALIGNMENT_URL ? new HttpAligner(env.ALIGNMENT_URL) : env.OPENAI_API_KEY ? new OpenAIAligner(env.OPENAI_API_KEY) : noTranscription, (why) => console.warn(`[align] estimated word timing: ${why}`)),
    frames,
    // The Remotion sandbox (THREE_URL) renders 3D scenes and, when the operator opts in, model-written flat animation.
    animator: new HttpAnimator({ manim: env.MANIM_URL || undefined, three: env.THREE_URL || undefined, motion: env.THREE_URL || undefined }),
    modelAnimation: modelWritesAnimation(env),
    store,
    style: loadHouseStyle(),
    now: () => new Date().toISOString(),
  };
}
