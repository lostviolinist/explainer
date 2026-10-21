import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultConcurrency, memoryIsTight, perTabBytes } from "../src/renderer.ts";

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
