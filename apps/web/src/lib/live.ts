/**
 * What the progress page shows while a video is made, built from the stored
 * artifacts. Live previews from progress events (sources, facts, scene media)
 * are merged in on the client so nothing waits for a stage to finish.
 */
import type { Brief, ResearchBrief, ScenePlan, SceneAssets } from "@explainer/schemas";
import { latest, drizzleStore } from "./store";

export type LiveScene = {
  id: string;
  beat: string;
  narration: string;
  visualType: string;
  stillUrl?: string;
  clipUrl?: string;
  audioUrl?: string;
  /** Word timestamps and narration length, once the scene is done (for the rough cut). */
  words?: { w: string; start: number; end: number }[];
  durationS?: number;
  done: boolean;
};

export type LiveState = {
  brief: { learningGoal: string; level: string; tone: string; lengthS: number | null; style: string } | null;
  sources: { url: string; title: string; domain: string }[];
  facts: { text: string; domain?: string }[];
  quiz: { statement: string; answer: "myth" | "fact"; explanation: string }[];
  scenes: LiveScene[];
};

const domainOf = (url?: string) => (url ? new URL(url).hostname.replace(/^www\./, "") : undefined);

export async function getLiveState(projectId: string): Promise<LiveState> {
  const [brief, research, plan, assets] = await Promise.all([
    latest<Brief>(projectId, "brief"),
    latest<ResearchBrief>(projectId, "research"),
    latest<ScenePlan>(projectId, "plan"),
    drizzleStore.getSceneAssets(projectId).catch(() => [] as SceneAssets[]),
  ]);

  const claims = research?.claims ?? [];
  const byId = new Map(claims.map((c) => [c.id, c]));
  const solid = claims.filter((c) => c.confidence !== "contested");
  const ranked = [...solid.filter((c) => c.fit === "needed"), ...solid.filter((c) => c.fit !== "needed")];

  const myths = (research?.misconceptions ?? []).map((m) => ({
    statement: m.belief,
    answer: "myth" as const,
    explanation: m.correctsWith.map((id) => byId.get(id)?.text).find(Boolean) ?? "The research found this doesn't hold up.",
  }));
  const truths = solid
    .filter((c) => c.confidence === "corroborated" && (c.type === "fact" || c.type === "number"))
    .slice(0, Math.max(1, myths.length))
    .map((c) => ({ statement: c.text, answer: "fact" as const, explanation: `Backed by ${c.sources.length} source${c.sources.length === 1 ? "" : "s"}, including ${domainOf(c.sources[0]?.url) ?? "the research"}.` }));
  // Interleave so the answer isn't always "myth".
  const quiz = Array.from({ length: Math.max(myths.length, truths.length) }, (_, i) => [myths[i], truths[i]]).flat().filter((q): q is NonNullable<typeof q> => Boolean(q));

  const byScene = new Map(assets.map((a) => [a.sceneId, a]));
  return {
    brief: brief ? { learningGoal: brief.learningGoal, level: brief.level, tone: brief.tone, lengthS: brief.lengthS, style: brief.style ?? "illustrated" } : null,
    sources: (research?.sources ?? []).map((s) => ({ url: s.url, title: s.title, domain: s.domain })),
    facts: ranked.slice(0, 12).map((c) => ({ text: c.text, domain: domainOf(c.sources[0]?.url) })),
    quiz,
    scenes: (plan?.scenes ?? []).map((s) => {
      const a = byScene.get(s.id);
      return {
        id: s.id,
        beat: s.beat,
        narration: s.narration,
        visualType: s.visualType,
        stillUrl: a?.visuals.find((v) => v.role === "still" || v.role === "background")?.asset.url,
        clipUrl: a?.visuals.find((v) => v.role === "clip" || v.role === "animation")?.asset.url,
        audioUrl: a?.audio.asset.url,
        words: a?.audio.words,
        durationS: a?.audio.durationS,
        done: Boolean(a),
      };
    }),
  };
}
