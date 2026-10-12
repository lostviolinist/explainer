import { test } from "node:test";
import assert from "node:assert/strict";
import { activeChunk, captionChunks, CHUNK_CHARS } from "../src/captions-layout.ts";

/** Evenly spaced words, like the pipeline's fallback. */
const evenWords = (n: string, durationS: number) => {
  const ws = n.split(/\s+/).filter(Boolean);
  const per = durationS / ws.length;
  return ws.map((w, i) => ({ w, start: +(i * per).toFixed(3), end: +((i + 1) * per).toFixed(3) }));
};

const text = (n: string, c: { idx: number[] }) => c.idx.map((i) => n.split(/\s+/)[i]).join(" ");

test("short sentences are one caption each", () => {
  const n = "Why is the sky blue? The answer is in the air.";
  const chunks = captionChunks(n, evenWords(n, 5));
  assert.deepEqual(chunks.map((c) => text(n, c)), ["Why is the sky blue?", "The answer is in the air."]);
  assert.equal(chunks[0]!.start, 0);
  assert.equal(chunks[1]!.start, evenWords(n, 5)[5]!.start);
});

test("a long sentence breaks at a clause near the middle, never leaving a lone word", () => {
  const n = "Many people think the sky reflects the ocean, but it is blue over deserts too, far from any sea.";
  const chunks = captionChunks(n, evenWords(n, 8));
  for (const c of chunks) {
    assert.ok(text(n, c).length <= CHUNK_CHARS, `too long: ${text(n, c)}`);
    assert.ok(c.idx.length >= 2);
  }
  assert.equal(text(n, chunks[0]!), "Many people think the sky reflects the ocean,");
});

test("a long sentence with no punctuation still fits two lines", () => {
  const n = "Those molecules scatter short blue wavelengths much more strongly than long red ones across the whole sky";
  const chunks = captionChunks(n, evenWords(n, 8));
  assert.ok(chunks.length >= 2);
  for (const c of chunks) assert.ok(text(n, c).length <= CHUNK_CHARS);
  assert.deepEqual(chunks.flatMap((c) => c.idx), n.split(" ").map((_, i) => i), "every word is shown once, in order");
});

test("the caption on screen follows the word timestamps, with a short hold after each", () => {
  const n = "First sentence here. Second sentence here.";
  const words = [0, 1, 2, 3, 4, 5].map((i) => ({ w: n.split(" ")[i]!, start: i * 0.5 + (i >= 3 ? 1 : 0), end: i * 0.5 + 0.4 + (i >= 3 ? 1 : 0) }));
  const chunks = captionChunks(n, words);
  assert.equal(text(n, activeChunk(chunks, 0.1)!), "First sentence here.");
  assert.equal(text(n, activeChunk(chunks, 1.6)!), "First sentence here.", "held through the pause");
  assert.equal(text(n, activeChunk(chunks, 2.5)!), "Second sentence here.");
  assert.equal(activeChunk(chunks, 5), null);
});
