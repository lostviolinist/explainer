import { test } from "node:test";
import assert from "node:assert/strict";
import { HedraClient, HedraError } from "../src/client.ts";
import { idemKey, generateClip, generateStill } from "../src/generate.ts";

function fakeFetch(routes: Record<string, (init?: RequestInit) => { status: number; body: unknown }>) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url).pathname.replace(/^\/v3/, "");
    const handler = routes[`${init?.method ?? "GET"} ${path}`];
    if (!handler) return new Response("{}", { status: 404 });
    const { status, body } = handler(init);
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, calls };
}

test("idempotency key is stable for identical input and differs otherwise", () => {
  const a = idemKey("s1:clip", "wan-3-0", { prompt: "x" });
  const b = idemKey("s1:clip", "wan-3-0", { prompt: "x" });
  const c = idemKey("s1:clip", "wan-3-0", { prompt: "y" });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("submit sends Key auth and idempotency key; waitFor polls to completion", async () => {
  let polls = 0;
  const { f, calls } = fakeFetch({
    "POST /models/wan-3-0": () => ({
      status: 202,
      body: { job_id: "job_1", model: "wan-3-0", status: "IN_QUEUE", status_url: "", result_url: "", estimated_completion_at: null },
    }),
    "GET /jobs/job_1/status": () => ({ status: 200, body: { status: ++polls < 2 ? "IN_PROGRESS" : "COMPLETED" } }),
    "GET /jobs/job_1": () => ({
      status: 200,
      body: {
        job_id: "job_1",
        model: "wan-3-0",
        status: "COMPLETED",
        outputs: [{ status: "COMPLETED", asset_id: "asset_1", url: "https://x/y.mp4", content_type: "video/mp4", width: 1280, height: 720, duration_ms: 5000, fps: 30, voice_id: null, error: null }],
        error: null,
        cost: 0.5,
        currency: "USD",
      },
    }),
  });
  const client = new HedraClient({ apiKey: "kid:secret", fetch: f });
  const out = await generateClip(client, "s1:clip", ["wan-3-0"], { prompt: "a star collapses", references: ["asset_ref"] });
  assert.equal(out.model, "wan-3-0");
  assert.equal(out.costUsd, 0.5);
  const submit = calls.find((c) => c.init?.method === "POST")!;
  assert.equal((submit.init!.headers as Record<string, string>).Authorization, "Key kid:secret");
  const body = JSON.parse(submit.init!.body as string);
  assert.match(body.idempotency_key, /^s1:clip:/);
  assert.deepEqual(body.input.images, [{ source: "asset", asset_id: "asset_ref" }]);
  assert.equal(body.input.generate_audio, false);
});

test("non-retryable failure falls through to the next model", async () => {
  const { f } = fakeFetch({
    "POST /models/wan-3-0": () => ({ status: 422, body: { error: { code: "MODERATION_FAILED", message: "refused", retryable: false } } }),
    "POST /models/minimax-h3": () => ({
      status: 202,
      body: { job_id: "job_2", model: "minimax-h3", status: "IN_QUEUE", status_url: "", result_url: "", estimated_completion_at: null },
    }),
    "GET /jobs/job_2/status": () => ({ status: 200, body: { status: "COMPLETED" } }),
    "GET /jobs/job_2": () => ({
      status: 200,
      body: { job_id: "job_2", model: "minimax-h3", status: "COMPLETED", outputs: [{ status: "COMPLETED", asset_id: "a", url: "https://x", content_type: "video/mp4", width: 1, height: 1, duration_ms: 1, fps: 24, voice_id: null, error: null }], error: null, cost: 0.36, currency: "USD" },
    }),
  });
  const client = new HedraClient({ apiKey: "k:s", fetch: f });
  const out = await generateClip(client, "s2:clip", ["wan-3-0", "minimax-h3"], { prompt: "p", references: [] });
  assert.equal(out.model, "minimax-h3");
});

test("rate limit surfaces as retryable HedraError, not a model swap", async () => {
  const { f } = fakeFetch({
    "POST /models/wan-3-0": () => ({ status: 429, body: { error: { code: "RESOURCE_EXHAUSTED", message: "slow down", retryable: true, retry_after: 7 } } }),
  });
  const client = new HedraClient({ apiKey: "k:s", fetch: f });
  await assert.rejects(
    generateClip(client, "s3:clip", ["wan-3-0", "minimax-h3"], { prompt: "p", references: [] }),
    (e: unknown) => e instanceof HedraError && e.retryable && e.retryAfterS === 7,
  );
});

test("still inputs follow each model's schema: gpt-image-2 needs resolution, recraft takes no references", async () => {
  const done = (model: string) => ({
    status: 200,
    body: { job_id: `job_${model}`, model, status: "COMPLETED", outputs: [{ status: "COMPLETED", asset_id: "a", url: "https://x", content_type: "image/jpeg", width: 1, height: 1, duration_ms: null, fps: null, voice_id: null, error: null }], error: null, cost: 0.08, currency: "USD" },
  });
  const ack = (model: string) => ({ status: 202, body: { job_id: `job_${model}`, model, status: "IN_QUEUE", status_url: "", result_url: "", estimated_completion_at: null } });
  const { f, calls } = fakeFetch({
    "POST /models/gpt-image-2": () => ({ status: 422, body: { error: { code: "MODERATION_FAILED", message: "refused", retryable: false } } }),
    "POST /models/recraft-v3": () => ack("recraft-v3"),
    "GET /jobs/job_recraft-v3/status": () => ({ status: 200, body: { status: "COMPLETED" } }),
    "GET /jobs/job_recraft-v3": () => done("recraft-v3"),
  });
  const client = new HedraClient({ apiKey: "k:s", fetch: f });
  const out = await generateStill(client, "s1:still", ["gpt-image-2", "recraft-v3"], { prompt: "x".repeat(1500), references: ["asset_ref"] });
  assert.equal(out.model, "recraft-v3");
  const [gpt, recraft] = calls.filter((c) => c.init?.method === "POST").map((c) => JSON.parse(c.init!.body as string));
  assert.deepEqual(Object.keys(gpt.input).sort(), ["aspect_ratio", "images", "output_format", "prompt", "resolution"]);
  assert.equal(gpt.input.resolution, "2K");
  assert.equal(gpt.webhook, undefined);
  assert.deepEqual(Object.keys(recraft.input).sort(), ["aspect_ratio", "prompt", "resolution"]);
  assert.equal(recraft.input.resolution, "1080p");
  assert.equal(recraft.input.prompt.length, 1000);
});
