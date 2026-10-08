/**
 * LLM provider. One strong model for research/script/planning, one cheap
 * vision model for QA. Everything returns parsed JSON validated by a zod
 * schema; a parse failure retries once with the error fed back.
 */
import Anthropic from "@anthropic-ai/sdk";
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

export class AnthropicLLM implements LLM {
  private client: Anthropic;
  constructor(
    apiKey: string,
    private model = process.env.LLM_MODEL ?? "claude-sonnet-4-5",
    private visionModel = process.env.LLM_VISION_MODEL ?? "claude-haiku-4-5",
  ) {
    this.client = new Anthropic({ apiKey });
  }

  private async call(model: string, system: string, content: Anthropic.MessageParam["content"], maxTokens: number) {
    const res = await this.client.messages.create({
      model,
      max_tokens: maxTokens,
      system: system + "\n\nRespond with a single JSON object and nothing else.",
      messages: [{ role: "user", content }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    return text;
  }

  private async parseWithRetry<T>(
    model: string,
    system: string,
    content: Anthropic.MessageParam["content"],
    schema: z.ZodType<T>,
    maxTokens: number,
  ): Promise<T> {
    let text = await this.call(model, system, content, maxTokens);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return schema.parse(extractJson(text));
      } catch (e) {
        if (attempt === 1) throw e;
        const fix = `Your previous output failed validation: ${(e as Error).message}. Return corrected JSON only.`;
        text = await this.call(
          model,
          system,
          [...(Array.isArray(content) ? content : [{ type: "text" as const, text: content as string }]), { type: "text" as const, text: fix }],
          maxTokens,
        );
      }
    }
    throw new Error("unreachable");
  }

  json<T>(a: { system: string; user: string; schema: z.ZodType<T>; maxTokens?: number }) {
    return this.parseWithRetry(this.model, a.system, a.user, a.schema, a.maxTokens ?? 8000);
  }

  vision<T>(a: { system: string; user: string; imageUrls: string[]; schema: z.ZodType<T> }) {
    const content: Anthropic.MessageParam["content"] = [
      ...a.imageUrls.map((url) => ({ type: "image" as const, source: { type: "url" as const, url } })),
      { type: "text" as const, text: a.user },
    ];
    return this.parseWithRetry(this.visionModel, a.system, content, a.schema, 2000);
  }
}
