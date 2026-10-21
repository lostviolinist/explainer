/**
 * Drizzle-backed ArtifactStore. Every save creates a new version; reads return
 * the latest. Progress events also update projects.stage for cheap listing.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import type { ArtifactStore, RenderAttempt } from "@explainer/pipeline";
import type { Brief, ResearchBrief, ScenePlan, SceneAssets, RenderResult, ProgressEvent } from "@explainer/schemas";
import { db, schema } from "./db";

const { artifacts, progressEvents, projects, costs } = schema;

async function save(projectId: string, kind: string, data: unknown, sceneId?: string) {
  const where = sceneId ? and(eq(artifacts.projectId, projectId), eq(artifacts.kind, kind), eq(artifacts.sceneId, sceneId)) : and(eq(artifacts.projectId, projectId), eq(artifacts.kind, kind), isNull(artifacts.sceneId));
  const last = await db.select({ version: artifacts.version }).from(artifacts).where(where).orderBy(desc(artifacts.version)).limit(1);
  await db.insert(artifacts).values({ projectId, kind, sceneId: sceneId ?? null, version: (last[0]?.version ?? 0) + 1, data: data as object });
}

export async function latest<T>(projectId: string, kind: string): Promise<T | null> {
  const rows = await db
    .select({ data: artifacts.data })
    .from(artifacts)
    .where(and(eq(artifacts.projectId, projectId), eq(artifacts.kind, kind), isNull(artifacts.sceneId)))
    .orderBy(desc(artifacts.version))
    .limit(1);
  return (rows[0]?.data as T) ?? null;
}

async function must<T>(projectId: string, kind: string): Promise<T> {
  const v = await latest<T>(projectId, kind);
  if (!v) throw new Error(`missing ${kind} for ${projectId}`);
  return v;
}

export const drizzleStore: ArtifactStore = {
  async saveBrief(b: Brief) {
    await save(b.projectId, "brief", b);
    if (b.title) await db.update(projects).set({ title: b.title }).where(eq(projects.id, b.projectId));
  },
  saveResearch: (r: ResearchBrief) => save(r.projectId, "research", r),
  savePlan: (p: ScenePlan) => save(p.projectId, "plan", p),
  saveSceneAssets: (a: SceneAssets) => save(a.projectId, "sceneAssets", a, a.sceneId),
  saveRender: (r: RenderResult) => save(r.projectId, "render", r),

  getBrief: (id) => must<Brief>(id, "brief"),
  getResearch: (id) => must<ResearchBrief>(id, "research"),
  getPlan: (id) => must<ScenePlan>(id, "plan"),
  async getSceneAssets(id) {
    const rows = await db
      .select({ sceneId: artifacts.sceneId, data: artifacts.data })
      .from(artifacts)
      .where(and(eq(artifacts.projectId, id), eq(artifacts.kind, "sceneAssets")))
      .orderBy(desc(artifacts.version));
    const seen = new Set<string>();
    return rows.filter((r) => (r.sceneId && !seen.has(r.sceneId) ? (seen.add(r.sceneId), true) : false)).map((r) => r.data as SceneAssets);
  },

  async saveRenderAttempt(projectId, a: RenderAttempt) {
    await save(projectId, "renderAttempt", a);
  },
  async getRenderAttempt(projectId) {
    return latest<RenderAttempt>(projectId, "renderAttempt");
  },
  async progress(e: ProgressEvent) {
    await db.transaction(async (tx) => {
      await tx.insert(progressEvents).values({ projectId: e.projectId, stage: e.stage, message: e.message, fraction: e.fraction, preview: e.preview ?? null, at: new Date(e.at) });
      await tx.update(projects).set({ stage: e.stage, updatedAt: new Date() }).where(eq(projects.id, e.projectId));
    });
  },
  async recordCost(projectId, stage, usd, note) {
    await db.insert(costs).values({ projectId, stage, usd, note: note ?? null });
  },
};
