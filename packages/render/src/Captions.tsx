import { useCurrentFrame } from "remotion";
import { FPS, PALETTE } from "./props.js";
import type { ExplainerProps } from "./props.js";
import { activeChunk, captionChunks } from "./captions-layout.js";

/**
 * Word-timed captions, bottom-right, in the house safe area: one sentence (or
 * half of a long one) at a time, at most two lines, with the word being spoken
 * highlighted and the words to come dimmed. The timing comes from the word
 * timestamps, so the highlight tracks the voice.
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
  const tokens = narration.split(/\s+/).filter(Boolean);
  const active = activeChunk(captionChunks(narration, words), t);
  if (!active) return null;

  // The word being spoken: the last one that has started (so a pause between words doesn't flicker).
  let current = -1;
  for (const i of active.idx) if (words[i] && words[i]!.start <= t) current = i;

  const highlight = background === "light" ? "rgba(242,193,78,0.55)" : background === "math" ? "rgba(255,255,102,0.28)" : "rgba(242,193,78,0.32)";
  // Words still to come: dimmed, a little less so on dark backgrounds where thin light text fades fast.
  const upcoming = background === "light" ? 0.45 : 0.6;

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
        lineHeight: 1.3,
        color: pal.ink,
        textShadow: background === "light" ? "0 2px 12px rgba(255,255,255,0.6)" : "0 2px 12px rgba(0,0,0,0.5)",
      }}
    >
      {active.idx.map((i) => (
        <span
          key={i}
          style={{
            opacity: i <= current ? 1 : upcoming,
            background: i === current ? highlight : "transparent",
            borderRadius: 10,
            padding: "0 6px",
            margin: "0 -6px",
            boxDecorationBreak: "clone",
            WebkitBoxDecorationBreak: "clone",
          }}
        >
          {tokens[i]}
        </span>
      )).flatMap((el, k) => (k ? [" ", el] : [el]))}
    </div>
  );
}
