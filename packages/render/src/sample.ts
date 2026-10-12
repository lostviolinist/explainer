import type { ExplainerProps } from "./props.js";

/**
 * Sample props for Remotion Studio. Uses the house reference frames via a
 * placeholder URL; replace ASSETS_PUBLIC_BASE with your mirror when previewing.
 */
const base = process.env.ASSETS_PUBLIC_BASE ?? "https://example.invalid/assets";

const narration1 = "Here's the strange part. The star isn't where you see it.";
const narration2 = "Its light left in a straight line, but the black hole's gravity bent that path on the way to your eye.";

function evenWords(text: string, durationS: number) {
  const ws = text.split(/\s+/);
  const per = durationS / ws.length;
  return ws.map((w, i) => ({ w, start: +(i * per).toFixed(3), end: +((i + 1) * per).toFixed(3) }));
}

export const sampleProps: ExplainerProps = {
  projectId: "sample",
  background: "dark",
  learningGoal: "After watching, the viewer can explain why a star near a black hole appears somewhere it isn't.",
  scenes: [
    {
      id: "s1",
      narration: narration1,
      visualType: "still-animated",
      animSpec: { kind: "none" },
      audioUrl: `${base}/sample/s1.mp3`,
      durationS: 4.2,
      words: evenWords(narration1, 4.2),
      visuals: [{ asset: { url: `${base}/sample/black-hole.jpg`, contentType: "image/jpeg", durationMs: null }, role: "still" }],
      onScreenTerms: [],
      sounds: [],
    },
    {
      id: "s2",
      narration: narration2,
      visualType: "diagram",
      animSpec: {
        kind: "labelled-diagram",
        labels: [
          { text: "straight path", cueWord: "straight" },
          { text: "bent by gravity", cueWord: "gravity" },
        ],
      },
      audioUrl: `${base}/sample/s2.mp3`,
      durationS: 7.1,
      words: evenWords(narration2, 7.1),
      visuals: [{ asset: { url: `${base}/sample/black-hole.jpg`, contentType: "image/jpeg", durationMs: null }, role: "background" }],
      onScreenTerms: ["gravity"],
      sounds: [],
    },
  ],
  music: null,
  sfx: {},
  sources: [
    { title: "Gravitational lensing", domain: "nasa.gov", url: "https://science.nasa.gov" },
    { title: "General relativity", domain: "britannica.com", url: "https://www.britannica.com" },
  ],
};
