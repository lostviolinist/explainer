/**
 * Forced alignment: word timestamps for a narration clip, one per word of the
 * script, in order (captions and cue words index the script's words).
 *
 * Hedra's speech output carries audio and duration only, so alignment is our
 * own step. Three ways, in order of preference:
 *
 *   HttpAligner    a WhisperX-class service (ALIGNMENT_URL):
 *                  POST { audio_url, transcript, language } → { words: [{ w, start, end }] }
 *   OpenAIAligner  OpenAI's transcription API with word timestamps (whisper-1),
 *                  matched to the script's words; the default when there's an OpenAI key.
 *   estimateSplit  the fallback when neither works: words weighted by length, with
 *                  pauses at punctuation and a little silence at both ends.
 */
import OpenAI, { toFile } from "openai";
import type { WordTimestamp } from "@explainer/schemas";

export interface Aligner {
  /** `exact` is false when the times are estimated rather than heard. */
  align(audioUrl: string, transcript: string, durationS: number): Promise<{ words: WordTimestamp[]; exact: boolean }>;
}

export class HttpAligner implements Aligner {
  constructor(private url: string, private f: typeof fetch = fetch) {}
  async align(audioUrl: string, transcript: string) {
    const res = await this.f(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audio_url: audioUrl, transcript, language: "en" }),
    });
    if (!res.ok) throw new Error(`alignment failed: ${res.status}`);
    const data = (await res.json()) as { words: WordTimestamp[] };
    return { words: data.words, exact: true };
  }
}

/** Words as heard by a transcriber, with their times. */
export type HeardWord = { w: string; start: number; end: number };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const tokens = (transcript: string) => transcript.split(/\s+/).filter(Boolean);

/**
 * Match the script's words to what was heard (longest common subsequence on
 * normalised words), take the heard times for matches, and spread the words in
 * between (misheard, numbers written differently, hyphens split) across the gap
 * by length. Null when too little matched to trust.
 */
export function alignWords(transcript: string, heard: HeardWord[], durationS: number): WordTimestamp[] | null {
  const script = tokens(transcript);
  const a = script.map(norm);
  const b = heard.map((h) => norm(h.w));
  const n = a.length;
  const m = b.length;
  if (!n || !m) return null;
  // LCS table, then walk back for the matched pairs.
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i]![j] = a[i] && a[i] === b[j] ? L[i + 1]![j + 1]! + 1 : Math.max(L[i + 1]![j]!, L[i]![j + 1]!);
    }
  }
  const match = new Array<number>(n).fill(-1);
  let matched = 0;
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] && a[i] === b[j]) {
      match[i] = j;
      matched++;
      i++;
      j++;
    } else if (L[i + 1]![j]! >= L[i]![j + 1]!) i++;
    else j++;
  }
  if (matched < Math.max(1, Math.ceil(n * 0.6))) return null;

  const out: WordTimestamp[] = new Array(n);
  let i = 0;
  while (i < n) {
    if (match[i]! >= 0) {
      const h = heard[match[i]!]!;
      out[i] = { w: script[i]!, start: round(h.start), end: round(Math.max(h.start, h.end)) };
      i++;
      continue;
    }
    // A run of unmatched script words: fill the gap between the neighbouring matches.
    let k = i;
    while (k < n && match[k]! < 0) k++;
    const from = i > 0 ? out[i - 1]!.end : Math.max(0, (match[k] !== undefined && k < n ? heard[match[k]!]!.start : durationS) - 0.3 * (k - i));
    const to = k < n ? heard[match[k]!]!.start : Math.min(durationS, from + 0.3 * (k - i));
    const weights = script.slice(i, k).map((w) => w.length + 2);
    const total = weights.reduce((x, y) => x + y, 0);
    let t = from;
    for (let q = i; q < k; q++) {
      const end = t + ((to - from) * weights[q - i]!) / total;
      out[q] = { w: script[q]!, start: round(t), end: round(end) };
      t = end;
    }
    i = k;
  }
  return out;
}

const round = (x: number) => +x.toFixed(3);

/**
 * OpenAI transcription with word timestamps, steered by the script so the
 * spelling matches. Any model that supports word granularity works; whisper-1 does.
 */
export class OpenAIAligner implements Aligner {
  private client: OpenAI;
  constructor(apiKey: string, private model = process.env.ALIGNMENT_MODEL || "whisper-1", private f: typeof fetch = fetch) {
    this.client = new OpenAI({ apiKey });
  }

  async align(audioUrl: string, transcript: string, durationS: number) {
    const res = await this.f(audioUrl);
    if (!res.ok) throw new Error(`could not fetch narration for alignment: ${res.status}`);
    const type = res.headers.get("content-type") ?? "audio/mpeg";
    const ext = /wav/.test(type) ? "wav" : /ogg|opus/.test(type) ? "ogg" : /webm/.test(type) ? "webm" : /mp4|m4a|aac/.test(type) ? "m4a" : "mp3";
    const file = await toFile(Buffer.from(await res.arrayBuffer()), `narration.${ext}`, { type });
    const out = await this.client.audio.transcriptions.create({
      file,
      model: this.model,
      language: "en",
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
      // The prompt biases spelling toward the script (names, numbers as written).
      prompt: transcript.slice(0, 800),
      temperature: 0,
    });
    const heard = (out.words ?? []).map((w) => ({ w: w.word, start: w.start, end: w.end }));
    const words = alignWords(transcript, heard, durationS);
    if (!words) throw new Error(`transcription matched too few of the script's words (${heard.length} heard)`);
    return { words, exact: true };
  }
}

/** Even spread of the words across the clip (tests and fakes). */
export function evenSplit(transcript: string, durationS: number): WordTimestamp[] {
  const words = tokens(transcript);
  const per = durationS / Math.max(1, words.length);
  return words.map((w, i) => ({ w, start: round(i * per), end: round((i + 1) * per) }));
}

/**
 * Timing from the text alone: each word takes time in proportion to its length,
 * sentence ends and commas add a pause, and a little silence is left at both ends
 * (speech synthesis adds some). Much closer than an even split; still a guess.
 */
export function estimateSplit(transcript: string, durationS: number): WordTimestamp[] {
  const words = tokens(transcript);
  if (!words.length) return [];
  const lead = Math.min(0.25, durationS * 0.03);
  const tail = Math.min(0.45, durationS * 0.06);
  const speech = Math.max(0.1, durationS - lead - tail);
  // Units: a word costs its letters plus a fixed cost; pauses cost extra units after the word.
  const cost = words.map((w) => w.replace(/[^A-Za-z0-9]/g, "").length + 2.5);
  const pause: number[] = words.map((w, i) => (i === words.length - 1 ? 0 : /[.!?]["')\]]?$/.test(w) ? 5 : /[,;:—–]["')\]]?$/.test(w) ? 2 : 0));
  const total = cost.reduce((x, y) => x + y, 0) + pause.reduce((x, y) => x + y, 0);
  const unit = speech / total;
  let t = lead;
  return words.map((w, i) => {
    const start = t;
    const end = start + cost[i]! * unit;
    t = end + pause[i]! * unit;
    return { w, start: round(start), end: round(end) };
  });
}

export class FallbackAligner implements Aligner {
  constructor(private primary: Aligner | null, private onFallback?: (reason: string) => void) {}
  async align(audioUrl: string, transcript: string, durationS: number) {
    if (this.primary) {
      try {
        return await this.primary.align(audioUrl, transcript, durationS);
      } catch (e) {
        this.onFallback?.((e as Error).message);
      }
    }
    return { words: estimateSplit(transcript, durationS), exact: false };
  }
}

/** Rescale timings so the last word ends at the real duration. */
export function rescale(words: WordTimestamp[], durationS: number): WordTimestamp[] {
  const last = words.at(-1)?.end ?? 1;
  const k = durationS / last;
  return words.map((x) => ({ w: x.w, start: round(x.start * k), end: round(x.end * k) }));
}
