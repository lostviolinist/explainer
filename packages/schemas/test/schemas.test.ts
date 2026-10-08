import { test } from "node:test";
import assert from "node:assert/strict";
import { Brief, lengthFromClaims, sceneBudget, Scene } from "../src/index.ts";

test("scene budget for 3 minutes at 165 wpm", () => {
  const b = sceneBudget(180);
  assert.equal(b.wordBudget, 495);
  assert.deepEqual(b.sceneRange, [4, 9]);
});

test("length from needed claims", () => {
  assert.equal(lengthFromClaims(5), 120);
  assert.equal(lengthFromClaims(8), 180);
  assert.equal(lengthFromClaims(14), 300);
});

test("brief rejects an over-long question", () => {
  const r = Brief.safeParse({
    projectId: "11111111-1111-4111-8111-111111111111",
    question: "x".repeat(600),
    topic: "t",
    learningGoal: "g",
    level: "basics",
    ageMode: null,
    tone: "neutral",
    background: "light",
    lengthS: null,
    wordBudget: null,
    sceneRange: null,
    statement: "s",
    derivedFrom: null,
  });
  assert.equal(r.success, false);
});

test("scene ids follow s<n>", () => {
  assert.equal(Scene.shape.id.safeParse("s3").success, true);
  assert.equal(Scene.shape.id.safeParse("scene3").success, false);
});
