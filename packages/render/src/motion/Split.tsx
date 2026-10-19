import { AbsoluteFill } from "remotion";
import type { AnimSpec } from "@explainer/schemas";
import type { ExplainerProps } from "../props.js";
import { Cue, Disc, Icon, enter, useT, type Area } from "./Pieces.js";
import { cueTimes, pulse } from "./timing.js";
import type { Theme } from "./theme.js";

type Spec = Extract<AnimSpec, { kind: "split" }>;
type Scene = ExplainerProps["scenes"][number];

/**
 * Two sides: myth and fact, before and after. Both cards stand from the start
 * with their headings, so the frame is never empty while the narration sets
 * the scene up; each card's words land on its cue. At the verdict the losing
 * side is stamped and dimmed, the winning side is stamped and lifted.
 */
export function Split({ spec, scene, theme, sfx }: { spec: Spec; scene: Scene; theme: Theme; sfx: Record<string, string>; area?: Area }) {
  const t = useT();
  const [leftAt, rightAt] = cueTimes(scene.words, scene.narration, scene.durationS, [spec.left.cue, spec.right.cue]);
  const verdictAt = spec.winner === "neither" ? Infinity : spec.verdictCue ? cueTimes(scene.words, scene.narration, scene.durationS, [spec.verdictCue])[0]! : Math.min(scene.durationS - 0.8, Math.max(leftAt!, rightAt!) + 1.3);
  const sides = [
    { side: spec.left, at: leftAt!, x: 140, from: "left" as const, color: theme.accents[2]! },
    { side: spec.right, at: rightAt!, x: 1000, from: "right" as const, color: theme.accents[3]! },
  ];
  return (
    <AbsoluteFill style={{ fontFamily: theme.font }}>
      <Cue src={sfx.whoosh} at={leftAt!} />
      <Cue src={sfx.whoosh} at={rightAt!} />
      {spec.winner !== "neither" && <Cue src={sfx.pop} at={verdictAt} />}
      {sides.map(({ side, at, x, from, color }, i) => {
        const wins = spec.winner === (i === 0 ? "left" : "right");
        const judged = t >= verdictAt;
        const lift = judged && wins ? 1 + 0.03 * Math.min(1, (t - verdictAt) / 0.5) : 1;
        return (
          <div key={i} style={{ position: "absolute", left: x, top: 230, width: 780, height: 520, ...enter(t, 0.4 + 0.12 * i, 0.55, from) }}>
            <div style={{ position: "absolute", inset: 0, borderRadius: 36, background: theme.card, padding: 48, display: "flex", flexDirection: "column", opacity: judged && !wins ? 0.5 : 1, transform: `scale(${lift})` }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: 3, textTransform: "uppercase", color: theme.muted }}>{side.heading}</div>
                {side.icon && <Disc icon={side.icon} color={color} size={104} theme={theme} />}
              </div>
              <div style={{ flex: 1, display: "flex", alignItems: "center" }}>
                <div style={{ fontSize: 46, fontWeight: 500, color: theme.ink, lineHeight: 1.25, ...enter(t, at, 0.45, "up") }}>{side.text}</div>
              </div>
            </div>
            {judged && (
              <div style={{ position: "absolute", left: -34, top: -34, width: 104, height: 104, borderRadius: "50%", background: wins ? theme.green : theme.red, display: "flex", alignItems: "center", justifyContent: "center", transform: `scale(${1 + 0.15 * pulse(t, verdictAt, 0.6)})`, ...enter(t, verdictAt, 0.35, "pop") }}>
                <Icon name={wins ? "check" : "cross"} size={56} color="#F6F3EC" width={9} />
              </div>
            )}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
