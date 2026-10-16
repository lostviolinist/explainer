import { FPS } from "../props.js";

type Word = { w: string; start: number; end: number };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * When a cue (a word or short phrase from the narration) is spoken, in seconds
 * from the scene start. Matches the first run of words whose stems match; if
 * the words were not transcribed that way, falls back to where the cue sits in
 * the narration text, in proportion. NaN when the cue is nowhere to be found.
 */
export function cueSeconds(words: Word[], narration: string, durationS: number, cue: string): number {
  const parts = cue.split(/\s+/).map(norm).filter(Boolean);
  if (!parts.length) return NaN;
  const stem = (s: string) => s.slice(0, Math.max(4, s.length - 2));
  const same = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(stem(b)) || b.startsWith(stem(a))));
  for (let i = 0; i + parts.length <= words.length; i++) {
    let ok = true;
    for (let k = 0; k < parts.length && ok; k++) ok = same(norm(words[i + k]!.w), parts[k]!);
    if (ok) return words[i]!.start;
  }
  const at = narration.toLowerCase().indexOf(cue.toLowerCase());
  return at >= 0 && narration.length ? (at / narration.length) * durationS : NaN;
}

/**
 * Cue times for a list of things that appear in order: each at its cue, never
 * before the one before it, never in the first third of a second (the cut is
 * still finishing), and unknown cues spaced out between their neighbours.
 */
export function cueTimes(words: Word[], narration: string, durationS: number, cues: string[], minGap = 0.35): number[] {
  const raw = cues.map((c) => cueSeconds(words, narration, durationS, c));
  const out: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const prev = i ? out[i - 1]! : 0.4 - minGap;
    let t = raw[i]!;
    if (Number.isNaN(t)) {
      // Spread the unknown ones evenly up to the next known cue (or the end).
      let next = durationS;
      let span = 1;
      for (let j = i + 1; j < raw.length; j++, span++) if (!Number.isNaN(raw[j]!)) { next = raw[j]!; break; }
      if (span === raw.length - i) next = Math.max(prev + minGap, durationS - 1);
      t = prev + (next - prev) / (span + 1);
    }
    out.push(Math.max(prev + minGap, Math.min(t, Math.max(prev + minGap, durationS - 0.3))));
  }
  return out;
}

export const toFrame = (seconds: number) => Math.round(seconds * FPS);

/** 0→1 over `over` seconds from `at`, eased out (cubic). */
export function ease(t: number, at: number, over: number): number {
  const x = Math.max(0, Math.min(1, (t - at) / Math.max(0.001, over)));
  return 1 - (1 - x) ** 3;
}

/** A one-off nudge: 0 → 1 → 0 over `over` seconds from `at` (for "this is the one being talked about"). */
export function pulse(t: number, at: number, over = 0.9): number {
  const x = (t - at) / over;
  if (x <= 0 || x >= 1) return 0;
  return Math.sin(x * Math.PI);
}

/** Numbers as people read them: thousands separated, at most one decimal when it is not a whole number. */
export function formatNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${+(n / 1e9).toFixed(1)} billion`;
  if (abs >= 1e6) return `${+(n / 1e6).toFixed(1)} million`;
  const rounded = abs >= 100 ? Math.round(n) : Math.round(n * 10) / 10;
  return rounded.toLocaleString("en-US");
}
