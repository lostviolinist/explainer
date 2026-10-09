/**
 * Setup check: proves every key and service the pipeline needs works, with
 * the same code paths the pipeline uses, before anyone spends credits on a
 * video. Cheap calls only (a one-word JSON reply, one search, model lookups).
 */
import { sql } from "drizzle-orm";
import { z } from "zod";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { HedraClient } from "@explainer/hedra";
import { OpenAILLM, ExaSearch, loadHouseStyle } from "@explainer/pipeline";
import { ensureRenderBrowser } from "@explainer/render";
import { db } from "./db";

export type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string; fix?: string };

/** Check names the home page reads to offer the 3Blue1Brown style. */
export const MANIM_CHECK = "3Blue1Brown animator";
export const THREE_CHECK = "3D animator";

/** An animation sandbox is optional: missing or down is a warning, and the pipeline simply doesn't use it. */
async function sandbox(envVar: string, without: string): Promise<string | { warn: string }> {
  const url = process.env[envVar];
  if (!url) return { warn: `not configured (${envVar}); ${without}` };
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/health`, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
    const body = (await res.json().catch(() => ({}))) as { manim?: string; error?: string };
    if (!res.ok) return { warn: `unavailable: ${body.error ?? res.status}; ${without}` };
    return body.manim ? `ready (${body.manim})` : "ready";
  } catch (e) {
    return { warn: `unreachable at ${url} (${(e as Error).message}); ${without}` };
  }
}

/** A 32×32 solid-blue PNG for the vision check. */
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKklEQVR4nGNwav9KU8QwasGoBaMWjFowasGoBaMWjFowasGoBaMWDBULADnR+Fv1COpgAAAAAElFTkSuQmCC";
/** Rough Hedra spend for one 2–3 minute video, for the low-balance warning. */
const VIDEO_COST_USD = 5;

const need = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

async function run(name: string, fix: string, fn: () => Promise<string | { warn: string }>): Promise<Check> {
  try {
    const r = await fn();
    return typeof r === "string" ? { name, status: "ok", detail: r } : { name, status: "warn", detail: r.warn, fix };
  } catch (e) {
    return { name, status: "fail", detail: ((e as Error).message || String(e)).slice(0, 400), fix };
  }
}

export async function runPreflight(): Promise<Check[]> {
  const restart = "Edit .env, then restart (docker compose up).";
  return Promise.all([
    run("Database", "Check DATABASE_URL (the Docker stack sets it).", async () => {
      await db.execute(sql`select 1`);
      return "connected";
    }),

    run("Storage", `Check S3_* and ASSETS_PUBLIC_BASE (the Docker stack sets them); the bucket must be publicly readable. ${restart}`, async () => {
      const s3 = new S3Client({
        region: process.env.S3_REGION ?? "us-east-1",
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: Boolean(process.env.S3_ENDPOINT),
        credentials: { accessKeyId: need("S3_ACCESS_KEY_ID"), secretAccessKey: need("S3_SECRET_ACCESS_KEY") },
      });
      const body = `ok ${Date.now()}`;
      const put = () => s3.send(new PutObjectCommand({ Bucket: need("S3_BUCKET"), Key: "preflight/check.txt", Body: body, ContentType: "text/plain" }));
      // Right after `docker compose up` the storage server may still be starting.
      for (let i = 0; ; i++) {
        try {
          await put();
          break;
        } catch (e) {
          if (i >= 6 || !/ECONNREFUSED|ECONNRESET|socket hang up/.test(String((e as Error).message) + String((e as any).code))) throw e;
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
      const url = `${need("ASSETS_PUBLIC_BASE").replace(/\/$/, "")}/preflight/check.txt`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok || (await res.text()) !== body) throw new Error(`wrote the bucket but could not read it back from ${url} (${res.status})`);
      return "write and public read OK";
    }),

    run("OpenAI", `Set OPENAI_API_KEY, make sure the account has credits (platform.openai.com → Billing) and access to the model in LLM_MODEL / LLM_VISION_MODEL. ${restart}`, async () => {
      const llm = new OpenAILLM(need("OPENAI_API_KEY"));
      const Ok = z.object({ ok: z.literal(true) });
      await llm.json({ system: 'Reply with exactly {"ok": true}.', user: "ping", schema: Ok, maxTokens: 20 });
      await llm.vision({ system: 'If you can see an image, reply with exactly {"ok": true}.', user: "ping", imageUrls: [PNG], schema: Ok });
      return `${process.env.LLM_MODEL || "gpt-6.1-sol"}: JSON and image input OK`;
    }),

    run("Exa", `Set EXA_API_KEY and check the account has credits (dashboard.exa.ai). ${restart}`, async () => {
      const exa = new ExaSearch(need("EXA_API_KEY"));
      const hits = await exa.search("why is the sky blue", 1);
      if (!hits[0]) throw new Error("search returned no results");
      const page = await exa.open(hits[0].url);
      if (!page) throw new Error(`search works, but reading page contents failed for ${hits[0].url}`);
      return "search and page contents OK";
    }),

    run("Hedra", `Set HEDRA_API_KEY (format key_id:secret) from the Hedra dashboard, for the workspace that owns the reference images in config/house-style.json. ${restart}`, async () => {
      const style = loadHouseStyle();
      const hedra = new HedraClient({ apiKey: need("HEDRA_API_KEY"), baseUrl: process.env.HEDRA_API_BASE || undefined });
      const models = [...new Set([...(style.models.still ?? []), ...(style.models.animatedStill ?? []), ...(style.models.generatedClip ?? []), ...(style.models.referenceSequence ?? []), style.voice.model, style.voice.playfulModel])];
      for (const m of models) {
        await hedra.model(m).catch((e: Error) => {
          throw new Error(`model ${m}: ${e.message}`);
        });
      }
      const balance = await hedra.balance().then((b) => b.balance, () => undefined);
      const detail = `${models.length} models available${typeof balance === "number" ? `; balance $${balance.toFixed(2)}` : ""}`;
      if (typeof balance === "number" && balance < VIDEO_COST_USD) return { warn: `${detail} — a video uses roughly $${VIDEO_COST_USD}; top up before generating` };
      return detail;
    }),

    run("Video renderer", "Restart the app with internet access so it can download Remotion's headless Chrome, or set REMOTION_BROWSER_EXECUTABLE.", async () => {
      if (process.env.RENDER_TARGET === "lambda") return "Remotion Lambda";
      await ensureRenderBrowser();
      return "browser ready";
    }),

    run(MANIM_CHECK, "Start the `manim` service: docker compose up --build.", () => sandbox("MANIM_URL", "the 3Blue1Brown style is off")),
    run(THREE_CHECK, "Start the `three` service: docker compose up --build.", () => sandbox("THREE_URL", "videos won't use 3D scenes")),
  ]);
}

let cached: { at: number; checks: Check[] } | null = null;
let inflight: Promise<Check[]> | null = null;

/** Cached: 10 minutes when everything passed, 20 seconds otherwise. */
export async function preflight(refresh = false): Promise<Check[]> {
  const ttl = cached?.checks.every((c) => c.status !== "fail") ? 10 * 60_000 : 20_000;
  if (!refresh && cached && Date.now() - cached.at < ttl) return cached.checks;
  inflight ??= runPreflight().then((checks) => {
    cached = { at: Date.now(), checks };
    inflight = null;
    return checks;
  });
  return inflight;
}
