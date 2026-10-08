import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSrt } from "../src/renderer.ts";
import { cueFrame, totalFrames, FPS } from "../src/props.ts";
import { sampleProps } from "../src/sample.ts";

test("SRT has one cue per sentence, offset by scene start", () => {
  const srt = buildSrt(sampleProps);
  const cues = srt.trim().split("\n\n");
  assert.equal(cues.length, 3); // "Here's the strange part." + "The star isn't where you see it." + scene 2
  assert.match(cues[0]!, /^1\n00:00:00,000 --> /);
  assert.match(cues[2]!, /00:00:04,8\d\d --> /); // scene 2 starts at 4.2 + 0.6 tail
});

test("cue word maps to a frame inside the scene", () => {
  const s = sampleProps.scenes[1]!;
  const f = cueFrame(s.words, "gravity");
  assert.ok(f > 0 && f < s.durationS * FPS);
});

test("total frames includes tails and end card", () => {
  const f = totalFrames(sampleProps);
  assert.equal(f, Math.round((4.2 + 0.6) * FPS) + Math.round((7.1 + 0.6) * FPS) + 6 * FPS);
});
