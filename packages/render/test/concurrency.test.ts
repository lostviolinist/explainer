import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultConcurrency, memoryIsTight, perTabBytes, snapScale } from "../src/renderer.ts";

const GB = 1024 ** 3;

test("tabs painting frames: half the cores, and never more than fit in memory", () => {
  assert.equal(defaultConcurrency(8, 8 * GB, 1), 4); // 8 cores, 8 GB: the cores decide
  assert.equal(defaultConcurrency(8, 4 * GB, 1), 2); // 4 GB: 1.5 GB spare, 700 MB a tab
  assert.equal(defaultConcurrency(8, 4 * GB, 0.6667), 3); // 720p tabs are smaller
  assert.equal(defaultConcurrency(2, 16 * GB, 1), 1); // never fewer than one
  assert.equal(defaultConcurrency(8, 2 * GB, 1), 1);
  assert.ok(perTabBytes(0.6667) < perTabBytes(1));
  assert.equal(memoryIsTight(2 * GB, 1), true);
  assert.equal(memoryIsTight(4 * GB, 1), false);
});

test("the output size is whole, even pixels whatever RENDER_SCALE says: 0.6667 of 1080p is 1280×720, not 1280.064", () => {
  const wholeAndEven = (w: number, h: number, s: number) => Number.isInteger(w * s) && Number.isInteger(h * s) && (w * s) % 2 === 0 && (h * s) % 2 === 0;
  for (const [w, h, asked] of [[1920, 1080, 0.6667], [1920, 1080, 0.5], [1920, 1080, 1], [1920, 1080, 0.3], [1920, 1080, 0.75], [1080, 1920, 0.6667], [1000, 1000, 0.333]] as const) {
    const s = snapScale(w, h, asked);
    assert.ok(wholeAndEven(w, h, s), `${w}×${h} at ${asked} → ${s}: ${w * s}×${h * s}`);
    assert.ok(Math.abs(w * s - w * asked) <= 16, `${w}×${h} at ${asked} snapped too far: ${w * s}`);
  }
  assert.equal(1920 * snapScale(1920, 1080, 0.6667), 1280);
  assert.equal(1080 * snapScale(1920, 1080, 0.6667), 720);
  assert.equal(snapScale(1920, 1080, 1), 1);
});
