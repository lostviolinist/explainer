import { test } from "node:test";
import assert from "node:assert/strict";
import { alignWords, estimateSplit, evenSplit, FallbackAligner, OpenAIAligner, type HeardWord } from "../src/providers/alignment.ts";

const heard = (pairs: [string, number][]): HeardWord[] => pairs.map(([w, start]) => ({ w, start, end: +(start + 0.25).toFixed(3) }));

test("heard words give the script's words their real times, in script order", () => {
  const script = "Why is the sky blue? The answer is in the air.";
  const words = alignWords(script, heard([["Why", 0.4], ["is", 0.6], ["the", 0.7], ["sky", 0.85], ["blue", 1.2], ["The", 2.1], ["answer", 2.3], ["is", 2.7], ["in", 2.85], ["the", 2.95], ["air", 3.1]]), 4)!;
  assert.equal(words.length, 11, "one timestamp per script word");
  assert.deepEqual(words.map((w) => w.w), script.split(" "));
  assert.equal(words[0]!.start, 0.4, "leading silence is not spread over the first words");
  assert.equal(words[4]!.start, 1.2);
  assert.equal(words[5]!.start, 2.1, "the pause between sentences stays a pause");
  assert.equal(words.at(-1)!.end, 3.35);
});

test("misheard or differently written words are placed between their neighbours by length", () => {
  const script = "Blue scatters about five times more than red.";
  // "5" for "five", "scaters" for "scatters": neither matches the script.
  const words = alignWords(script, heard([["Blue", 0.3], ["scaters", 0.55], ["about", 1.0], ["5", 1.3], ["times", 1.5], ["more", 1.8], ["than", 2.0], ["red", 2.2]]), 3)!;
  assert.equal(words.length, 8);
  const by = Object.fromEntries(words.map((w) => [w.w, w]));
  assert.equal(by["scatters"]!.start, 0.55, "fills the gap after the previous match");
  assert.equal(by["scatters"]!.end, 1.0, "up to the next match");
  assert.equal(by["five"]!.start, 1.25, "after 'about' ends");
  assert.equal(by["five"]!.end, 1.5, "until 'times' starts");
  for (let i = 1; i < words.length; i++) assert.ok(words[i]!.start >= words[i - 1]!.start, "monotonic");
});

test("a transcription that matches too little of the script is rejected", () => {
  assert.equal(alignWords("one two three four five six", heard([["uno", 0], ["dos", 1], ["tres", 2], ["four", 3]]), 5), null);
  assert.equal(alignWords("one two", [], 5), null);
});

test("the text-only estimate weights words by length, pauses at punctuation and leaves silence at the ends", () => {
  const words = estimateSplit("Hi. Photosynthesis, though, is slow.", 6);
  assert.deepEqual(words.map((w) => w.w), ["Hi.", "Photosynthesis,", "though,", "is", "slow."]);
  assert.ok(words[0]!.start > 0 && words[0]!.start <= 0.25, "a little lead silence");
  assert.ok(words.at(-1)!.end < 6 && words.at(-1)!.end > 5.4, "a little tail silence");
  const dur = (i: number) => words[i]!.end - words[i]!.start;
  assert.ok(dur(1) > 2 * dur(3), "'Photosynthesis' takes much longer than 'is'");
  assert.ok(words[1]!.start - words[0]!.end > words[3]!.start - words[2]!.end, "the full stop pauses longer than the comma");
  const even = evenSplit("Hi. Photosynthesis, though, is slow.", 6);
  assert.ok(Math.abs(even[1]!.end - even[1]!.start - (even[3]!.end - even[3]!.start)) < 1e-6, "unlike the even split");
});

test("the fallback aligner estimates when the primary fails, and says so", async () => {
  const reasons: string[] = [];
  const failing = { align: async () => { throw new Error("whisper down"); } };
  const a = new FallbackAligner(failing, (why) => reasons.push(why));
  const r = await a.align("http://x/a.mp3", "One two three.", 3);
  assert.equal(r.exact, false);
  assert.equal(r.words.length, 3);
  assert.deepEqual(reasons, ["whisper down"]);
});

test("the OpenAI aligner sends the narration with word timestamps and matches the result to the script", async () => {
  const seen: { url: string; body?: FormData }[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/a.mp3")) return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
    if (u.endsWith("/audio/transcriptions")) {
      seen.push({ url: u, body: init?.body as FormData });
      return new Response(JSON.stringify({ text: "Why is the sky blue", duration: 2, words: [{ word: "Why", start: 0.3, end: 0.5 }, { word: "is", start: 0.5, end: 0.6 }, { word: "the", start: 0.6, end: 0.7 }, { word: "sky", start: 0.7, end: 1.0 }, { word: "blue", start: 1.0, end: 1.4 }] }), { headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected fetch ${u}`);
  }) as typeof fetch;
  process.env.OPENAI_BASE_URL = "http://fake.local/v1";
  const a = new OpenAIAligner("sk-test", "whisper-1", f);
  // The SDK uses its own fetch; point it at ours.
  (a as any).client = new (await import("openai")).default({ apiKey: "sk-test", baseURL: "http://fake.local/v1", fetch: f });
  const r = await a.align("http://x/a.mp3", "Why is the sky blue?", 2);
  assert.equal(r.exact, true);
  assert.deepEqual(r.words.map((w) => [w.w, w.start]), [["Why", 0.3], ["is", 0.5], ["the", 0.6], ["sky", 0.7], ["blue?", 1.0]]);
  const form = seen[0]!.body!;
  assert.equal(form.get("model"), "whisper-1");
  assert.equal(form.get("response_format"), "verbose_json");
  assert.equal(form.get("timestamp_granularities[]"), "word");
  assert.equal(form.get("prompt"), "Why is the sky blue?");
  assert.ok(form.get("file") instanceof Blob);
});
