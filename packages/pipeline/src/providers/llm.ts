/**
 * LLM provider (OpenAI). One model for research/script/planning, one for
 * vision QA; both default to gpt-6.1-sol and can be overridden by env.
 *
 * Every call sends its zod schema as a strict JSON schema (structured outputs),
 * so the model can only answer with the exact fields the stage reads. The
 * answer is still validated with zod (for limits JSON schema can't express);
 * a failure retries once with the error fed back.
 */
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { parseClipping } from "./clip.js";

/** How hard the model should think: "low" for checks and small rewrites, the default for writing. */
export type Effort = "low" | "medium" | "high";

export interface LLM {
  json<T>(args: { system: string; user: string; schema: z.ZodType<T>; maxTokens?: number; effort?: Effort }): Promise<T>;
  vision<T>(args: { system: string; user: string; imageUrls: string[]; schema: z.ZodType<T>; effort?: Effort }): Promise<T>;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced?.[1] ?? text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  return JSON.parse(raw.slice(start, end + 1));
}

/**
 * Images are sent inline: our asset URLs (e.g. http://localhost:9000 in local
 * dev, or a private bucket) aren't reachable from OpenAI's servers.
 */
async function inlineImage(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch image for vision QA: ${res.status} ${url}`);
  const type = res.headers.get("content-type") ?? "image/png";
  if (!type.startsWith("image/")) throw new Error(`vision QA needs an image, got ${type}: ${url}`);
  return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString("base64")}`;
}

/**
 * Reasoning tokens count against OpenAI's max_output_tokens, so the per-call
 * budgets the stages pass (sized for the visible JSON) get this added on top.
 */
const REASONING_HEADROOM = 16_000;

type Input = OpenAI.Responses.ResponseInputMessageContentList;

export class OpenAILLM implements LLM {
  private client: OpenAI;
  /** Set once the API rejects the reasoning parameter (a model without it), so we stop sending it. */
  private reasoningUnsupported = false;
  constructor(
    apiKey: string,
    private model = process.env.LLM_MODEL || "gpt-6.1-sol",
    private visionModel = process.env.LLM_VISION_MODEL || "gpt-6.1-sol",
  ) {
    this.client = new OpenAI({ apiKey });
  }

  private async call(model: string, system: string, content: Input, schema: z.ZodType<unknown>, maxTokens: number, effort?: Effort) {
    const params = {
      model,
      instructions: system,
      input: [{ role: "user" as const, content }],
      text: { format: zodTextFormat(schema as z.ZodTypeAny, "answer") },
      max_output_tokens: maxTokens + REASONING_HEADROOM,
    };
    let res: OpenAI.Responses.Response;
    if (effort && !this.reasoningUnsupported) {
      try {
        res = await this.client.responses.create({ ...params, reasoning: { effort } });
      } catch (e) {
        // A model that doesn't take `reasoning` says so with a 400; fall back and remember.
        if (!(e instanceof OpenAI.APIError && e.status === 400 && /reasoning/i.test(e.message))) throw e;
        this.reasoningUnsupported = true;
        res = await this.client.responses.create(params);
      }
    } else res = await this.client.responses.create(params);
    if (res.status === "incomplete") throw new Error(`LLM response incomplete: ${res.incomplete_details?.reason ?? "unknown"}`);
    const refusal = res.output.flatMap((o) => (o.type === "message" ? o.content : [])).find((c) => c.type === "refusal");
    if (refusal && refusal.type === "refusal") throw new Error(`LLM refused: ${refusal.refusal}`);
    return res.output_text;
  }

  private async parseWithRetry<T>(model: string, system: string, content: Input, schema: z.ZodType<T>, maxTokens: number, effort?: Effort): Promise<T> {
    let text = await this.call(model, system, content, schema, maxTokens, effort);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const checked = parseClipping(schema, extractJson(text));
        if (checked.success) return checked.data;
        throw checked.error;
      } catch (e) {
        if (attempt === 1) throw e;
        const fix = `Your previous output failed validation: ${(e as Error).message}. Return corrected JSON only.`;
        text = await this.call(model, system, [...content, { type: "input_text", text: fix }], schema, maxTokens, effort);
      }
    }
    throw new Error("unreachable");
  }

  json<T>(a: { system: string; user: string; schema: z.ZodType<T>; maxTokens?: number; effort?: Effort }) {
    return this.parseWithRetry(this.model, a.system, [{ type: "input_text", text: a.user }], a.schema, a.maxTokens ?? 8000, a.effort);
  }

  async vision<T>(a: { system: string; user: string; imageUrls: string[]; schema: z.ZodType<T>; effort?: Effort }) {
    const content: Input = [
      ...(await Promise.all(a.imageUrls.map(inlineImage))).map((url) => ({ type: "input_image" as const, image_url: url, detail: "auto" as const })),
      { type: "input_text" as const, text: a.user },
    ];
    // Frame checks are quick judgements: low effort unless asked otherwise.
    return this.parseWithRetry(this.visionModel, a.system, content, a.schema, 2000, a.effort ?? "low");
  }
}
