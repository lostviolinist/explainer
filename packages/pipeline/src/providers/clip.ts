/**
 * Validate a model's answer, forgiving the one mistake that should never cost a video: a string a
 * few characters over its limit. The schemas cap on-screen text at the width the templates draw
 * it (a step label at 24 characters, a cue at 40); the model is told, and mostly keeps to it, but
 * "around 3.5 billion years ago" in a sub-line used to fail the whole run after every retry.
 * Such strings are clipped at a word break and the answer checked again; every other problem is
 * still reported, so the model's retry sees it.
 */
import type { z } from "zod";
import { clipText } from "@explainer/schemas";

export function parseClipping<T>(schema: z.ZodType<T>, value: unknown): z.SafeParseReturnType<unknown, T> {
  const first = schema.safeParse(value);
  if (first.success) return first;
  const overflows = first.error.issues.filter((i) => i.code === "too_big" && i.type === "string" && typeof i.maximum === "number");
  if (!overflows.length) return first;
  const clipped = structuredClone(value) as Record<string, unknown>;
  for (const issue of overflows) {
    const parent = issue.path.slice(0, -1).reduce<unknown>((node, key) => (node as Record<string | number, unknown>)?.[key], clipped) as Record<string | number, unknown> | undefined;
    const key = issue.path.at(-1);
    if (!parent || key === undefined || typeof parent[key] !== "string") continue;
    parent[key] = clipText((parent[key] as string).trim(), Number((issue as z.ZodTooBigIssue).maximum));
  }
  return schema.safeParse(clipped);
}
