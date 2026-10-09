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

export interface LLM {
  json<T>(args: { system: string; user: string; schema: z.ZodType<T>; maxTokens?: number }): Promise<T>;
  vision<T>(args: { system: string; user: string; imageUrls: string[]; schema: z.ZodType<T> }): Promise<T>;
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
  constructor(
    apiKey: string,
    private model = process.env.LLM_MODEL || "gpt-6.1-sol",
    private visionModel = process.env.LLM_VISION_MODEL || "gpt-6.1-sol",
  ) {
    this.client = new OpenAI({ apiKey });
  }

  private async call(model: string, system: string, content: Input, schema: z.ZodType<unknown>, maxTokens: number) {
    const res = await this.client.responses.create({
      model,
      instructions: system,
      input: [{ role: "user", content }],
      text: { format: zodTextFormat(schema as z.ZodTypeAny, "answer") },
      max_output_tokens: maxTokens + REASONING_HEADROOM,
    });
    if (res.status === "incomplete") throw new Error(`LLM response incomplete: ${res.incomplete_details?.reason ?? "unknown"}`);
    const refusal = res.output.flatMap((o) => (o.type === "message" ? o.content : [])).find((c) => c.type === "refusal");
    if (refusal && refusal.type === "refusal") throw new Error(`LLM refused: ${refusal.refusal}`);
    return res.output_text;
  }

  private async parseWithRetry<T>(model: string, system: string, content: Input, schema: z.ZodType<T>, maxTokens: number): Promise<T> {
    let text = await this.call(model, system, content, schema, maxTokens);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return schema.parse(extractJson(text));
      } catch (e) {
        if (attempt === 1) throw e;
        const fix = `Your previous output failed validation: ${(e as Error).message}. Return corrected JSON only.`;
        text = await this.call(model, system, [...content, { type: "input_text", text: fix }], schema, maxTokens);
      }
    }
    throw new Error("unreachable");
  }

  json<T>(a: { system: string; user: string; schema: z.ZodType<T>; maxTokens?: number }) {
    return this.parseWithRetry(this.model, a.system, [{ type: "input_text", text: a.user }], a.schema, a.maxTokens ?? 8000);
  }

  async vision<T>(a: { system: string; user: string; imageUrls: string[]; schema: z.ZodType<T> }) {
    const content: Input = [
      ...(await Promise.all(a.imageUrls.map(inlineImage))).map((url) => ({ type: "input_image" as const, image_url: url, detail: "auto" as const })),
      { type: "input_text" as const, text: a.user },
    ];
    return this.parseWithRetry(this.visionModel, a.system, content, a.schema, 2000);
  }
}
