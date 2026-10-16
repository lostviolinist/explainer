import { PALETTE, accentsFor } from "../props.js";
import type { ExplainerProps } from "../props.js";

export type Background = ExplainerProps["background"];

/** The look of the templates on each background: the house palette, no outlines, generous space. */
export function theme(background: Background) {
  const pal = PALETTE[background];
  const dark = background !== "light";
  return {
    bg: pal.bg,
    ink: pal.ink,
    muted: pal.muted,
    /** Cards and tracks: ink at low alpha, so they sit in the background rather than on it. */
    card: dark ? "rgba(246,243,236,0.08)" : "rgba(27,34,53,0.06)",
    track: dark ? "rgba(246,243,236,0.18)" : "rgba(27,34,53,0.16)",
    /** Icons on accent discs are always navy: it reads on every accent, on both backgrounds. */
    onAccent: "#1B2235",
    accents: accentsFor(background),
    yellow: dark && background === "math" ? "#FFFF66" : "#F2C14E",
    red: background === "math" ? "#FC6255" : "#E4573D",
    green: background === "math" ? "#83C167" : "#5FA36B",
    font: "Inter, system-ui, sans-serif",
  };
}
export type Theme = ReturnType<typeof theme>;

/** The frame, and the box the captions own (bottom-right): nothing is placed there. */
export const FRAME = { w: 1920, h: 1080, margin: 96, captionX: 1000, captionY: 840 } as const;
