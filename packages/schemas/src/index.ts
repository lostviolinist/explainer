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
  "diagram", // a Hedra illustration with callouts that point at its parts as they're mentioned
  "chart", // numbers from a claim, as bars (a motion template)
  "text", // key points appearing as they're said (a motion template)
  "still-animated", // Hedra image → image-to-video
  "clip", // Hedra reference-driven video, new shot
  "reference-seq", // recurring character across scenes
  "presenter", // optional avatar
  "manim", // AI-written Manim code, 3Blue1Brown style (rendered in the animator sandbox)
  "three", // AI-written three.js (React Three Fiber) 3D scene (rendered in the animator sandbox; 3Blue1Brown style only)
  "motion", // flat motion graphics from a hand-designed template (steps, compare, count, split, points), filled in by the model
]);
export type VisualType = z.infer<typeof VisualType>;

/** The look the viewer picked: Hedra illustration, or 3Blue1Brown-style math animation. */
export const VideoStyle = z.enum(["illustrated", "math"]);
export type VideoStyle = z.infer<typeof VideoStyle>;

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
  /** Chosen by the viewer; briefs saved before styles existed are illustrated. */
  style: VideoStyle.default("illustrated"),
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

/**
 * Icons the motion templates can draw (packages/render/src/motion/icons.ts has
 * the paths). The planner picks from this list, so a name is never invented.
 */
export const ICON_NAMES = [
  "sun", "moon", "eye", "molecule", "leaf", "person", "people", "cloud", "gear", "clock", "drop", "star", "box", "heart", "bulb", "earth", "bolt", "arrow", "check", "cross", "question", "flask", "wave", "mountain", "book", "house", "tree", "brain", "rocket", "magnet", "battery", "thermometer", "magnifier", "coin", "dna",
  "fire", "car", "factory", "phone", "shield", "virus", "atom", "scale", "lock", "calendar", "fish", "bird", "cup", "pencil", "bag", "lungs", "bone", "apple", "bread", "bed", "plane", "ship", "train", "music", "camera", "key", "map", "chart", "trophy", "gift", "hand",
] as const;
export const IconName = z.enum(ICON_NAMES);
export type IconName = z.infer<typeof IconName>;

/** A word (or two) from the narration: the thing appears when it is spoken. */
const Cue = z.string().min(1).max(40);
const Short = (max: number) => z.string().min(1).max(max);

/** One side of a split: a heading ("Myth"), a short line, and when it appears. */
export const SplitSide = z.object({ heading: Short(16), text: Short(72), icon: IconName.nullable(), cue: Cue });
export type SplitSide = z.infer<typeof SplitSide>;

/**
 * What moves on screen, as data for one of the hand-designed motion templates
 * in packages/render/src/motion. The model fills the words, icons, numbers and
 * the narration word each thing appears on; the template does the design.
 */
export const NoneSpec = z.object({ kind: z.literal("none") });
/** Steps in order (a process, a chain of cause and effect), or a cycle. */
export const StepsSpec = z.object({
  kind: z.literal("steps"),
  title: Short(40).nullable(),
  cycle: z.boolean(),
  steps: z.array(z.object({ label: Short(24), sub: Short(24).nullable(), icon: IconName, cue: Cue })).min(2).max(6),
});
/** Two or three things side by side, with a quantity each when the point is a quantity. */
export const CompareSpec = z.object({
  kind: z.literal("compare"),
  title: Short(40).nullable(),
  items: z.array(z.object({ label: Short(24), icon: IconName, value: z.number().nullable(), unit: Short(12).nullable(), note: Short(32).nullable(), cue: Cue })).min(2).max(3),
  verdict: Short(48).nullable(),
  verdictCue: Cue.nullable(),
});
/** One number that matters, counted up, with what it is out of and what it compares to. */
export const CountSpec = z.object({
  kind: z.literal("count"),
  value: z.number(),
  unit: Short(16).nullable(),
  label: Short(40),
  cue: Cue,
  outOf: z.number().nullable(),
  comparison: z.object({ text: Short(60), icon: IconName, cue: Cue }).nullable(),
});
/** Two sides: myth and fact, before and after, what people think and what happens. */
export const SplitSpec = z.object({
  kind: z.literal("split"),
  left: SplitSide,
  right: SplitSide,
  winner: z.enum(["left", "right", "neither"]),
  verdictCue: Cue.nullable(),
});
/** Key points, one line each, appearing as they are said (recaps, "three things to know"). */
export const PointsSpec = z.object({
  kind: z.literal("points"),
  title: Short(40).nullable(),
  points: z.array(z.object({ text: Short(60), icon: IconName.nullable(), cue: Cue })).min(1).max(5),
});
/** Numbers from a claim, as bars that grow as each is named. */
export const ChartSpec = z.object({
  kind: z.literal("chart"),
  title: Short(40).nullable(),
  unit: Short(12).nullable(),
  series: z.array(z.object({ label: Short(24), value: z.number(), cue: Cue })).min(2).max(5),
  claimId: z.string(),
});
/** Callouts over an illustration: each part named as it is mentioned. x, y (0–1) are found by looking at the picture. */
export const RevealSpec = z.object({
  kind: z.literal("reveal"),
  items: z.array(z.object({ label: Short(28), cue: Cue, x: z.number().min(0).max(1).nullable(), y: z.number().min(0).max(1).nullable() })).min(1).max(6),
});

export const AnimSpec = z.discriminatedUnion("kind", [NoneSpec, StepsSpec, CompareSpec, CountSpec, SplitSpec, PointsSpec, ChartSpec, RevealSpec]);
export type AnimSpec = z.infer<typeof AnimSpec>;
/** The templates a motion-graphics scene can be: what the planner chooses from (key points belong to text scenes). */
export const MotionSpec = z.discriminatedUnion("kind", [StepsSpec, CompareSpec, CountSpec, SplitSpec]);
export type MotionSpec = z.infer<typeof MotionSpec>;

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

/** A recurring thing in the video, drawn the same way in every scene. */
export const CastMember = z.object({
  name: z.string(),
  /** How it's drawn: a simple shape or icon description. */
  look: z.string(),
  /** Its accent colour (hex). */
  color: z.string(),
});
export type CastMember = z.infer<typeof CastMember>;

export const ScenePlan = z.object({
  projectId: z.string().uuid(),
  background: Background,
  scenes: z.array(Scene).min(3),
  cast: z.array(CastMember).default([]),
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
    "sound",
  ]),
  passed: z.boolean(),
  score: z.number().nullable(),
  attempts: z.number().int(),
  fallback: z.string().nullable(),
  notes: z.string().nullable(),
});
export type QaResult = z.infer<typeof QaResult>;

/** A sound effect cue inside a scene: seconds from the scene start, and which sound from the kit. */
export const SoundKind = z.enum(["pop", "whoosh", "tick", "chime", "swoosh"]);
export type SoundKind = z.infer<typeof SoundKind>;
export const SoundCue = z.object({ at: z.number(), kind: SoundKind });
export type SoundCue = z.infer<typeof SoundCue>;

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
      role: z.enum(["background", "icon", "still", "clip", "presenter", "animation"]),
    }),
  ),
  /** Sound cues the scene's animation asked for (code scenes). */
  sounds: z.array(SoundCue).default([]),
  /** The plan's animation spec, refined once the visuals exist (callouts placed on the still). */
  animSpec: AnimSpec.nullable().default(null),
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
  /** Early artifacts worth showing while the video is made: sources and facts as they're read, the hook line, each scene's still, clip and narration as they land. */
  preview: z
    .object({
      hookLine: z.string().optional(),
      sceneId: z.string().optional(),
      stillUrl: z.string().url().optional(),
      clipUrl: z.string().url().optional(),
      audioUrl: z.string().url().optional(),
      source: z.object({ url: z.string(), title: z.string(), domain: z.string() }).optional(),
      fact: z.string().optional(),
    })
    .optional(),
  at: z.string().datetime(),
});
export type ProgressEvent = z.infer<typeof ProgressEvent>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fixed timing in the rendered video: a pause after each scene and the sources end card. */
export const VIDEO_TIMING = { sceneTailS: 0.6, endCardS: 6 } as const;

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
