import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSrt } from "../src/renderer.ts";
import { totalFrames, FPS } from "../src/props.ts";
import { cueSeconds, cueTimes, cueTimesEach } from "../src/motion/timing.ts";
import { sampleProps } from "../src/sample.ts";

test("SRT has one cue per sentence, offset by scene start", () => {
  const srt = buildSrt(sampleProps);
  const cues = srt.trim().split("\n\n");
  assert.equal(cues.length, 3); // "Here's the strange part." + "The star isn't where you see it." + scene 2
  assert.match(cues[0]!, /^1\n00:00:00,000 --> /);
  assert.match(cues[2]!, /00:00:04,8\d\d --> /); // scene 2 starts at 4.2 + 0.6 tail
});

test("a cue word maps to its moment in the scene; phrases, stems and unknown cues too", () => {
  const s = sampleProps.scenes[1]!;
  const at = cueSeconds(s.words, s.narration, s.durationS, "gravity");
  assert.ok(at > 0 && at < s.durationS);
  assert.equal(cueSeconds(s.words, s.narration, s.durationS, "black hole's"), s.words.find((w) => w.w === "black")!.start, "a phrase matches its first word");
  assert.equal(cueSeconds(s.words, s.narration, s.durationS, "lines"), s.words.find((w) => w.w === "line,")!.start, "plurals and stems match");
  assert.ok(Number.isNaN(cueSeconds(s.words, s.narration, s.durationS, "zebra")), "a cue that is nowhere is NaN");
  // In order, never before the one before, never in the cut; unknown cues spread out between their neighbours.
  const times = cueTimes(s.words, s.narration, s.durationS, ["Its", "zebra", "gravity", "zebra"]);
  assert.ok(times[0]! >= 0.4, "not during the cut");
  assert.ok(times[1]! > times[0]! && times[1]! < times[2]!, "unknown cue between its neighbours");
  assert.ok(times[3]! > times[2]! && times[3]! <= s.durationS - 0.3);
  // Independent things (callouts) keep their own moments whatever order they were listed in.
  const each = cueTimesEach(s.words, s.narration, s.durationS, ["gravity", "Its", "zebra"]);
  assert.ok(each[1]! < each[0]!, "the part named first appears first");
  assert.equal(each[1], 0.4, "never during the cut");
  assert.ok(each[2]! > 0.4 && each[2]! < s.durationS, "an unknown cue lands inside the scene");
});

test("total frames includes tails and end card", () => {
  const f = totalFrames(sampleProps);
  assert.equal(f, Math.round((4.2 + 0.6) * FPS) + Math.round((7.1 + 0.6) * FPS) + 6 * FPS);
});

test("short clips bounce forward and back instead of freezing", async () => {
  const { pingPong } = await import("../src/SceneLayers.tsx");
  const n = 5; // frames 0..4
  assert.deepEqual(Array.from({ length: 12 }, (_, f) => pingPong(f, n)), [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3]);
});
