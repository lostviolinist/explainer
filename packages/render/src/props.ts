import { z } from "zod";
import { AnimSpec, VisualType, WordTimestamp, VIDEO_TIMING } from "@explainer/schemas";

/** Props for the Explainer composition. Mirrors RenderProps in @explainer/pipeline. */
export const ExplainerProps = z.object({
  projectId: z.string(),
  background: z.enum(["dark", "light"]),
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
          role: z.enum(["background", "icon", "still", "clip", "presenter"]),
        }),
      ),
      onScreenTerms: z.array(z.string()),
    }),
  ),
  sources: z.array(z.object({ title: z.string(), domain: z.string(), url: z.string() })),
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
  accents: ["#F2C14E", "#8FB8E8", "#E4573D", "#5FA36B"],
};

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
