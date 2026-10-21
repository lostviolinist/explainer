/**
 * Artifact store: the orchestrator is the only writer. Every stage output is
 * saved with a version so re-runs and audits are cheap. The web app implements
 * this against Prisma; tests use the in-memory version.
 */
import type { Brief, ResearchBrief, ScenePlan, SceneAssets, RenderResult, ProgressEvent } from "@explainer/schemas";

export type ArtifactKind = "brief" | "research" | "plan" | "sceneAssets" | "render" | "renderAttempt";

/**
 * A note on the final render, written when it starts and again when it ends, so a retry can tell a
 * render whose process was killed under it (still "started") from one that failed with an error ("ended").
 */
export type RenderAttempt = { runId: string; state: "started" | "ended"; at: string };

export interface ArtifactStore {
  saveBrief(b: Brief): Promise<void>;
  saveResearch(r: ResearchBrief): Promise<void>;
  savePlan(p: ScenePlan): Promise<void>;
  saveSceneAssets(a: SceneAssets): Promise<void>;
  saveRender(r: RenderResult): Promise<void>;

  getBrief(projectId: string): Promise<Brief>;
  getResearch(projectId: string): Promise<ResearchBrief>;
  getPlan(projectId: string): Promise<ScenePlan>;
  getSceneAssets(projectId: string): Promise<SceneAssets[]>;

  saveRenderAttempt(projectId: string, a: RenderAttempt): Promise<void>;
  getRenderAttempt(projectId: string): Promise<RenderAttempt | null>;

  progress(e: ProgressEvent): Promise<void>;
  recordCost(projectId: string, stage: string, usd: number, note?: string): Promise<void>;
}

export class MemoryStore implements ArtifactStore {
  briefs = new Map<string, Brief>();
  research = new Map<string, ResearchBrief>();
  plans = new Map<string, ScenePlan>();
  assets = new Map<string, SceneAssets[]>();
  renders = new Map<string, RenderResult>();
  attempts = new Map<string, RenderAttempt>();
  events: ProgressEvent[] = [];
  costs: { projectId: string; stage: string; usd: number; note?: string }[] = [];

  async saveBrief(b: Brief) { this.briefs.set(b.projectId, b); }
  async saveResearch(r: ResearchBrief) { this.research.set(r.projectId, r); }
  async savePlan(p: ScenePlan) { this.plans.set(p.projectId, p); }
  async saveSceneAssets(a: SceneAssets) {
    const list = this.assets.get(a.projectId) ?? [];
    const i = list.findIndex((x) => x.sceneId === a.sceneId);
    if (i >= 0) list[i] = a; else list.push(a);
    this.assets.set(a.projectId, list);
  }
  async saveRender(r: RenderResult) { this.renders.set(r.projectId, r); }
  async getBrief(id: string) { return must(this.briefs.get(id), "brief"); }
  async getResearch(id: string) { return must(this.research.get(id), "research"); }
  async getPlan(id: string) { return must(this.plans.get(id), "plan"); }
  async getSceneAssets(id: string) { return this.assets.get(id) ?? []; }
  async saveRenderAttempt(projectId: string, a: RenderAttempt) { this.attempts.set(projectId, a); }
  async getRenderAttempt(id: string) { return this.attempts.get(id) ?? null; }
  async progress(e: ProgressEvent) { this.events.push(e); }
  async recordCost(projectId: string, stage: string, usd: number, note?: string) { this.costs.push({ projectId, stage, usd, note }); }
}

function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) throw new Error(`missing ${what}`);
  return v;
}
