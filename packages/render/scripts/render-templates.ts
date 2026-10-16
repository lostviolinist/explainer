/**
 * Renders a frame of every motion template at a few moments, to look at the
 * design: `pnpm --filter @explainer/render templates [outDir]`. Needs
 * Remotion's headless Chrome (downloaded on first use).
 */
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExplainerProps } from "../src/props.js";
import { COMPOSITION_ID, FPS, sceneFrames } from "../src/props.js";
import { webpackOverride } from "../src/webpack-override.js";

const out = resolve(process.argv[2] ?? "templates-out");
const here = dirname(fileURLToPath(import.meta.url));

const words = (text: string, durationS: number) => {
  const ws = text.split(/\s+/);
  const per = (durationS - 0.6) / ws.length;
  return ws.map((w, i) => ({ w, start: +(0.3 + i * per).toFixed(3), end: +(0.3 + (i + 1) * per).toFixed(3) }));
};
const scene = (id: string, visualType: ExplainerProps["scenes"][number]["visualType"], narration: string, durationS: number, animSpec: ExplainerProps["scenes"][number]["animSpec"], visuals: ExplainerProps["scenes"][number]["visuals"] = []): ExplainerProps["scenes"][number] => ({
  id, narration, visualType, animSpec, audioUrl: "", durationS, words: words(narration, durationS), visuals, onScreenTerms: [], sounds: [],
});

// A stand-in illustration (a leaf cross-section in the house palette), inline so no network is needed.
const still =
  process.env.STILL_URL ??
  `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="#F6F3EC"/><path d="M300 180 Q960 60 1500 200 L1500 320 Q960 240 300 320 Z" fill="#B9D8A2"/><path d="M300 320 Q960 240 1500 320 L1500 620 Q960 560 300 620 Z" fill="#5FA36B"/><path d="M300 620 Q960 560 1500 620 L1500 900 Q960 980 300 900 Z" fill="#8FB8E8"/><circle cx="700" cy="760" r="60" fill="#F6F3EC"/><circle cx="1000" cy="800" r="70" fill="#F6F3EC"/><circle cx="1300" cy="740" r="50" fill="#F6F3EC"/><circle cx="1650" cy="200" r="90" fill="#F2C14E"/></svg>`,
  )}`;

export const scenes: ExplainerProps["scenes"] = [
  scene("steps", "motion", "First the sun warms the ground. Then warm air rises. As it rises it cools, and water condenses into cloud. Finally rain falls.", 12, {
    kind: "steps", title: "How rain happens", cycle: false,
    steps: [{ label: "Sun warms ground", sub: null, icon: "sun", cue: "sun" }, { label: "Warm air rises", sub: null, icon: "cloud", cue: "rises" }, { label: "Cools, condenses", sub: "into cloud", icon: "drop", cue: "cools" }, { label: "Rain falls", sub: null, icon: "wave", cue: "rain" }],
  }),
  scene("cycle", "motion", "Water evaporates from the sea, condenses into cloud, falls as rain, and runs back to the sea. Round and round.", 12, {
    kind: "steps", title: "The water cycle", cycle: true,
    steps: [{ label: "Evaporates", sub: null, icon: "sun", cue: "evaporates" }, { label: "Condenses", sub: null, icon: "cloud", cue: "condenses" }, { label: "Falls as rain", sub: null, icon: "drop", cue: "rain" }, { label: "Runs to sea", sub: null, icon: "wave", cue: "runs" }],
  }),
  scene("compare", "motion", "A cheetah tops out near one hundred and twenty kilometres an hour. A greyhound manages seventy. You, on a good day, about thirty. The cheetah wins by a mile.", 14, {
    kind: "compare", title: "Top speed",
    items: [{ label: "Cheetah", icon: "bolt", value: 120, unit: "km/h", note: "for a few seconds", cue: "cheetah" }, { label: "Greyhound", icon: "person", value: 70, unit: "km/h", note: null, cue: "greyhound" }, { label: "You", icon: "person", value: 30, unit: "km/h", note: "on a good day", cue: "You" }],
    verdict: "Four times faster than you", verdictCue: "wins",
  }),
  scene("count", "motion", "Seventy one percent of Earth's surface is water. That is more than two Atlantic oceans for every patch of land.", 10, {
    kind: "count", value: 71, unit: "%", label: "of Earth's surface is water", cue: "Seventy", outOf: 100,
    comparison: { text: "More than two Atlantics for every patch of land", icon: "earth", cue: "two" },
  }),
  scene("count2", "motion", "Light takes eight minutes to reach us from the Sun. Look up and you see the Sun as it was eight minutes ago.", 9, {
    kind: "count", value: 8, unit: "minutes", label: "for sunlight to reach Earth", cue: "eight", outOf: null,
    comparison: { text: "You see the Sun as it was eight minutes ago", icon: "sun", cue: "ago" },
  }),
  scene("split", "motion", "Many people think we lose most body heat through the head. We do not. The head loses heat like any other part; it is just the part we leave uncovered.", 12, {
    kind: "split",
    left: { heading: "Myth", text: "You lose most of your body heat through your head", icon: "person", cue: "Many" },
    right: { heading: "Fact", text: "Your head loses heat like any other part. It's just the one left uncovered", icon: "thermometer", cue: "do" },
    winner: "right", verdictCue: "like",
  }),
  scene("points", "text", "So: chlorophyll fades, the yellows were there all along, and the reds are made fresh in autumn.", 9, {
    kind: "points", title: "Three things to remember",
    points: [{ text: "Chlorophyll fades first", icon: "leaf", cue: "chlorophyll" }, { text: "The yellows were there all along", icon: null, cue: "yellows" }, { text: "Reds are made fresh in autumn", icon: "sun", cue: "reds" }],
  }),
  scene("chart", "chart", "Blue light scatters about five times more than red light; green sits in between.", 9, {
    kind: "chart", title: "How much each colour scatters", unit: "×",
    series: [{ label: "Blue", value: 5.5, cue: "Blue" }, { label: "Green", value: 2.5, cue: "green" }, { label: "Red", value: 1, cue: "red" }],
    claimId: "c3",
  }),
  scene("reveal", "diagram", "The leaf has three layers. The waxy skin on top, the packed green cells in the middle, and the spongy layer underneath with air pockets.", 12, {
    kind: "reveal",
    items: [{ label: "Waxy skin", cue: "skin", x: 0.3, y: 0.22 }, { label: "Green cells", cue: "green", x: 0.55, y: 0.5 }, { label: "Spongy layer", cue: "spongy", x: 0.72, y: 0.8 }],
  }, [{ asset: { url: still, contentType: "image/jpeg", durationMs: null }, role: "still" }]),
];

async function main() {
  const { bundle } = await import("@remotion/bundler");
  const { renderStill, selectComposition, ensureBrowser } = await import("@remotion/renderer");
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
  if (!browserExecutable) await ensureBrowser();
  await mkdir(out, { recursive: true });
  const serveUrl = await bundle({ entryPoint: resolve(here, "../src/Root.tsx"), webpackOverride });
  for (const background of ["light", "dark"] as const) {
    const props: ExplainerProps = { projectId: "templates", background, learningGoal: "After watching, the viewer can explain it.", scenes, sources: [], music: null, sfx: {} };
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props, browserExecutable });
    let offset = 0;
    for (const s of scenes) {
      if (background === "dark" && !["steps", "compare", "split", "reveal"].includes(s.id)) { offset += sceneFrames(s.durationS); continue; }
      for (const k of [0.3, 0.6, 0.95]) {
        const frame = offset + Math.round(s.durationS * k * FPS);
        const output = join(out, `${s.id}-${background}-${Math.round(k * 100)}.png`);
        await renderStill({ composition, serveUrl, inputProps: props, frame, output, imageFormat: "png", logLevel: "error", browserExecutable });
        console.log(output);
      }
      offset += sceneFrames(s.durationS);
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
