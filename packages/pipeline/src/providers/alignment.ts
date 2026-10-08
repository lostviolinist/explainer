/**
 * Forced alignment: word timestamps for a narration clip.
 *
 * Hedra's speech output carries audio and duration only, so alignment is our
 * own step. The contract is a small HTTP service (WhisperX-class):
 *   POST {ALIGNMENT_URL}  { audio_url, transcript, language }
 *   → { words: [{ w, start, end }] }
 *
 * `evenSplit` is the fallback when the service is unavailable: it spreads the
 * words evenly across the clip. Good enough for captions, not for cue words,
 * so the pacing check should flag scenes that used it.
 */
import type { WordTimestamp } from "@explainer/schemas";

export interface Aligner {
  align(audioUrl: string, transcript: string, language?: string): Promise<{ words: WordTimestamp[]; exact: boolean }>;
}

export class HttpAligner implements Aligner {
  constructor(private url: string, private f: typeof fetch = fetch) {}
  async align(audioUrl: string, transcript: string, language = "en") {
    const res = await this.f(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ audio_url: audioUrl, transcript, language }),
    });
    if (!res.ok) throw new Error(`alignment failed: ${res.status}`);
    const data = (await res.json()) as { words: WordTimestamp[] };
    return { words: data.words, exact: true };
  }
}

export function evenSplit(transcript: string, durationS: number): WordTimestamp[] {
  const words = transcript.split(/\s+/).filter(Boolean);
  const per = durationS / Math.max(1, words.length);
  return words.map((w, i) => ({ w, start: +(i * per).toFixed(3), end: +((i + 1) * per).toFixed(3) }));
}

export class FallbackAligner implements Aligner {
  constructor(private primary: Aligner | null) {}
  async align(audioUrl: string, transcript: string, language?: string) {
    if (this.primary) {
      try {
        return await this.primary.align(audioUrl, transcript, language);
      } catch {
        /* fall through */
      }
    }
    // Duration unknown here; caller patches `end` of the last word from the asset's duration.
    return { words: evenSplit(transcript, 1), exact: false };
  }
}

/** Rescale an even split to the real duration. */
export function rescale(words: WordTimestamp[], durationS: number): WordTimestamp[] {
  const last = words.at(-1)?.end ?? 1;
  const k = durationS / last;
  return words.map((x) => ({ w: x.w, start: +(x.start * k).toFixed(3), end: +(x.end * k).toFixed(3) }));
}
