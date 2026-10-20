/**
 * Everything the Watch page shows for a finished video, from the stored
 * artifacts: the file, a poster, the transcript with the time each scene
 * starts in the final cut, sources, the quiz and what it cost.
 */
import type { Brief, RenderResult, ResearchBrief } from "@explainer/schemas";
import { FPS, sceneFrames } from "@explainer/render/props";
import { latest } from "./store";
import { getLiveState } from "./live";
import { toPublic } from "./public-urls";
import { videoCost } from "./gallery";
import { cleanSourceTitle, cleanTitle } from "./titles";
import type { QuizItem } from "@/app/Quiz";

export type Paragraph = { id: string; at: number; text: string };
export type WatchSource = { url: string; title: string; domain: string };
export type WatchData = {
  projectId: string;
  title: string;
  style: string;
  videoUrl: string;
  poster: string | null;
  srtUrl: string;
  durationS: number;
  paragraphs: Paragraph[];
  sources: WatchSource[];
  quiz: QuizItem[];
  costUsd: number;
  sharePath: string;
  /** Scenes whose caption timing was estimated because transcription failed, with the reason. */
  estimatedCaptions: { n: number; of: number; note: string } | null;
};

export async function watchData(project: { id: string; question: string; title: string | null; style: string; shareSlug: string }): Promise<WatchData | null> {
  const render = await latest<RenderResult>(project.id, "render");
  if (!render) return null;
  const [research, live, brief, costUsd] = await Promise.all([latest<ResearchBrief>(project.id, "research"), getLiveState(project.id), latest<Brief>(project.id, "brief"), videoCost(project.id)]);

  // The final cut plays the scenes back to back, each with its short tail, so a scene's start is exact.
  const scenes = live.roughCut?.scenes ?? [];
  let frame = 0;
  const paragraphs: Paragraph[] = scenes.map((s) => {
    const at = frame / FPS;
    frame += sceneFrames(s.durationS);
    return { id: s.id, at, text: s.narration };
  });
  if (!paragraphs.length) live.scenes.forEach((s) => paragraphs.push({ id: s.id, at: 0, text: s.narration }));

  const estimated = live.scenes.filter((s) => s.captionsExact === false);
  return {
    projectId: project.id,
    title: cleanTitle(project.question, project.title),
    style: brief?.style ?? project.style,
    videoUrl: toPublic(render.videoUrl),
    poster: toPublic(live.scenes.find((s) => s.stillUrl)?.stillUrl ?? null),
    srtUrl: toPublic(render.srtUrl),
    durationS: render.durationS,
    paragraphs,
    sources: (research?.sources ?? []).map((s) => ({ url: s.url, title: cleanSourceTitle(s.title), domain: s.domain })),
    quiz: live.quiz,
    costUsd,
    sharePath: `/s/${project.shareSlug}`,
    estimatedCaptions: estimated.length ? { n: estimated.length, of: live.scenes.length, note: estimated[0]!.timingNote ?? "no transcription" } : null,
  };
}
