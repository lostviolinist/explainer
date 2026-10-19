import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AnthropicLLM } from "../src/providers/anthropic.ts";
import { llmProvider, llmModelName } from "../src/context.ts";

/** A fake client that records requests and answers from a queue. */
function fakeClient(answers: (unknown | Error)[]) {
  const requests: any[] = [];
  const client = {
    messages: {
      create: async (req: any) => {
        requests.push(req);
        const a = answers.shift();
        if (a instanceof Error) throw a;
        if (a && typeof a === "object" && "stop_reason" in (a as any)) return a;
        return { stop_reason: "end_turn", stop_details: null, content: [{ type: "text", text: JSON.stringify(a) }] };
      },
    },
  };
  return { client: client as any, requests };
}

test("json: structured output with a strict schema, effort in output_config, room for thinking", async () => {
  const { client, requests } = fakeClient([{ ok: true }]);
  const llm = new AnthropicLLM("k", "claude-opus-5-5", "claude-opus-5-5", client);
  const out = await llm.json({ system: "sys", user: "hi", schema: z.object({ ok: z.literal(true) }), maxTokens: 500, effort: "low" });
  assert.deepEqual(out, { ok: true });
  const r = requests[0];
  assert.equal(r.model, "claude-opus-5-5");
  assert.equal(r.system, "sys");
  assert.deepEqual(r.messages, [{ role: "user", content: [{ type: "text", text: "hi" }] }]);
  assert.equal(r.max_tokens, 16_500);
  assert.equal(r.output_config.effort, "low");
  assert.equal(r.output_config.format.type, "json_schema");
  assert.equal(r.output_config.format.schema.additionalProperties, false, "every object closed, as for OpenAI's strict mode");
  assert.equal(r.thinking, undefined, "adaptive thinking is the default on Opus 5.5; never disabled");
});

test("json: an answer that fails the zod check is retried once with the error fed back; a refusal is reported plainly", async () => {
  const { client, requests } = fakeClient([{ n: "two" }, { n: 2 }]);
  const llm = new AnthropicLLM("k", "m", "m", client);
  assert.deepEqual(await llm.json({ system: "s", user: "u", schema: z.object({ n: z.number() }) }), { n: 2 });
  assert.equal(requests.length, 2);
  assert.match(requests[1].messages[0].content[1].text, /failed validation/);
  assert.equal(requests[1].output_config.effort, "medium", "writing defaults to medium effort");

  const refused = fakeClient([{ stop_reason: "refusal", stop_details: { type: "refusal", category: "bio", explanation: "no" }, content: [] }]);
  await assert.rejects(new AnthropicLLM("k", "m", "m", refused.client).json({ system: "s", user: "u", schema: z.object({}) }), /declined this request: no/);
  assert.equal(refused.requests.length, 1, "a refusal is not retried");
});

test("vision: images go inline as base64 blocks before the text, at low effort", async () => {
  const { client, requests } = fakeClient([{ ok: true }]);
  const real = globalThis.fetch;
  globalThis.fetch = (async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } })) as typeof fetch;
  try {
    const llm = new AnthropicLLM("k", "m", "v", client);
    await llm.vision({ system: "s", user: "look", imageUrls: ["http://localhost:9000/a.png"], schema: z.object({ ok: z.literal(true) }) });
  } finally {
    globalThis.fetch = real;
  }
  const content = requests[0].messages[0].content;
  assert.equal(requests[0].model, "v");
  assert.deepEqual(content[0], { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from([137, 80, 78, 71]).toString("base64") } });
  assert.deepEqual(content[1], { type: "text", text: "look" });
  assert.equal(requests[0].output_config.effort, "low");
});

test("the provider follows the keys: Claude when an Anthropic key is set, unless told otherwise", () => {
  assert.equal(llmProvider({}), "openai");
  assert.equal(llmProvider({ ANTHROPIC_API_KEY: "k" }), "anthropic");
  assert.equal(llmProvider({ ANTHROPIC_API_KEY: "k", LLM_PROVIDER: "openai" }), "openai");
  assert.equal(llmModelName({ ANTHROPIC_API_KEY: "k" }), "claude-opus-5-5");
  assert.equal(llmModelName({ LLM_MODEL: "x" }), "x");
  // A gpt-* name left in .env from an OpenAI setup must not be sent to Anthropic.
  assert.equal(llmModelName({ ANTHROPIC_API_KEY: "k", LLM_MODEL: "gpt-6.1-sol" }), "claude-opus-5-5");
  assert.equal(llmModelName({ ANTHROPIC_API_KEY: "k", LLM_MODEL: "claude-sonnet-5-5" }), "claude-sonnet-5-5");
});
