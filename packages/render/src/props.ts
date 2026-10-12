import { z } from "zod";
import { AnimSpec, VisualType, WordTimestamp, VIDEO_TIMING } from "@explainer/schemas";

/** Props for the Explainer composition. Mirrors RenderProps in @explainer/pipeline. */
export const ExplainerProps = z.object({
  projectId: z.string(),
  /** "math" is the 3Blue1Brown look: black, matching Manim's background. */
  background: z.enum(["dark", "light", "math"]),
  learningGoal: z.string(),
  scenes: z.array(
    z.object({
      id: z.string(),
      narration: z.string(),
      visualType: VisualType,
      animSpec: AnimSpec,
      audioUrl: z.string(),
      durationS: z.number(),
      words: z.array(WordTimestamp),
      visuals: z.array(
        z.object({
          asset: z.object({ url: z.string(), contentType: z.string(), durationMs: z.number().nullable() }).passthrough(),
          role: z.enum(["background", "icon", "still", "clip", "presenter", "animation"]),
        }),
      ),
      onScreenTerms: z.array(z.string()),
      /** Sound cues from the scene's animation (seconds from the scene start). */
      sounds: z.array(z.object({ at: z.number(), kind: z.string() })).default([]),
    }),
  ),
  sources: z.array(z.object({ title: z.string(), domain: z.string(), url: z.string() })),
  /** The music bed; played end-aligned so its composed ending lands on the end card. */
  music: z.object({ url: z.string(), durationS: z.number() }).nullable().default(null),
  /** Sound-effect kit by kind (pop, whoosh, tick, chime, swoosh). */
  sfx: z.record(z.string(), z.string()).default({}),
});
export type ExplainerProps = z.infer<typeof ExplainerProps>;

export const COMPOSITION_ID = "Explainer";
export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
/** Breathing room after the narration ends, before the cut. */
export const SCENE_TAIL_S = VIDEO_TIMING.sceneTailS;
export const END_CARD_S = VIDEO_TIMING.endCardS;

export const PALETTE = {
  dark: { bg: "#0B1C3F", ink: "#F6F3EC", muted: "rgba(246,243,236,0.65)" },
  light: { bg: "#F6F3EC", ink: "#1B2235", muted: "rgba(27,34,53,0.65)" },
  math: { bg: "#000000", ink: "#F4F4F4", muted: "rgba(244,244,244,0.6)" },
  accents: ["#F2C14E", "#8FB8E8", "#E4573D", "#5FA36B"],
  /** 3Blue1Brown accents (Manim's BLUE_C, YELLOW, GREEN, RED). */
  mathAccents: ["#58C4DD", "#FFFF66", "#83C167", "#FC6255"],
};

export const accentsFor = (background: ExplainerProps["background"]) => (background === "math" ? PALETTE.mathAccents : PALETTE.accents);

/** Music levels (linear gain): under the narration, between scenes and on the end card. */
export const MUSIC = { under: 0.14, between: 0.3, fadeInFrames: 45, duckFrames: 18 };
export const SFX_VOLUME = 0.35;
/** Frames a swipe transition panel takes to cover or uncover the frame (illustrated style). */
export const SWIPE_FRAMES = 10;

/**
 * Where in the bed to start so that its ending lands exactly on the video's
 * end. A bed shorter than the video starts at 0 and loops (then fades out).
 */
export function musicStart(bedDurationS: number, totalFrames: number): { startFrom: number; loop: boolean } {
  const bedFrames = Math.floor(bedDurationS * FPS);
  return bedFrames >= totalFrames ? { startFrom: bedFrames - totalFrames, loop: false } : { startFrom: 0, loop: true };
}

/** Narration windows [from, to) in frames, for ducking. */
export function speechWindows(p: ExplainerProps): [number, number][] {
  let cursor = 0;
  return p.scenes.map((s) => {
    const from = cursor;
    cursor += sceneFrames(s.durationS);
    return [from, from + Math.round(s.durationS * FPS)];
  });
}

/** Bed gain at a frame: faded in, ducked under speech, up in the gaps and on the end card, tapered at the very end. */
export function musicVolume(frame: number, windows: [number, number][], total: number, loop: boolean): number {
  let inside = Infinity;
  for (const [a, b] of windows) {
    const d = frame < a ? a - frame : frame >= b ? frame - b + 1 : 0;
    inside = Math.min(inside, d);
  }
  const mix = Math.min(1, inside / MUSIC.duckFrames);
  let v = MUSIC.under + (MUSIC.between - MUSIC.under) * mix;
  v *= Math.min(1, frame / MUSIC.fadeInFrames);
  // Looping bed: fade out over the end card. End-aligned bed: its own ending, plus a tiny safety taper.
  v *= loop ? Math.min(1, (total - frame) / (END_CARD_S * FPS)) : Math.min(1, (total - frame) / 8);
  return Math.max(0, v);
}

export function sceneFrames(durationS: number) {
  return Math.round((durationS + SCENE_TAIL_S) * FPS);
}

export function totalFrames(p: ExplainerProps) {
  return p.scenes.reduce((n, s) => n + sceneFrames(s.durationS), 0) + END_CARD_S * FPS;
}

/** Frame (within the scene) at which a cue word starts. */
export function cueFrame(words: ExplainerProps["scenes"][number]["words"], cue: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const w = words.find((x) => norm(x.w) === norm(cue)) ?? words.find((x) => norm(x.w).startsWith(norm(cue)));
  return w ? Math.round(w.start * FPS) : 0;
}
