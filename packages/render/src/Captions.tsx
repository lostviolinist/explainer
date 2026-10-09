import { useCurrentFrame } from "remotion";
import { FPS, PALETTE } from "./props.js";
import type { ExplainerProps } from "./props.js";

/**
 * Word-timed captions, bottom-right, in the house safe area. Shows the current
 * sentence, with the spoken word emphasised. Sentences are grouped from word
 * timestamps using punctuation in the narration.
 */
export function Captions({
  words,
  narration,
  background,
}: {
  words: ExplainerProps["scenes"][number]["words"];
  narration: string;
  background: ExplainerProps["background"];
}) {
  const frame = useCurrentFrame();
  const t = frame / FPS;
  const pal = PALETTE[background];

  // Group words into sentences by punctuation on the narration's tokens.
  const tokens = narration.split(/\s+/).filter(Boolean);
  const sentences: { start: number; end: number; idx: number[] }[] = [];
  let cur: number[] = [];
  tokens.forEach((tok, i) => {
    cur.push(i);
    if (/[.!?]["')]?$/.test(tok) || i === tokens.length - 1) {
      const ws = cur.map((j) => words[j]).filter(Boolean) as typeof words;
      if (ws.length) sentences.push({ start: ws[0]!.start, end: ws.at(-1)!.end, idx: [...cur] });
      cur = [];
    }
  });
  const active = sentences.find((s) => t >= s.start - 0.05 && t <= s.end + 0.35);
  if (!active) return null;
  const spoken = words.findIndex((w) => t >= w.start && t < w.end);

  return (
    <div
      style={{
        position: "absolute",
        right: 72,
        bottom: 72,
        maxWidth: 820,
        textAlign: "right",
        fontFamily: "Inter, system-ui, sans-serif",
        fontWeight: 600,
        fontSize: 44,
        lineHeight: 1.25,
        color: pal.ink,
        textShadow: background === "dark" ? "0 2px 12px rgba(0,0,0,0.5)" : "0 2px 12px rgba(255,255,255,0.6)",
      }}
    >
      {active.idx.map((i) => (
        <span key={i} style={{ opacity: i <= spoken || spoken === -1 ? 1 : 0.45 }}>
          {tokens[i]}{" "}
        </span>
      ))}
    </div>
  );
}
