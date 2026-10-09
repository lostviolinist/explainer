import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { Inferred } from "../src/stages/intake.ts";
import { Queries, Extracted, Merged } from "../src/stages/research.ts";
import { Arc, Scenes, LearnerPass, ExpertPass } from "../src/stages/script.ts";
import { Planned, VisionScore, SceneCode, StillLayout } from "../src/stages/visuals.ts";
import { Watchability, FactCheck } from "../src/stages/assemble.ts";

const SCHEMAS: Record<string, z.ZodTypeAny> = { Inferred, Queries, Extracted, Merged, Arc, Scenes, LearnerPass, ExpertPass, Planned, VisionScore, Watchability, FactCheck, SceneCode, StillLayout, Ping: z.object({ ok: z.literal(true) }) };

/** OpenAI strict structured outputs: every object closed and every property required; root is an object. */
function strictProblems(node: any, path: string, defs: Record<string, any>, out: string[], seen = new Set<any>()) {
  if (!node || typeof node !== "object" || seen.has(node)) return out;
  seen.add(node);
  if (node.$ref) {
    const target = defs[String(node.$ref).split("/").pop()!];
    if (!target) out.push(`${path}: unresolved $ref ${node.$ref}`);
    return strictProblems(target, path, defs, out, seen);
  }
  if (node.type === "object" || node.properties) {
    if (node.additionalProperties !== false) out.push(`${path}: additionalProperties must be false`);
    const keys = Object.keys(node.properties ?? {});
    const missing = keys.filter((k) => !(node.required ?? []).includes(k));
    if (missing.length) out.push(`${path}: not required: ${missing.join(", ")}`);
    for (const k of keys) strictProblems(node.properties[k], `${path}.${k}`, defs, out, seen);
  }
  for (const k of ["items", "not"]) if (node[k]) strictProblems(node[k], `${path}[]`, defs, out, seen);
  for (const k of ["anyOf", "allOf", "oneOf"]) (node[k] ?? []).forEach((n: any, i: number) => strictProblems(n, `${path}|${i}`, defs, out, seen));
  if (node.oneOf) out.push(`${path}: oneOf is not supported (use anyOf)`);
  return out;
}

for (const [name, schema] of Object.entries(SCHEMAS)) {
  test(`${name} converts to a strict structured-output schema`, () => {
    const format = zodTextFormat(schema, "answer") as any;
    assert.equal(format.type, "json_schema");
    assert.equal(format.strict, true);
    assert.equal(format.schema.type, "object", "root must be an object");
    const problems = strictProblems(format.schema, name, { ...(format.schema.$defs ?? {}), ...(format.schema.definitions ?? {}) }, []);
    assert.deepEqual(problems, []);
  });
}

test("Arc's JSON schema names the beat field the model must fill", () => {
  const s = (zodTextFormat(Arc, "answer") as any).schema;
  const beat = s.properties.beats.items.properties.beat;
  assert.deepEqual(beat.enum, ["hook", "ground", "misconception", "build-up", "core", "payoff", "recap"]);
  assert.ok(s.properties.beats.items.required.includes("beat"));
});
