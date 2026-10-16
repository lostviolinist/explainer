import { AbsoluteFill } from "remotion";
import type { AnimSpec } from "@explainer/schemas";
import type { ExplainerProps } from "../props.js";
import { Cue, Disc, Pill, Title, enter, useT } from "./Pieces.js";
import { cueTimes, ease, formatNumber, pulse } from "./timing.js";
import type { Theme } from "./theme.js";

type Spec = Extract<AnimSpec, { kind: "compare" }>;
type Scene = ExplainerProps["scenes"][number];

/**
 * Two or three things side by side. Each column arrives on its cue; a
 * quantity counts up with a bar that grows beside the others, so the
 * difference is seen, not read. A verdict lands as a pill at the end.
 */
export function Compare({ spec, scene, theme, sfx }: { spec: Spec; scene: Scene; theme: Theme; sfx: Record<string, string> }) {
  const t = useT();
  const n = spec.items.length;
  const times = cueTimes(scene.words, scene.narration, scene.durationS, spec.items.map((i) => i.cue));
  const verdictAt = spec.verdict ? (spec.verdictCue ? cueTimes(scene.words, scene.narration, scene.durationS, [spec.verdictCue])[0]! : Math.min(scene.durationS - 1, times[n - 1]! + 1.4)) : Infinity;
  const centres = n === 2 ? [640, 1280] : [440, 960, 1480];
  const values = spec.items.map((i) => i.value);
  const max = Math.max(...values.map((v) => Math.abs(v ?? 0)), 1e-9);
  let biggest = -1;
  values.forEach((v, i) => {
    if (v !== null && (biggest < 0 || v > (values[biggest] ?? -Infinity))) biggest = i;
  });
  const anyValue = values.some((v) => v !== null);
  const top = spec.title ? 250 : 210;

  return (
    <AbsoluteFill style={{ fontFamily: theme.font }}>
      <Title text={spec.title} theme={theme} t={t} />
      {times.map((at, i) => (
        <Cue key={`c${i}`} src={sfx.pop} at={at} />
      ))}
      {spec.verdict && <Cue src={sfx.chime} at={verdictAt} volume={0.3} />}
      {spec.items.map((item, i) => {
        const at = times[i]!;
        const color = theme.accents[i % theme.accents.length]!;
        const grown = ease(t, at + 0.25, 1.1);
        const value = item.value !== null ? item.value * grown : null;
        const win = i === biggest && t >= verdictAt ? 1 + 0.06 * pulse(t, verdictAt, 1) : 1;
        return (
          <div key={i} style={{ position: "absolute", left: centres[i]! - 230, top, width: 460, display: "flex", flexDirection: "column", alignItems: "center", ...enter(t, at, 0.5, "up") }}>
            <div style={{ transform: `scale(${win})` }}>
              <Disc icon={item.icon} color={color} size={170} theme={theme} />
            </div>
            <div style={{ marginTop: 22, fontSize: 40, fontWeight: 500, color: theme.ink, textAlign: "center", lineHeight: 1.15 }}>{item.label}</div>
            {value !== null && (
              <>
                <div style={{ marginTop: 14, fontSize: 76, fontWeight: 600, color: theme.ink, letterSpacing: -1.5, lineHeight: 1.05, whiteSpace: "nowrap" }}>
                  {formatNumber(value)}
                  {item.unit && <span style={{ fontSize: 36, fontWeight: 500, color: theme.muted, marginLeft: 10 }}>{item.unit}</span>}
                </div>
                <div style={{ marginTop: 18, width: 380, height: 26, borderRadius: 13, background: theme.track, overflow: "hidden" }}>
                  <div style={{ width: `${(Math.abs(item.value!) / max) * 100 * grown}%`, height: "100%", borderRadius: 13, background: color }} />
                </div>
              </>
            )}
            {item.note && <div style={{ marginTop: value !== null ? 16 : 12, fontSize: 32, color: theme.muted, textAlign: "center", lineHeight: 1.2 }}>{item.note}</div>}
          </div>
        );
      })}
      {spec.items.slice(1).map((_, i) => (
        <div key={`vs${i}`} style={{ position: "absolute", left: (centres[i]! + centres[i + 1]!) / 2 - 40, top: top + 60, width: 80, textAlign: "center", fontSize: 34, fontWeight: 600, color: theme.muted, ...enter(t, times[i + 1]!, 0.4, "pop") }}>
          vs
        </div>
      ))}
      {spec.verdict && (
        <div style={{ position: "absolute", left: 0, right: 0, top: anyValue ? 760 : 700, display: "flex", justifyContent: "center", ...enter(t, verdictAt, 0.5, "pop") }}>
          <Pill text={spec.verdict} color={theme.yellow} ink={theme.onAccent} size={38} />
        </div>
      )}
    </AbsoluteFill>
  );
}
