/**
 * Videos for the home page: finished ones (question, poster, length, style,
 * sources), and the ones still being made with a snapshot of their progress.
 */
import { and, desc, eq, gt, inArray, notInArray } from "drizzle-orm";
import type { RenderResult, ResearchBrief, SceneAssets, ScenePlan } from "@explainer/schemas";
import { db, schema } from "./db";
import { toPublic } from "./public-urls";
import { cleanTitle } from "./titles";

export type GalleryItem = {
  id: string;
  question: string;
  title: string;
  style: string;
  shareSlug: string;
  poster: string | null;
  videoUrl: string | null;
  durationS: number | null;
  sourceCount: number;
  createdAt: string;
};

/** One card per question: the same question asked several times (re-runs, Simpler, Deeper) shows its newest video. */
export async function recentVideos(limit = 8): Promise<GalleryItem[]> {
  const candidates = await db
    .select({ id: schema.projects.id, question: schema.projects.question, title: schema.projects.title, style: schema.projects.style, shareSlug: schema.projects.shareSlug, createdAt: schema.projects.createdAt })
    .from(schema.projects)
    .where(eq(schema.projects.stage, "done"))
    .orderBy(desc(schema.projects.createdAt))
    .limit(limit * 4);
  const seen = new Set<string>();
  const projects = candidates.filter((p) => {
    const key = `${p.style}:${p.question.trim().toLowerCase().replace(/[^a-z0-9 ]/g, "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);
  if (!projects.length) return [];
  const rows = await db
    .select({ projectId: schema.artifacts.projectId, kind: schema.artifacts.kind, sceneId: schema.artifacts.sceneId, data: schema.artifacts.data, createdAt: schema.artifacts.createdAt })
    .from(schema.artifacts)
    .where(inArray(schema.artifacts.projectId, projects.map((p) => p.id)))
    .orderBy(desc(schema.artifacts.createdAt));
  return projects.map((p) => {
    const mine = rows.filter((r) => r.projectId === p.id);
    const render = mine.find((r) => r.kind === "render")?.data as RenderResult | undefined;
    const research = mine.find((r) => r.kind === "research")?.data as ResearchBrief | undefined;
    // The first scene with a picture, by scene number.
    const stills = mine
      .filter((r) => r.kind === "sceneAssets")
      .map((r) => r.data as SceneAssets)
      .sort((a, b) => Number(a.sceneId.slice(1)) - Number(b.sceneId.slice(1)));
    const poster = stills.flatMap((a) => a.visuals).find((v) => v.role === "still" || v.role === "background")?.asset.url ?? null;
    return {
      id: p.id,
      question: p.question,
      title: cleanTitle(p.question, p.title),
      style: p.style,
      shareSlug: p.shareSlug,
      poster: toPublic(poster),
      videoUrl: toPublic(render?.videoUrl ?? null),
      durationS: render?.durationS ?? null,
      sourceCount: research?.sources.length ?? 0,
      createdAt: p.createdAt.toISOString(),
    };
  });
}

/** Share of the whole run each stage takes, from typical timings (the same table the progress page uses). */
const SPAN: Record<string, [number, number]> = {
  queued: [0, 0.02],
  intake: [0.02, 0.05],
  research: [0.05, 0.3],
  script: [0.3, 0.42],
  visuals: [0.42, 0.88],
  assemble: [0.88, 1],
};
const STAGE_LABEL: Record<string, string> = { queued: "Starting", intake: "Understanding", research: "Researching", script: "Writing", visuals: "Illustrating", assemble: "Editing" };
const TYPICAL_MIN = 10;

export type InProgressItem = {
  id: string;
  title: string;
  style: string;
  stageLabel: string;
  pct: number;
  scenesReady: number;
  scenesTotal: number;
  timeLeft: string;
  poster: string | null;
};

/** Projects that are not finished yet, newest first, with a snapshot of where they are. */
export async function inProgress(limit = 4): Promise<InProgressItem[]> {
  const since = new Date(Date.now() - 6 * 3600_000);
  const rows = await db
    .select({ id: schema.projects.id, question: schema.projects.question, title: schema.projects.title, style: schema.projects.style, stage: schema.projects.stage, createdAt: schema.projects.createdAt })
    .from(schema.projects)
    .where(and(notInArray(schema.projects.stage, ["done", "failed"]), gt(schema.projects.createdAt, since)))
    .orderBy(desc(schema.projects.createdAt))
    .limit(limit);
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [events, arts] = await Promise.all([
    db
      .select({ projectId: schema.progressEvents.projectId, stage: schema.progressEvents.stage, fraction: schema.progressEvents.fraction, at: schema.progressEvents.at })
      .from(schema.progressEvents)
      .where(inArray(schema.progressEvents.projectId, ids))
      .orderBy(desc(schema.progressEvents.at)),
    db
      .select({ projectId: schema.artifacts.projectId, kind: schema.artifacts.kind, sceneId: schema.artifacts.sceneId, data: schema.artifacts.data })
      .from(schema.artifacts)
      .where(and(inArray(schema.artifacts.projectId, ids), inArray(schema.artifacts.kind, ["plan", "sceneAssets"])))
      .orderBy(desc(schema.artifacts.createdAt)),
  ]);
  return rows.map((p) => {
    const last = events.find((e) => e.projectId === p.id);
    const mine = arts.filter((a) => a.projectId === p.id);
    const plan = mine.find((a) => a.kind === "plan")?.data as ScenePlan | undefined;
    const seen = new Set<string>();
    const assets = mine.filter((a) => a.kind === "sceneAssets" && a.sceneId && !seen.has(a.sceneId) && seen.add(a.sceneId)).map((a) => a.data as SceneAssets);
    const total = plan?.scenes.length ?? 0;
    const ready = assets.length;
    const stage = last?.stage ?? p.stage;
    const [lo, hi] = SPAN[stage] ?? [0, 1];
    const within = stage === "visuals" && total ? Math.max(last?.fraction ?? 0, ready / total) : (last?.fraction ?? 0);
    const pct = Math.min(1, lo + (hi - lo) * Math.min(1, within));
    const elapsedMin = (Date.now() - p.createdAt.getTime()) / 60000;
    // From the pace so far once there is some; the typical length until then. A range, not a number:
    // the single number jumped around during a run.
    const etaMin = pct > 0.12 && elapsedMin > 0.5 ? (elapsedMin * (1 - pct)) / pct : TYPICAL_MIN * (1 - pct);
    const low = Math.max(1, Math.round(etaMin * 0.8));
    const high = Math.max(low + 1, Math.round(etaMin * 1.25));
    const timeLeft = pct >= 0.97 ? "almost done" : etaMin < 1.5 ? "about a minute left" : `about ${low}–${high} min left`;
    const poster = assets.flatMap((a) => a.visuals).find((v) => v.role === "still" || v.role === "background")?.asset.url ?? null;
    return { id: p.id, title: cleanTitle(p.question, p.title), style: p.style, stageLabel: STAGE_LABEL[stage] ?? "Working", pct, scenesReady: ready, scenesTotal: total, timeLeft, poster: toPublic(poster) };
  });
}

/** What a video cost to make, in dollars, from every paid call recorded for it. */
export async function videoCost(projectId: string): Promise<number> {
  const rows = await db.select({ usd: schema.costs.usd }).from(schema.costs).where(eq(schema.costs.projectId, projectId));
  return rows.reduce((n, r) => n + Number(r.usd ?? 0), 0);
}
