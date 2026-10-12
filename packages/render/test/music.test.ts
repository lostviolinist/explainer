import { test } from "node:test";
import assert from "node:assert/strict";
import { FPS, END_CARD_S, MUSIC, musicStart, musicVolume, speechWindows, totalFrames } from "../src/props.ts";
import { sampleProps } from "../src/sample.ts";

test("the bed starts partway in so its ending lands on the video's end; a short bed loops", () => {
  const total = totalFrames(sampleProps); // 4.2 + 7.1 s of scenes, tails, 6 s end card
  const long = musicStart(240, total);
  assert.equal(long.loop, false);
  assert.equal(long.startFrom + total, 240 * FPS, "bed end == video end");
  const short = musicStart(10, total);
  assert.deepEqual(short, { startFrom: 0, loop: true });
});

test("the bed is faded in, ducked under narration, up on the end card, and gone at the last frame", () => {
  const total = totalFrames(sampleProps);
  const windows = speechWindows(sampleProps);
  assert.deepEqual(windows[0], [0, Math.round(4.2 * FPS)]);
  assert.equal(musicVolume(0, windows, total, false), 0, "silent at frame 0");
  const mid = Math.round(2 * FPS);
  assert.ok(Math.abs(musicVolume(mid, windows, total, false) - MUSIC.under) < 1e-9, "ducked under speech");
  const endCard = total - Math.round((END_CARD_S / 2) * FPS);
  assert.ok(Math.abs(musicVolume(endCard, windows, total, false) - MUSIC.between) < 1e-9, "full bed level on the end card");
  assert.equal(musicVolume(total, windows, total, false), 0, "tapered to nothing at the end");
  // A looping bed fades over the whole end card instead of relying on its ending.
  assert.ok(musicVolume(total - Math.round(1 * FPS), windows, total, true) < MUSIC.between * 0.25);
});
