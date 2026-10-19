/**
 * Finished videos for the home page: question, poster, length and style,
 * newest first. Answers "show me one" before anyone types a question.
 */
import { desc, eq, inArray } from "drizzle-orm";
import type { RenderResult, SceneAssets } from "@explainer/schemas";
import { db, schema } from "./db";
import { toPublic } from "./public-urls";

export type GalleryItem = { id: string; question: string; style: string; shareSlug: string; poster: string | null; videoUrl: string | null; durationS: number | null; createdAt: string };

/** One card per question: the same question asked four times (re-runs, Simpler, Deeper) shows its newest video. */
export async function recentVideos(limit = 8): Promise<GalleryItem[]> {
  const candidates = await db
    .select({ id: schema.projects.id, question: schema.projects.question, style: schema.projects.style, shareSlug: schema.projects.shareSlug, createdAt: schema.projects.createdAt })
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
    // The first scene with a picture, by scene number.
    const stills = mine
      .filter((r) => r.kind === "sceneAssets")
      .map((r) => r.data as SceneAssets)
      .sort((a, b) => Number(a.sceneId.slice(1)) - Number(b.sceneId.slice(1)));
    const poster = stills.flatMap((a) => a.visuals).find((v) => v.role === "still" || v.role === "background")?.asset.url ?? null;
    return { id: p.id, question: p.question, style: p.style, shareSlug: p.shareSlug, poster: toPublic(poster), videoUrl: toPublic(render?.videoUrl ?? null), durationS: render?.durationS ?? null, createdAt: p.createdAt.toISOString() };
  });
}

/** What a video cost to make, in dollars, from every paid call recorded for it. */
export async function videoCost(projectId: string): Promise<number> {
  const rows = await db.select({ usd: schema.costs.usd }).from(schema.costs).where(eq(schema.costs.projectId, projectId));
  return rows.reduce((n, r) => n + Number(r.usd ?? 0), 0);
}
