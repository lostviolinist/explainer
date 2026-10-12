import { test } from "node:test";
import assert from "node:assert/strict";
import { HedraError } from "@explainer/hedra";
import { MemoryStore } from "../src/providers/store.ts";
import { loadHouseStyle, type Ctx } from "../src/context.ts";
import { ensureMusicBed, ensureSfxKit, MUSIC_PROMPTS } from "../src/stages/library.ts";
import { noAnimator } from "../src/providers/animator.ts";

const PID = "11111111-1111-4111-8111-111111111111";

/** A ctx with an in-memory library and a Hedra that records what it was asked. */
function libCtx(opts: { fail?: HedraError } = {}) {
  const library = new Map<string, { bytes: Uint8Array; type: string }>();
  const jobs: { model: string; input: Record<string, unknown> }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.startsWith("https://hedra.test/")) return new Response(new Uint8Array([1, 2, 3, 4]), { headers: { "content-type": "audio/mpeg" } });
    return realFetch(url);
  }) as typeof fetch;
  const ctx: Ctx = {
    llm: {} as any,
    search: {} as any,
    hedra: {
      run: async (model: string, input: Record<string, unknown>) => {
        jobs.push({ model, input });
        if (opts.fail) throw opts.fail;
        return { job_id: `j${jobs.length}`, model, status: "COMPLETED", error: null, cost: model === "elevenlabs-music" ? 2.4 : 0.01, currency: "USD", outputs: [{ status: "COMPLETED", asset_id: `asset_${jobs.length}`, voice_id: null, url: `https://hedra.test/${jobs.length}`, content_type: "audio/mpeg", width: null, height: null, duration_ms: input.duration_ms as number, fps: null, error: null }] };
      },
    } as any,
    mirror: {
      libraryUrl: (name: string) => `http://assets.test/library/${name}`,
      getLibraryJson: async (name: string) => {
        const m = library.get(name);
        return m ? JSON.parse(new TextDecoder().decode(m.bytes)) : null;
      },
      putLibrary: async (name: string, bytes: Uint8Array, type: string) => {
        library.set(name, { bytes, type });
        return `http://assets.test/library/${name}`;
      },
    } as any,
    aligner: {} as any,
    frames: { sample: async () => [] },
    animator: noAnimator,
    store: new MemoryStore(),
    style: loadHouseStyle(),
    now: () => "2026-10-12T10:00:00.000Z",
  };
  return { ctx, jobs, library, restore: () => (globalThis.fetch = realFetch) };
}

test("the music bed is composed once per tone, long enough to end-align, and reused from the library", async () => {
  const { ctx, jobs, library, restore } = libCtx();
  try {
    const bed = await ensureMusicBed(ctx, PID, "neutral");
    assert.ok(bed);
    assert.equal(bed.url, "http://assets.test/library/music/neutral-v1.mp3");
    assert.equal(bed.durationS, 240);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.model, "elevenlabs-music");
    assert.equal(jobs[0]!.input.duration_ms, 240_000);
    assert.equal(jobs[0]!.input.force_instrumental, true);
    assert.match(String(jobs[0]!.input.prompt), /resolved final chord that rings out/, "composed to end properly");
    assert.ok(String(jobs[0]!.input.prompt).startsWith(MUSIC_PROMPTS.neutral));
    assert.ok(library.has("music/neutral-v1.json") && library.has("music/neutral-v1.mp3"));
    assert.deepEqual((ctx.store as MemoryStore).costs.map((c) => [c.stage, c.usd]), [["music", 2.4]]);

    const again = await ensureMusicBed(ctx, PID, "neutral");
    assert.deepEqual(again, bed);
    assert.equal(jobs.length, 1, "no second generation");
    await ensureMusicBed(ctx, PID, "playful");
    assert.equal(jobs.length, 2, "another tone is another bed");
  } finally {
    restore();
  }
});

test("the sound kit has one sound per kind, each made once; a refusal just leaves that sound out", async () => {
  const { ctx, jobs, restore } = libCtx();
  try {
    const kit = await ensureSfxKit(ctx, PID);
    assert.deepEqual(Object.keys(kit).sort(), ["chime", "pop", "swoosh", "tick", "whoosh"]);
    assert.equal(jobs.length, 5);
    assert.ok(jobs.every((j) => j.model === "elevenlabs-sound-effects" && typeof j.input.text === "string" && j.input.prompt_influence === 0.5));
    const again = await ensureSfxKit(ctx, PID);
    assert.deepEqual(again, kit);
    assert.equal(jobs.length, 5);
  } finally {
    restore();
  }
  const refused = libCtx({ fail: new HedraError("moderation", "MODERATION_FAILED", 200, false) });
  try {
    assert.deepEqual(await refused.ctx.mirror.getLibraryJson("sfx/pop-v1.json"), null);
    const kit = await ensureSfxKit(refused.ctx, PID);
    assert.deepEqual(kit, {}, "nothing in the kit, no throw");
    assert.equal(await ensureMusicBed(refused.ctx, PID, "serious"), null, "no bed, no throw");
  } finally {
    refused.restore();
  }
});

test("a retryable Hedra error is rethrown so the step retries; MUSIC_BED=0 turns music off", async () => {
  const { ctx, restore } = libCtx({ fail: new HedraError("busy", "RESOURCE_EXHAUSTED", 429, true) });
  try {
    await assert.rejects(ensureMusicBed(ctx, PID, "neutral"), /busy/);
    process.env.MUSIC_BED = "0";
    assert.equal(await ensureMusicBed(ctx, PID, "neutral"), null);
    assert.deepEqual(await ensureSfxKit(ctx, PID), {});
  } finally {
    delete process.env.MUSIC_BED;
    restore();
  }
});
