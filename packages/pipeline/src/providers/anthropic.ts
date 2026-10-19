/**
 * LLM provider (Anthropic). Claude Opus 5.5 for the writing, planning and
 * scene code, and for looking at frames. Every call sends its zod schema as a
 * structured output format, so the model can only answer with the exact
 * fields the stage reads; the answer is validated with zod and a failure
 * retries once with the error fed back, as with the OpenAI provider.
 *
 * Thinking is adaptive on Opus 5.5 and can't be turned off; the stages' effort
 * hints map to output_config.effort (low for checks, medium for writing).
 *
 * The JSON schema is the same strict one the OpenAI provider sends (every
 * object closed, every property required), built with its helper: the SDK's
 * own zod helper wants zod 4 schemas and ours are zod 3.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import type { Effort, LLM } from "./llm.js";

export const CLAUDE_MODEL = "claude-opus-5-5";

/** A model name from the environment is used only when it is a Claude model; a gpt-* name left over from an OpenAI setup is ignored. */
export function claudeModel(name: string | undefined): string {
  return name && /^claude-/i.test(name) ? name : CLAUDE_MODEL;
}

/** Thinking shares max_tokens with the answer, so the stages' JSON budgets get room for it. */
const THINKING_HEADROOM = 16_000;

/** Images go inline: our asset URLs (localhost:9000, a private bucket) aren't reachable from Anthropic's servers. */
async function inlineImage(url: string): Promise<Anthropic.ImageBlockParam> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch image for vision QA: ${res.status} ${url}`);
  const type = res.headers.get("content-type")?.split(";")[0] ?? "image/png";
  if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) throw new Error(`vision QA needs a jpeg, png, gif or webp image, got ${type}: ${url}`);
  return { type: "image", source: { type: "base64", media_type: type as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: Buffer.from(await res.arrayBuffer()).toString("base64") } };
}

type Client = Pick<Anthropic, "messages">;

export class AnthropicLLM implements LLM {
  private client: Client;
  constructor(
    apiKey: string | undefined,
    private model = claudeModel(process.env.LLM_MODEL),
    private visionModel = claudeModel(process.env.LLM_VISION_MODEL || process.env.LLM_MODEL),
    client?: Client,
  ) {
    this.client = client ?? new Anthropic(apiKey ? { apiKey } : {});
  }

  private async call<T>(model: string, system: string, content: Anthropic.ContentBlockParam[], schema: z.ZodType<T>, maxTokens: number, effort: Effort): Promise<T> {
    const { schema: jsonSchema } = zodTextFormat(schema as z.ZodTypeAny, "answer");
    const res = await this.client.messages.create({
      model,
      max_tokens: Math.min(64_000, maxTokens + THINKING_HEADROOM),
      system,
      messages: [{ role: "user", content }],
      output_config: { format: { type: "json_schema", schema: jsonSchema as Record<string, unknown> }, effort },
    });
    if (res.stop_reason === "refusal") throw new Error(`the model declined this request${res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : ""}`);
    if (res.stop_reason === "max_tokens") throw new Error("the model ran out of room for its answer; raise maxTokens");
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`the answer did not fit the schema: not JSON: ${text.slice(0, 200)}`);
    }
    const checked = schema.safeParse(parsed);
    if (!checked.success) throw new Error(`the answer did not fit the schema: ${checked.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    return checked.data;
  }

  private async parseWithRetry<T>(model: string, system: string, content: Anthropic.ContentBlockParam[], schema: z.ZodType<T>, maxTokens: number, effort: Effort): Promise<T> {
    try {
      return await this.call(model, system, content, schema, maxTokens, effort);
    } catch (e) {
      if (!/did not fit the schema/.test((e as Error).message)) throw e;
      const fix = `Your previous output failed validation: ${(e as Error).message}. Answer again, exactly in the required shape.`;
      return this.call(model, system, [...content, { type: "text", text: fix }], schema, maxTokens, effort);
    }
  }

  json<T>(a: { system: string; user: string; schema: z.ZodType<T>; maxTokens?: number; effort?: Effort }) {
    return this.parseWithRetry(this.model, a.system, [{ type: "text", text: a.user }], a.schema, a.maxTokens ?? 8000, a.effort ?? "medium");
  }

  async vision<T>(a: { system: string; user: string; imageUrls: string[]; schema: z.ZodType<T>; effort?: Effort }) {
    const content: Anthropic.ContentBlockParam[] = [...(await Promise.all(a.imageUrls.map(inlineImage))), { type: "text", text: a.user }];
    // Frame checks are quick judgements: low effort unless asked otherwise.
    return this.parseWithRetry(this.visionModel, a.system, content, a.schema, 2000, a.effort ?? "low");
  }
}
