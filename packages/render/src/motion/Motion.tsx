import type { ExplainerProps } from "../props.js";
import { AbsoluteFill } from "remotion";
import { BESIDE, Backdrop, Breathe, FULL, Picture, useT } from "./Pieces.js";
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
 * with the scene's spec and timed to its narration, beside the scene's
 * illustration when it has one. Nothing here is written by a model; the
 * model only chose the words, icons, numbers and cues.
 */
export function Motion({ scene, background, sfx = {} }: { scene: Scene; background: ExplainerProps["background"]; sfx?: Record<string, string> }) {
  const th = theme(background);
  const spec = scene.animSpec;
  const t = useT();
  if (spec.kind === "none") return null;
  if (spec.kind === "reveal") return <Reveal spec={spec} scene={scene} theme={th} sfx={sfx} />;
  const still = spec.kind === "split" ? undefined : scene.visuals.find((v) => v.role === "still" || v.role === "background");
  const area = still ? BESIDE : FULL;
  const common = { scene, theme: th, sfx, area };
  const body =
    spec.kind === "steps" ? <Steps spec={spec} {...common} />
    : spec.kind === "compare" ? <Compare spec={spec} {...common} />
    : spec.kind === "count" ? <Count spec={spec} {...common} />
    : spec.kind === "split" ? <Split spec={spec} {...common} />
    : spec.kind === "points" ? <Points spec={spec} {...common} />
    : <Chart spec={spec} {...common} />;
  return (
    <Breathe durationS={scene.durationS}>
      <AbsoluteFill>
        <Backdrop theme={th} area={area} />
        {still && <Picture src={still.asset.url} t={t} durationS={scene.durationS} />}
        {body}
      </AbsoluteFill>
    </Breathe>
  );
}

/** Scenes whose picture the motion layer draws itself: callouts over the still, or a template beside it. */
export const drawsOwnPicture = (scene: Scene) => scene.animSpec.kind !== "none";
