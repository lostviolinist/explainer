import type { WordTimestamp } from "@explainer/schemas";

/** A caption: which of the narration's words it shows, and when (from the word timestamps). */
export type CaptionChunk = { idx: number[]; start: number; end: number };

/** About two lines at 44px bold in 820px (≈ 34 characters a line). */
export const CHUNK_CHARS = 64;

const endsSentence = (tok: string) => /[.!?]["')\]]?$/.test(tok);
const endsClause = (tok: string) => /[,;:—–)]["']?$/.test(tok);

/**
 * Split the narration into caption-sized chunks: one sentence per chunk, and
 * long sentences broken at a clause (comma, semicolon, dash) near the middle,
 * else at the nearest word boundary. Chunks never start or end on a lone word.
 */
export function captionChunks(narration: string, words: WordTimestamp[]): CaptionChunk[] {
  const tokens = narration.split(/\s+/).filter(Boolean);
  const sentences: number[][] = [];
  let cur: number[] = [];
  tokens.forEach((tok, i) => {
    cur.push(i);
    if (endsSentence(tok) || i === tokens.length - 1) {
      sentences.push(cur);
      cur = [];
    }
  });
  const out: number[][] = [];
  for (const s of sentences) splitChunk(s, tokens, out);
  return out
    .map((idx) => {
      const ws = idx.map((j) => words[j]).filter((w): w is WordTimestamp => Boolean(w));
      return { idx, start: ws[0]?.start ?? -1, end: ws.at(-1)?.end ?? -1 };
    })
    .filter((c) => c.start >= 0);
}

function splitChunk(idx: number[], tokens: string[], out: number[][]) {
  const length = (ids: number[]) => ids.reduce((n, j) => n + tokens[j]!.length + 1, 0) - 1;
  if (length(idx) <= CHUNK_CHARS || idx.length < 4) {
    out.push(idx);
    return;
  }
  const target = length(idx) / 2;
  let best = -1;
  let bestScore = Infinity;
  let acc = 0;
  // Break after token k, leaving at least two words on each side; a clause end nearby wins.
  for (let k = 0; k < idx.length - 2; k++) {
    acc += tokens[idx[k]!]!.length + 1;
    if (k < 1) continue;
    const score = Math.abs(acc - target) - (endsClause(tokens[idx[k]!]!) ? 14 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = k;
    }
  }
  if (best < 0) {
    out.push(idx);
    return;
  }
  splitChunk(idx.slice(0, best + 1), tokens, out);
  splitChunk(idx.slice(best + 1), tokens, out);
}

/** The caption on screen at `t` (seconds into the scene), if any; the latest one when two touch. */
export function activeChunk(chunks: CaptionChunk[], t: number): CaptionChunk | null {
  let hit: CaptionChunk | null = null;
  for (const c of chunks) if (t >= c.start - 0.05 && t <= c.end + 0.3) hit = c;
  return hit;
}
