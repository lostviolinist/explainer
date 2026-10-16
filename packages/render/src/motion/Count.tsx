import { AbsoluteFill } from "remotion";
import type { AnimSpec } from "@explainer/schemas";
import type { ExplainerProps } from "../props.js";
import { Cue, Disc, enter, useT } from "./Pieces.js";
import { cueTimes, ease } from "./timing.js";
import type { Theme } from "./theme.js";

type Spec = Extract<AnimSpec, { kind: "count" }>;
type Scene = ExplainerProps["scenes"][number];

/**
 * One number that matters: it counts up on its cue. Out of something, a grid
 * of a hundred dots fills in proportion beside it; then the comparison that
 * makes the number mean something slides in underneath.
 */
export function Count({ spec, scene, theme, sfx }: { spec: Spec; scene: Scene; theme: Theme; sfx: Record<string, string> }) {
  const t = useT();
  const [at = 0.4, cmpAt = 2] = cueTimes(scene.words, scene.narration, scene.durationS, [spec.cue, spec.comparison?.cue ?? ""]);
  const grown = ease(t, at + 0.15, 1.3);
  const shown = spec.value * grown;
  const share = spec.outOf ? Math.max(0, Math.min(1, spec.value / spec.outOf)) : null;
  const withGrid = share !== null;
  const text = spec.value >= 100 || Number.isInteger(spec.value) ? Math.round(shown).toLocaleString("en-US") : (Math.round(shown * 10) / 10).toLocaleString("en-US");

  return (
    <AbsoluteFill style={{ fontFamily: theme.font }}>
      <Cue src={sfx.whoosh} at={at} />
      {spec.comparison && <Cue src={sfx.pop} at={cmpAt} />}
      <div style={{ position: "absolute", left: withGrid ? 160 : 0, right: withGrid ? undefined : 0, width: withGrid ? 1000 : undefined, top: withGrid ? 250 : 300, textAlign: withGrid ? "left" : "center", ...enter(t, at, 0.5, "up") }}>
        <div style={{ fontSize: withGrid ? 180 : 210, fontWeight: 700, color: theme.ink, letterSpacing: -6, lineHeight: 1, whiteSpace: "nowrap" }}>
          {text}
          {spec.unit && <span style={{ fontSize: 64, fontWeight: 500, color: theme.muted, marginLeft: 18, letterSpacing: 0 }}>{spec.unit}</span>}
        </div>
        <div style={{ marginTop: 22, fontSize: 46, fontWeight: 500, color: theme.ink, lineHeight: 1.2, maxWidth: withGrid ? 900 : 1300, marginLeft: withGrid ? 0 : "auto", marginRight: withGrid ? 0 : "auto" }}>{spec.label}</div>
      </div>
      {withGrid && (
        <div style={{ position: "absolute", left: 1300, top: 220, display: "grid", gridTemplateColumns: "repeat(10, 30px)", gap: 14, ...enter(t, at, 0.5, "pop") }}>
          {Array.from({ length: 100 }, (_, i) => (
            <div key={i} style={{ width: 30, height: 30, borderRadius: "50%", background: i < Math.round(share! * 100 * grown) ? theme.yellow : theme.track }} />
          ))}
        </div>
      )}
      {spec.comparison && (
        <div style={{ position: "absolute", left: 160, top: 720, display: "flex", alignItems: "center", gap: 28, maxWidth: 1500, ...enter(t, cmpAt, 0.5, "left") }}>
          <Disc icon={spec.comparison.icon} color={theme.accents[1]!} size={110} theme={theme} />
          <div style={{ fontSize: 42, fontWeight: 500, color: theme.ink, lineHeight: 1.2 }}>{spec.comparison.text}</div>
        </div>
      )}
    </AbsoluteFill>
  );
}
