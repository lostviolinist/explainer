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
import { parseClipping } from "./clip.js";
import type { Effort, LLM } from "./llm.js";

export const CLAUDE_MODEL = "claude-opus-5-5";

/** Claude's effort ladder; the pipeline's hints (low / medium / high) are its lower rungs. */
export type ClaudeEffort = Effort | "xhigh" | "max";
const EFFORTS: ClaudeEffort[] = ["low", "medium", "high", "xhigh", "max"];

/** "high" → "high"; anything else → null. */
export function claudeEffort(name: string | undefined): ClaudeEffort | null {
  const v = (name ?? "").trim().toLowerCase() as ClaudeEffort;
  return EFFORTS.includes(v) ? v : null;
}

/**
 * A model name from the environment: a Claude model, optionally with the effort
 * written on the end the way model pickers show it ("claude-opus-5-5-high" is
 * claude-opus-5-5 at effort high). A gpt-* name left over from an OpenAI setup
 * is ignored.
 */
export function parseClaudeModel(name: string | undefined): { model: string; effort: ClaudeEffort | null } {
  const m = /^(claude-.*?)(?:-(low|medium|high|xhigh|max))?$/i.exec((name ?? "").trim());
  if (!m) return { model: CLAUDE_MODEL, effort: null };
  return { model: m[1]!, effort: claudeEffort(m[2]) };
}

export function claudeModel(name: string | undefined): string {
  return parseClaudeModel(name).model;
}

/** The effort floor the operator set (LLM_EFFORT, or a suffix on LLM_MODEL), if any. */
export function claudeEffortFloor(env: NodeJS.ProcessEnv = process.env): ClaudeEffort | null {
  return claudeEffort(env.LLM_EFFORT) ?? parseClaudeModel(env.LLM_MODEL).effort;
}

/** Thinking shares max_tokens with the answer, so the stages' JSON budgets get room for it. */
/** Room above the answer for adaptive thinking; more at higher effort, where thinking runs longer. */
const thinkingHeadroom = (effort: ClaudeEffort) => (effort === "max" || effort === "xhigh" ? 48_000 : effort === "high" ? 32_000 : 16_000);

/** Images go inline: our asset URLs (localhost:9000, a private bucket) aren't reachable from Anthropic's servers. */
async function inlineImage(url: string): Promise<Anthropic.ImageBlockParam> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch image for vision QA: ${res.status} ${url}`);
  const type = res.headers.get("content-type")?.split(";")[0] ?? "image/png";
  if (!/^image\/(jpeg|png|gif|webp)$/.test(type)) throw new Error(`vision QA needs a jpeg, png, gif or webp image, got ${type}: ${url}`);
  return { type: "image", source: { type: "base64", media_type: type as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: Buffer.from(await res.arrayBuffer()).toString("base64") } };
}

/**
 * What the provider needs from the SDK: a streamed request, read to its end.
 * Streaming is how the SDK wants anything that may run long (a high-effort
 * answer with room for thinking is one); without it the SDK refuses such a
 * request outright, before it is sent.
 */
type Client = { messages: { stream(params: Anthropic.MessageStreamParams): { finalMessage(): Promise<Anthropic.Message> } } };

const STRING_FORMATS = new Set(["date-time", "time", "date", "duration", "email", "hostname", "uri", "ipv4", "ipv6", "uuid"]);

/**
 * Claude's structured outputs refuse the constraint keywords zod emits for .min()/.max()
 * (minimum, maxLength, minItems above 1, maxItems…) with a 400, not a warning. They are
 * removed here and restated in plain words in the description; the answer is still checked
 * against the full zod schema afterwards, so a limit the model overshoots is caught and sent
 * back for one retry, exactly as with OpenAI.
 */
export function claudeSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const root = structuredClone(schema) as Record<string, unknown>;
  delete root.$schema;
  strip(root);
  // zodTextFormat keeps a copy of the whole answer under definitions.answer that nothing points at;
  // it doubles the schema and counts twice against the API's limit on union-typed fields.
  for (const key of ["definitions", "$defs"] as const) {
    const defs = root[key] as Record<string, unknown> | undefined;
    if (!defs) continue;
    for (let dropped = true; dropped; ) {
      const used = new Set<string>();
      JSON.stringify(root, (k, v) => {
        if (k === "$ref" && typeof v === "string") used.add(v.replace(/^#\/(definitions|\$defs)\//, ""));
        return v;
      });
      dropped = false;
      for (const name of Object.keys(defs)) if (!used.has(name)) { delete defs[name]; dropped = true; }
    }
    if (!Object.keys(defs).length) delete root[key];
  }
  return root;
}

function strip(node: any): any {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== "object") return node;
  const notes: string[] = [];
  const take = (k: string) => {
    const v = node[k];
    delete node[k];
    return v;
  };
  const lo = take("minimum") ?? take("exclusiveMinimum");
  const hi = take("maximum") ?? take("exclusiveMaximum");
  take("multipleOf");
  if (lo !== undefined && hi !== undefined) notes.push(`between ${lo} and ${hi}`);
  else if (lo !== undefined) notes.push(`at least ${lo}`);
  else if (hi !== undefined) notes.push(`at most ${hi}`);
  const minL = take("minLength");
  const maxL = take("maxLength");
  if (minL > 1 && maxL !== undefined) notes.push(`${minL} to ${maxL} characters`);
  else if (maxL !== undefined) notes.push(`at most ${maxL} characters`);
  else if (minL > 1) notes.push(`at least ${minL} characters`);
  const minI = node.minItems > 1 ? take("minItems") : undefined;
  const maxI = take("maxItems");
  take("uniqueItems");
  if (minI !== undefined && maxI !== undefined) notes.push(`${minI} to ${maxI} items`);
  else if (minI !== undefined) notes.push(`at least ${minI} items`);
  else if (maxI !== undefined) notes.push(`at most ${maxI} items`);
  if (typeof node.format === "string" && !STRING_FORMATS.has(node.format)) notes.push(`format: ${take("format")}`);
  if (Array.isArray(node.oneOf)) node.anyOf = take("oneOf");
  if ((node.type === "object" || node.properties) && typeof node.additionalProperties !== "object") node.additionalProperties = false;
  if (notes.length) node.description = [node.description, `(${notes.join(", ")})`].filter(Boolean).join(" ");
  for (const k of ["properties", "$defs", "definitions"]) if (node[k] && typeof node[k] === "object") for (const key of Object.keys(node[k])) node[k][key] = strip(node[k][key]);
  for (const k of ["items", "anyOf", "allOf", "not"]) if (k in node) node[k] = strip(node[k]);
  return node;
}

export class AnthropicLLM implements LLM {
  private client: Client;
  constructor(
    apiKey: string | undefined,
    private model = claudeModel(process.env.LLM_MODEL),
    private visionModel = claudeModel(process.env.LLM_VISION_MODEL || process.env.LLM_MODEL),
    client?: Client,
    /** No call runs below this effort (LLM_EFFORT=high makes "Opus 5.5 high"); the stages' own hints still raise it. */
    private floor: ClaudeEffort | null = claudeEffortFloor(),
  ) {
    this.client = client ?? new Anthropic(apiKey ? { apiKey } : {});
  }

  /** The stage's hint, raised to the operator's floor. */
  private effort(hint: Effort): ClaudeEffort {
    return this.floor && EFFORTS.indexOf(this.floor) > EFFORTS.indexOf(hint) ? this.floor : hint;
  }

  private async call<T>(model: string, system: string, content: Anthropic.ContentBlockParam[], schema: z.ZodType<T>, maxTokens: number, hint: Effort): Promise<T> {
    const effort = this.effort(hint);
    const jsonSchema = claudeSchema(zodTextFormat(schema as z.ZodTypeAny, "answer").schema as Record<string, unknown>);
    const res = await this.client.messages
      .stream({
        model,
        max_tokens: Math.min(100_000, maxTokens + thinkingHeadroom(effort)),
        system,
        messages: [{ role: "user", content }],
        output_config: { format: { type: "json_schema", schema: jsonSchema }, effort },
      })
      .finalMessage();
    if (res.stop_reason === "refusal") throw new Error(`the model declined this request${res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : ""}`);
    if (res.stop_reason === "max_tokens") throw new Error("the model ran out of room for its answer; raise maxTokens");
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`the answer did not fit the schema: not JSON: ${text.slice(0, 200)}`);
    }
    const checked = parseClipping(schema, parsed);
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
