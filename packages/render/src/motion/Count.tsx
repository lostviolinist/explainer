import { AbsoluteFill } from "remotion";
import type { AnimSpec } from "@explainer/schemas";
import type { ExplainerProps } from "../props.js";
import { Cue, Disc, enter, useT, type Area } from "./Pieces.js";
import { cueTimes, ease } from "./timing.js";
import type { Theme } from "./theme.js";

type Spec = Extract<AnimSpec, { kind: "count" }>;
type Scene = ExplainerProps["scenes"][number];

/**
 * One number that matters: it counts up on its cue. Out of something, a grid
 * of a hundred dots fills in proportion beside it; then the comparison that
 * makes the number mean something slides in underneath.
 */
export function Count({ spec, scene, theme, sfx, area }: { spec: Spec; scene: Scene; theme: Theme; sfx: Record<string, string>; area: Area }) {
  const t = useT();
  const [at = 0.4, cmpAt = 2] = cueTimes(scene.words, scene.narration, scene.durationS, [spec.cue, spec.comparison?.cue ?? ""]);
  const grown = ease(t, at + 0.15, 1.3);
  const shown = spec.value * grown;
  const share = spec.outOf ? Math.max(0, Math.min(1, spec.value / spec.outOf)) : null;
  const withGrid = share !== null;
  const text = spec.value >= 100 || Number.isInteger(spec.value) ? Math.round(shown).toLocaleString("en-US") : (Math.round(shown * 10) / 10).toLocaleString("en-US");
  const dot = area.picture ? 24 : 30;
  const gap = area.picture ? 10 : 14;
  const gridW = dot * 10 + gap * 9;
  const centred = !withGrid && !area.picture;
  const big = area.picture ? 150 : withGrid ? 180 : 210;

  return (
    <AbsoluteFill style={{ fontFamily: theme.font }}>
      <Cue src={sfx.whoosh} at={at} />
      {spec.comparison && <Cue src={sfx.pop} at={cmpAt} />}
      <div style={{ position: "absolute", left: centred ? 0 : area.x, right: centred ? 0 : undefined, width: centred ? undefined : withGrid ? area.w - gridW - 60 : area.w, top: centred ? 300 : 250, textAlign: centred ? "center" : "left", ...enter(t, at, 0.5, "up") }}>
        <div style={{ fontSize: big, fontWeight: 700, color: theme.ink, letterSpacing: -6, lineHeight: 1, whiteSpace: "nowrap" }}>
          {text}
          {spec.unit && <span style={{ fontSize: big * 0.36, fontWeight: 500, color: theme.muted, marginLeft: 18, letterSpacing: 0 }}>{spec.unit}</span>}
        </div>
        <div style={{ marginTop: 22, fontSize: 44, fontWeight: 500, color: theme.ink, lineHeight: 1.2, maxWidth: centred ? 1300 : undefined, marginLeft: centred ? "auto" : 0, marginRight: centred ? "auto" : 0 }}>{spec.label}</div>
      </div>
      {withGrid && (
        <div style={{ position: "absolute", left: area.x + area.w - gridW, top: 230, display: "grid", gridTemplateColumns: `repeat(10, ${dot}px)`, gap, ...enter(t, at, 0.5, "pop") }}>
          {Array.from({ length: 100 }, (_, i) => (
            <div key={i} style={{ width: dot, height: dot, borderRadius: "50%", background: i < Math.round(share! * 100 * grown) ? theme.yellow : theme.track }} />
          ))}
        </div>
      )}
      {spec.comparison && (
        <div style={{ position: "absolute", left: area.x + (centred ? 64 : 0), top: 720, display: "flex", alignItems: "center", gap: 26, width: area.w - 40, ...enter(t, cmpAt, 0.5, "left") }}>
          <Disc icon={spec.comparison.icon} color={theme.accents[1]!} size={104} theme={theme} />
          <div style={{ fontSize: 40, fontWeight: 500, color: theme.ink, lineHeight: 1.2 }}>{spec.comparison.text}</div>
        </div>
      )}
    </AbsoluteFill>
  );
}
