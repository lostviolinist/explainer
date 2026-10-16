import { AbsoluteFill } from "remotion";
import type { AnimSpec } from "@explainer/schemas";
import type { ExplainerProps } from "../props.js";
import { Cue, Title, enter, useT, type Area } from "./Pieces.js";
import { cueTimes, ease, formatNumber } from "./timing.js";
import type { Theme } from "./theme.js";

type Spec = Extract<AnimSpec, { kind: "chart" }>;
type Scene = ExplainerProps["scenes"][number];

/** Numbers from a claim as bars: each grows from the baseline on its cue, its value counting up above it. */
export function Chart({ spec, scene, theme, sfx, area }: { spec: Spec; scene: Scene; theme: Theme; sfx: Record<string, string>; area: Area }) {
  const t = useT();
  const n = spec.series.length;
  const times = cueTimes(scene.words, scene.narration, scene.durationS, spec.series.map((s) => s.cue));
  const max = Math.max(...spec.series.map((s) => Math.abs(s.value)), 1e-9);
  const base = 740;
  const tall = 400;
  const gap = area.picture ? 48 : 72;
  const width = Math.min(240, (area.w - 200 - (n - 1) * gap) / n);
  const left = area.x + (area.w - (n * width + (n - 1) * gap)) / 2;
  return (
    <AbsoluteFill style={{ fontFamily: theme.font }}>
      <Title text={spec.title} theme={theme} t={t} area={area} />
      {times.map((at, i) => (
        <Cue key={`b${i}`} src={sfx.pop} at={at} />
      ))}
      <div style={{ position: "absolute", left: area.x + 60, width: area.w - 120, top: base, height: 4, borderRadius: 2, background: theme.track }} />
      {spec.series.map((s, i) => {
        const at = times[i]!;
        const grown = ease(t, at, 0.9);
        const h = (Math.abs(s.value) / max) * tall * grown;
        const x = left + i * (width + gap);
        return (
          <div key={i} style={{ position: "absolute", left: x, width, top: 0, height: base, ...enter(t, at, 0.3, "pop") }}>
            <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: h, borderRadius: 18, background: theme.accents[i % theme.accents.length] }} />
            <div style={{ position: "absolute", left: -60, right: -60, bottom: h + 18, textAlign: "center", fontSize: 44, fontWeight: 600, color: theme.ink, whiteSpace: "nowrap" }}>
              {formatNumber(s.value * grown)}
              {spec.unit && <span style={{ fontSize: 28, fontWeight: 500, color: theme.muted, marginLeft: 6 }}>{spec.unit}</span>}
            </div>
            <div style={{ position: "absolute", left: -30, right: -30, top: base + 22, textAlign: "center", fontSize: 32, fontWeight: 500, color: theme.ink, lineHeight: 1.15 }}>{s.label}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
