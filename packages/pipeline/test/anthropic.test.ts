import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { AnthropicLLM, claudeSchema, claudeEffortFloor, parseClaudeModel } from "../src/providers/anthropic.ts";
import { llmProvider, llmModelName } from "../src/context.ts";
import { zodTextFormat } from "openai/helpers/zod";
import * as assemble from "../src/stages/assemble.ts";
import * as intake from "../src/stages/intake.ts";
import * as research from "../src/stages/research.ts";
import * as script from "../src/stages/script.ts";
import * as visuals from "../src/stages/visuals.ts";

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

test("every schema the pipeline sends fits Claude's structured outputs after the transform", () => {
  const all: Record<string, z.ZodTypeAny> = {
    Watchability: assemble.Watchability, FactCheck: assemble.FactCheck, Inferred: intake.Inferred,
    Queries: research.Queries, Extracted: research.Extracted, Merged: research.Merged,
    Arc: script.Arc, Scenes: script.Scenes, LearnerPass: script.LearnerPass, ExpertPass: script.ExpertPass,
    MotionPlan: visuals.MotionPlan, ChartPlan: visuals.ChartPlan, PointsPlan: visuals.PointsPlan, PicturePlan: visuals.PicturePlan,
    DiagramPlan: visuals.DiagramPlan, VisionScore: visuals.VisionScore, SceneCode: visuals.SceneCode, Located: visuals.Located, Delivery: visuals.Delivery,
  };
  // Keywords the API answers with a 400 (platform.claude.com/docs/en/build-with-claude/structured-outputs), and its per-request limits.
  const REFUSED = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "maxItems", "uniqueItems", "oneOf", "$schema"];
  const FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);
  const walk = (node: any, path: string, out: { bad: string[]; unions: number; optional: number }) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`, out));
    if (!node || typeof node !== "object") return;
    for (const k of REFUSED) if (k in node) out.bad.push(`${path}: ${k}`);
    if (node.minItems > 1) out.bad.push(`${path}: minItems=${node.minItems}`);
    if ("format" in node && !FORMATS.has(node.format)) out.bad.push(`${path}: format=${node.format}`);
    if (node.type === "object" && node.additionalProperties !== false) out.bad.push(`${path}: additionalProperties`);
    if (typeof node.$ref === "string" && !node.$ref.startsWith("#")) out.bad.push(`${path}: external $ref`);
    if (node.type === "object" && node.properties) {
      const required = new Set<string>(node.required ?? []);
      for (const [name, prop] of Object.entries<any>(node.properties)) {
        if (!required.has(name)) out.optional++;
        if (Array.isArray(prop?.type) || Array.isArray(prop?.anyOf)) out.unions++;
      }
    }
    for (const k of ["properties", "$defs", "definitions"]) if (node[k]) for (const v of Object.values(node[k])) walk(v, `${path}.${k}`, out);
    for (const k of ["items", "anyOf", "allOf"]) if (k in node) walk(node[k], `${path}.${k}`, out);
  };
  for (const [name, schema] of Object.entries(all)) {
    const original = zodTextFormat(schema, "answer").schema as Record<string, unknown>;
    const before = JSON.stringify(original);
    const out = { bad: [] as string[], unions: 0, optional: 0 };
    walk(claudeSchema(original), name, out);
    assert.deepEqual(out.bad, [], `${name} still carries keywords Claude refuses`);
    assert.ok(out.unions <= 16, `${name} has ${out.unions} union-typed fields; the API allows 16 per request`);
    assert.ok(out.optional <= 24, `${name} has ${out.optional} optional fields; the API allows 24 per request`);
    assert.equal(JSON.stringify(original), before, `${name}: the transform must not change the schema it is given`);
  }
  // The limits are not lost: they are restated for the model, and zod still enforces them on the answer.
  const steps = claudeSchema(zodTextFormat(visuals.DiagramPlan, "answer").schema as Record<string, unknown>) as any;
  assert.match(steps.properties.callouts.description, /at most 6 items/);
  assert.match(steps.properties.callouts.items.properties.label.description, /at most 28 characters/);
  assert.equal(visuals.DiagramPlan.safeParse({ hedraPrompt: "x", callouts: [] }).success, false);
});

test("LLM_EFFORT is a floor: a stage's low-effort check runs at the operator's effort, and more room is left for thinking", async () => {
  const { client, requests } = fakeClient([{ ok: true }, { ok: true }]);
  const llm = new AnthropicLLM("k", "claude-opus-5-5", "claude-opus-5-5", client, "high");
  await llm.json({ system: "s", user: "u", schema: z.object({ ok: z.literal(true) }), maxTokens: 500, effort: "low" });
  assert.equal(requests[0].output_config.effort, "high");
  assert.equal(requests[0].max_tokens, 32_500);
  // The floor never lowers a hint.
  const high = new AnthropicLLM("k", "claude-opus-5-5", "claude-opus-5-5", client, "low");
  await high.json({ system: "s", user: "u", schema: z.object({ ok: z.literal(true) }), effort: "high" });
  assert.equal(requests[1].output_config.effort, "high");
});

test("'Opus 5.5 high' spelled as a model name is the model plus an effort floor", () => {
  assert.deepEqual(parseClaudeModel("claude-opus-5-5-high"), { model: "claude-opus-5-5", effort: "high" });
  assert.deepEqual(parseClaudeModel("claude-opus-5-5"), { model: "claude-opus-5-5", effort: null });
  assert.deepEqual(parseClaudeModel("claude-sonnet-5-5-max"), { model: "claude-sonnet-5-5", effort: "max" });
  assert.deepEqual(parseClaudeModel("gpt-6.1-sol"), { model: "claude-opus-5-5", effort: null });
  assert.equal(claudeEffortFloor({ LLM_EFFORT: "High" }), "high");
  assert.equal(claudeEffortFloor({ LLM_MODEL: "claude-opus-5-5-xhigh" }), "xhigh");
  assert.equal(claudeEffortFloor({ LLM_EFFORT: "turbo" }), null, "an unknown word is not an effort");
  assert.equal(claudeEffortFloor({}), null);
  assert.equal(llmModelName({ ANTHROPIC_API_KEY: "k", LLM_MODEL: "claude-opus-5-5-high" }), "claude-opus-5-5", "the suffix never reaches the API as part of the model id");
});
