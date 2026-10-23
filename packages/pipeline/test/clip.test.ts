import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { StepsSpec } from "@explainer/schemas";
import { parseClipping } from "../src/providers/clip.ts";

const Plan = z.object({ animSpec: StepsSpec, note: z.string().max(10) });
const answer = (sub: string, icon = "sun") => ({
  animSpec: { kind: "steps", title: null, cycle: false, steps: [{ label: "Sunlight hits the leaf", sub, icon, cue: "sunlight" }, { label: "Water splits", sub: null, icon: "drop", cue: "water" }] },
  note: "ok",
});

test("a label a few characters over its limit is clipped at a word break, and the answer accepted", () => {
  const r = parseClipping(Plan, answer("photons arrive at the chloroplast membrane"));
  assert.ok(r.success);
  assert.equal(r.data.animSpec.steps[0]!.sub, "photons arrive at the");
  assert.equal(r.data.animSpec.steps[0]!.label, "Sunlight hits the leaf", "text within its limit is untouched");
});

test("an answer that fits is returned as is", () => {
  const r = parseClipping(Plan, answer("a date"));
  assert.ok(r.success && r.data.animSpec.steps[0]!.sub === "a date");
});

test("every other mistake is still reported, so the model's retry sees it", () => {
  const r = parseClipping(Plan, answer("photons arrive at the chloroplast membrane", "sunshine"));
  assert.equal(r.success, false);
  if (!r.success) {
    assert.ok(r.error.issues.some((i) => i.path.join(".") === "animSpec.steps.0.icon"), "the bad icon is reported");
    assert.ok(!r.error.issues.some((i) => i.code === "too_big"), "the long sub-line is not");
  }
});

test("several long strings are clipped in one pass", () => {
  const r = parseClipping(Plan, { ...answer("a sub-line that is far too long for its box"), note: "a note that is too long" });
  assert.ok(r.success);
  assert.ok(r.data.note.length <= 10);
});
