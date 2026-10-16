/**
 * Client for the animation sandboxes (animator/manim, packages/render/src/animator).
 * Code that fails to render comes back as an error message to feed to the model;
 * a sandbox that's down or unreachable throws, so the orchestrator retries the step.
 */
export type Engine = "manim" | "three";

export type AnimatorResult = { ok: true; video: Uint8Array } | { ok: false; error: string };

export interface Animator {
  /** Engines that are configured and healthy right now. */
  available(): Promise<Engine[]>;
  render(engine: Engine, code: string, durationS: number, background: string): Promise<AnimatorResult>;
}

export class HttpAnimator implements Animator {
  private cache: { at: number; engines: Engine[] } | null = null;

  constructor(private urls: Partial<Record<Engine, string>>, private f: typeof fetch = fetch) {}

  async available(): Promise<Engine[]> {
    if (this.cache && Date.now() - this.cache.at < 60_000) return this.cache.engines;
    const checks = await Promise.all(
      (Object.entries(this.urls) as [Engine, string | undefined][]).map(async ([engine, url]) => {
        if (!url) return null;
        try {
          const res = await this.f(`${url.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(60_000) });
          return res.ok ? engine : null;
        } catch {
          return null;
        }
      }),
    );
    const engines = checks.filter((e): e is Engine => e !== null);
    this.cache = { at: Date.now(), engines };
    return engines;
  }

  async render(engine: Engine, code: string, durationS: number, background: string): Promise<AnimatorResult> {
    const url = this.urls[engine];
    if (!url) throw new Error(`${engine} animator is not configured`);
    const res = await this.f(`${url.replace(/\/$/, "")}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        engine,
        code,
        duration_s: Math.min(90, Math.max(1, durationS)),
        background,
      }),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (res.ok) return { ok: true, video: new Uint8Array(await res.arrayBuffer()) };
    if (res.status === 422 || res.status === 504 || res.status === 400) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error ?? `render failed (${res.status})` };
    }
    throw new Error(`${engine} animator error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}

/** For when no sandbox is configured: nothing is offered, so scenes use the other visual types. */
export const noAnimator: Animator = {
  available: async () => [],
  render: async () => {
    throw new Error("no animator configured");
  },
};
