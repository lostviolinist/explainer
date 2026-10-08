/**
 * Typed contracts between pipeline stages.
 *
 * Each stage reads one artifact and writes the next:
 *   question → Brief → ResearchBrief → ScenePlan → SceneAssets[] → RenderResult
 *
 * A worker never reads anything but its input artifact and the Brief.
 * These mirror the "Data schemas" section of the planning doc.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared enums
// ---------------------------------------------------------------------------

export const Level = z.enum(["nothing", "basics", "deep"]);
export type Level = z.infer<typeof Level>;

export const Tone = z.enum(["playful", "neutral", "serious", "documentary"]);
export type Tone = z.infer<typeof Tone>;

export const Background = z.enum(["dark", "light"]);
export type Background = z.infer<typeof Background>;

export const Beat = z.enum([
  "hook",
  "ground",
  "misconception",
  "build-up",
  "core",
  "payoff",
  "recap",
]);
export type Beat = z.infer<typeof Beat>;

export const VisualType = z.enum([
  "diagram", // programmatic over Hedra background/icons
  "chart", // programmatic from research numbers
  "text", // programmatic kinetic typography
  "still-animated", // Hedra image → image-to-video
  "clip", // Hedra reference-driven video, new shot
  "reference-seq", // recurring character across scenes
  "presenter", // optional avatar
]);
export type VisualType = z.infer<typeof VisualType>;

// ---------------------------------------------------------------------------
// Stage 1 — Brief (inferred from the question; never shown for approval)
// ---------------------------------------------------------------------------

export const Brief = z.object({
  projectId: z.string().uuid(),
  question: z.string().min(1).max(500),
  /** Normalised topic, e.g. "autumn leaf colour change" */
  topic: z.string(),
  /** "After watching, the viewer can…" */
  learningGoal: z.string(),
  level: Level,
  ageMode: z.enum(["8-12", "teen"]).nullable(),
  tone: Tone,
  background: Background,
  /** Set after research from the needed-claim count; null until then. */
  lengthS: z.number().int().min(60).max(480).nullable(),
  wordBudget: z.number().int().nullable(),
  sceneRange: z.tuple([z.number().int(), z.number().int()]).nullable(),
  /** One-paragraph statement of intent, stored for QA, never shown. */
  statement: z.string(),
  /** Reactions that produced this brief, if any. */
  derivedFrom: z
    .object({
      projectId: z.string().uuid(),
      reaction: z.enum(["simpler", "deeper", "follow-up"]),
      followUpQuestion: z.string().optional(),
    })
    .nullable(),
});
export type Brief = z.infer<typeof Brief>;

// ---------------------------------------------------------------------------
// Stage 2 — Research brief
// ---------------------------------------------------------------------------

export const Source = z.object({
  url: z.string().url(),
  title: z.string(),
  domain: z.string(),
  /** 0–1 reputation weight from the source policy. */
  reputation: z.number().min(0).max(1),
  openedAt: z.string().datetime(),
});
export type Source = z.infer<typeof Source>;

export const Claim = z.object({
  id: z.string().regex(/^c\d+$/),
  text: z.string(),
  type: z.enum(["definition", "fact", "number", "process", "example", "analogy", "history"]),
  confidence: z.enum(["corroborated", "single", "contested"]),
  fit: z.enum(["needed", "nice", "advanced"]),
  sources: z.array(
    z.object({
      url: z.string().url(),
      quote: z.string(),
    }),
  ),
});
export type Claim = z.infer<typeof Claim>;

export const ResearchBrief = z.object({
  projectId: z.string().uuid(),
  claims: z.array(Claim).min(1),
  misconceptions: z.array(
    z.object({
      belief: z.string(),
      correctsWith: z.array(z.string()),
    }),
  ),
  analogies: z.array(
    z.object({
      text: z.string(),
      breaksDown: z.string(),
      explains: z.array(z.string()),
    }),
  ),
  sources: z.array(Source),
  /** Count of claims with fit=needed; drives length. */
  neededClaimCount: z.number().int(),
});
export type ResearchBrief = z.infer<typeof ResearchBrief>;

// ---------------------------------------------------------------------------
// Stage 3 — Scene plan (extended by Stage 4 with render specs)
// ---------------------------------------------------------------------------

export const AnimSpec = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("labelled-diagram"),
    labels: z.array(z.object({ text: z.string(), cueWord: z.string() })),
  }),
  z.object({
    kind: z.literal("chart"),
    chartType: z.enum(["bar", "line", "proportion"]),
    series: z.array(z.object({ label: z.string(), value: z.number() })),
    claimId: z.string(),
  }),
  z.object({
    kind: z.literal("kinetic-text"),
    lines: z.array(z.object({ text: z.string(), cueWord: z.string() })),
  }),
  z.object({
    kind: z.literal("path-reveal"),
    paths: z.array(z.object({ id: z.string(), cueWord: z.string() })),
  }),
  z.object({ kind: z.literal("none") }),
]);
export type AnimSpec = z.infer<typeof AnimSpec>;

export const RenderSpec = z.object({
  hedraPrompt: z.string().nullable(),
  model: z.string().nullable(),
  referenceAssetIds: z.array(z.string()),
  storyboardAssetId: z.string().nullable(),
  animSpec: AnimSpec,
});
export type RenderSpec = z.infer<typeof RenderSpec>;

export const Scene = z.object({
  id: z.string().regex(/^s\d+$/),
  beat: Beat,
  purpose: z.string(),
  narration: z.string(),
  claimIds: z.array(z.string()),
  /** Must name the metaphor and ≥2 supporting details. */
  visualDirection: z.string(),
  visualType: VisualType,
  targetS: z.number().min(5).max(45),
  onScreenTerms: z.array(z.string()),
  render: RenderSpec.nullable(),
});
export type Scene = z.infer<typeof Scene>;

export const ScenePlan = z.object({
  projectId: z.string().uuid(),
  background: Background,
  scenes: z.array(Scene).min(3),
  /** Results of the learner and expert self-review passes. */
  review: z.object({
    learnerPass: z.object({
      passed: z.boolean(),
      goalAnswer: z.string(),
      unclearSentences: z.array(z.string()),
    }),
    expertPass: z.object({
      passed: z.boolean(),
      unsourced: z.array(z.string()),
      overstated: z.array(z.string()),
    }),
    attempts: z.number().int(),
  }),
});
export type ScenePlan = z.infer<typeof ScenePlan>;

// ---------------------------------------------------------------------------
// Stage 4 → 5 — Scene assets
// ---------------------------------------------------------------------------

export const WordTimestamp = z.object({
  w: z.string(),
  start: z.number(),
  end: z.number(),
});
export type WordTimestamp = z.infer<typeof WordTimestamp>;

export const MirroredAsset = z.object({
  /** Hedra asset id; source of truth for regenerations. */
  hedraAssetId: z.string(),
  /** Our mirrored copy; what the renderer reads. */
  url: z.string().url(),
  contentType: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  durationMs: z.number().int().nullable(),
  model: z.string(),
  costUsd: z.number(),
});
export type MirroredAsset = z.infer<typeof MirroredAsset>;

export const QaResult = z.object({
  check: z.enum([
    "visual-matches-direction",
    "on-screen-text",
    "style-consistency",
    "pacing",
    "audio",
    "factual-integrity",
    "watchability",
  ]),
  passed: z.boolean(),
  score: z.number().nullable(),
  attempts: z.number().int(),
  fallback: z.string().nullable(),
  notes: z.string().nullable(),
});
export type QaResult = z.infer<typeof QaResult>;

export const SceneAssets = z.object({
  projectId: z.string().uuid(),
  sceneId: z.string(),
  audio: z.object({
    asset: MirroredAsset,
    durationS: z.number(),
    words: z.array(WordTimestamp),
  }),
  visuals: z.array(
    z.object({
      asset: MirroredAsset,
      role: z.enum(["background", "icon", "still", "clip", "presenter"]),
    }),
  ),
  qa: z.array(QaResult),
});
export type SceneAssets = z.infer<typeof SceneAssets>;

// ---------------------------------------------------------------------------
// Stage 5 — Render result
// ---------------------------------------------------------------------------

export const RenderResult = z.object({
  projectId: z.string().uuid(),
  videoUrl: z.string().url(),
  srtUrl: z.string().url(),
  durationS: z.number(),
  qa: z.array(QaResult),
  costUsd: z.number(),
});
export type RenderResult = z.infer<typeof RenderResult>;

// ---------------------------------------------------------------------------
// Project status, for the progress view
// ---------------------------------------------------------------------------

export const Stage = z.enum([
  "queued",
  "intake",
  "research",
  "script",
  "visuals",
  "assemble",
  "done",
  "failed",
]);
export type Stage = z.infer<typeof Stage>;

export const ProgressEvent = z.object({
  projectId: z.string().uuid(),
  stage: Stage,
  /** Plain words for the progress view: "reading 14 sources" */
  message: z.string(),
  /** 0–1 */
  fraction: z.number().min(0).max(1),
  /** Early artifacts worth showing: the hook line, the first still. */
  preview: z
    .object({
      hookLine: z.string().optional(),
      stillUrl: z.string().url().optional(),
    })
    .optional(),
  at: z.string().datetime(),
});
export type ProgressEvent = z.infer<typeof ProgressEvent>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Scene budget from the brief: ~165 wpm at 1.1×, 20–40 s per scene. */
export function sceneBudget(lengthS: number, wpm = 165) {
  const wordBudget = Math.round((lengthS / 60) * wpm);
  const minScenes = Math.max(3, Math.floor(lengthS / 40));
  const maxScenes = Math.max(minScenes, Math.ceil(lengthS / 20));
  return { wordBudget, sceneRange: [minScenes, maxScenes] as [number, number] };
}

/** Length from the research's needed-claim count. */
export function lengthFromClaims(needed: number): number {
  if (needed <= 6) return 120;
  if (needed <= 10) return 180;
  return 300;
}
