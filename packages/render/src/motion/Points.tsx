import { AbsoluteFill } from "remotion";
import type { AnimSpec } from "@explainer/schemas";
import type { ExplainerProps } from "../props.js";
import { Cue, Disc, Title, enter, useT, type Area } from "./Pieces.js";
import { cueTimes } from "./timing.js";
import type { Theme } from "./theme.js";

type Spec = Extract<AnimSpec, { kind: "points" }>;
type Scene = ExplainerProps["scenes"][number];

/** Key points, one line each, in from the left as they are said; the one being said is the bright one. */
export function Points({ spec, scene, theme, sfx, area }: { spec: Spec; scene: Scene; theme: Theme; sfx: Record<string, string>; area: Area }) {
  const t = useT();
  const times = cueTimes(scene.words, scene.narration, scene.durationS, spec.points.map((p) => p.cue));
  const current = times.reduce((c, at, i) => (t >= at ? i : c), -1);
  const n = spec.points.length;
  const gap = n > 4 ? 118 : 134;
  const top = spec.title ? 230 : 200 + (5 - n) * 30;
  const left = area.picture ? area.x : 200;
  return (
    <AbsoluteFill style={{ fontFamily: theme.font }}>
      <Title text={spec.title} theme={theme} t={t} area={area} />
      {times.map((at, i) => (
        <Cue key={`p${i}`} src={sfx.pop} at={at} />
      ))}
      {spec.points.map((p, i) => (
        <div key={i} style={{ position: "absolute", left, top: top + i * gap, display: "flex", alignItems: "center", gap: 30, width: area.x + area.w - left, opacity: current === i ? 1 : 0.7, ...enter(t, times[i]!, 0.5, "left") }}>
          <Disc icon={p.icon} color={theme.accents[i % theme.accents.length]!} size={96} theme={theme}>
            {p.icon ? undefined : <span style={{ fontSize: 46, fontWeight: 700, color: theme.onAccent }}>{i + 1}</span>}
          </Disc>
          <div style={{ fontSize: 46, fontWeight: 500, color: theme.ink, lineHeight: 1.2, minWidth: 0 }}>{p.text}</div>
        </div>
      ))}
    </AbsoluteFill>
  );
}
