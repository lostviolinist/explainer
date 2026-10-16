import type { ExplainerProps } from "../props.js";
import { Breathe } from "./Pieces.js";
import { theme } from "./theme.js";
import { Steps } from "./Steps.js";
import { Compare } from "./Compare.js";
import { Count } from "./Count.js";
import { Split } from "./Split.js";
import { Points } from "./Points.js";
import { Chart } from "./Chart.js";
import { Reveal } from "./Reveal.js";

type Scene = ExplainerProps["scenes"][number];

/**
 * The motion layer of a scene: one of the hand-designed templates, filled
 * with the scene's spec and timed to its narration. Nothing here is written
 * by a model; the model only chose the words, icons, numbers and cues.
 */
export function Motion({ scene, background, sfx = {} }: { scene: Scene; background: ExplainerProps["background"]; sfx?: Record<string, string> }) {
  const th = theme(background);
  const spec = scene.animSpec;
  const common = { scene, theme: th, sfx };
  switch (spec.kind) {
    case "steps":
      return <Breathe durationS={scene.durationS}><Steps spec={spec} {...common} /></Breathe>;
    case "compare":
      return <Breathe durationS={scene.durationS}><Compare spec={spec} {...common} /></Breathe>;
    case "count":
      return <Breathe durationS={scene.durationS}><Count spec={spec} {...common} /></Breathe>;
    case "split":
      return <Breathe durationS={scene.durationS}><Split spec={spec} {...common} /></Breathe>;
    case "points":
      return <Breathe durationS={scene.durationS}><Points spec={spec} {...common} /></Breathe>;
    case "chart":
      return <Breathe durationS={scene.durationS}><Chart spec={spec} {...common} /></Breathe>;
    case "reveal":
      return <Reveal spec={spec} {...common} />;
    default:
      return null;
  }
}

/** Scenes whose picture the motion layer draws itself (the still with callouts over it). */
export const drawsOwnPicture = (scene: Scene) => scene.animSpec.kind === "reveal";
