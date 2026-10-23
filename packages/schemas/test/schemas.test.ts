import { test } from "node:test";
import assert from "node:assert/strict";
import { Brief, lengthFromClaims, sceneBudget, Scene, Short, clipText } from "../src/index.ts";

test("scene budget for 3 minutes at 165 wpm", () => {
  const b = sceneBudget(180);
  assert.equal(b.wordBudget, 495);
  assert.deepEqual(b.sceneRange, [8, 15], "12–22 s per scene: one thing to look at, never longer than attention lasts");
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

test("clipText cuts at a word break past the halfway point, else hard", () => {
  assert.equal(clipText("Energy", 24), "Energy");
  assert.equal(clipText("Energy stored in the mitochondria", 24), "Energy stored in the");
  assert.equal(clipText("Supercalifragilistic", 8), "Supercal");
  assert.ok(clipText("a b c d e f g h i j k l m n o p q r s t u v w x y z", 24).length <= 24);
  assert.equal(Short(24).safeParse("Energy stored in the mitochondria").success, false, "the schema itself keeps its limit");
});
