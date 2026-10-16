import { AbsoluteFill } from "remotion";
import type { AnimSpec } from "@explainer/schemas";
import type { ExplainerProps } from "../props.js";
import { Cue, Disc, DrawPath, Title, enter, useT } from "./Pieces.js";
import { cueTimes, ease, pulse } from "./timing.js";
import type { Theme } from "./theme.js";

type Spec = Extract<AnimSpec, { kind: "steps" }>;
type Scene = ExplainerProps["scenes"][number];

const DISC = 176;
const CY = 500;

/** Where the nodes sit: a row across the frame, or a ring for a cycle. */
function layout(n: number, cycle: boolean): { x: number; y: number; a: number }[] {
  if (!cycle) {
    const left = n === 2 ? 560 : n === 3 ? 400 : 300;
    const right = 1920 - left;
    return Array.from({ length: n }, (_, i) => ({ x: n === 1 ? 960 : left + ((right - left) * i) / (n - 1), y: CY, a: 0 }));
  }
  const r = 300;
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return { x: 960 + r * Math.cos(a), y: 520 + r * Math.sin(a), a };
  });
}

/** Arc of the ring from node i to node j, clockwise, stopping short of both discs. */
function arc(from: { x: number; y: number; a: number }, to: { x: number; y: number; a: number }, n: number) {
  const r = 300;
  const gap = Math.asin((DISC / 2 + 22) / r);
  const a0 = from.a + gap;
  const a1 = (from.a < to.a ? to.a : to.a + 2 * Math.PI) - gap;
  const p = (a: number) => `${(960 + r * Math.cos(a)).toFixed(1)} ${(520 + r * Math.sin(a)).toFixed(1)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const d = `M ${p(a0)} A ${r} ${r} 0 ${large} 1 ${p(a1)}`;
  const at = (k: number) => ({ x: 960 + r * Math.cos(a0 + (a1 - a0) * k), y: 520 + r * Math.sin(a0 + (a1 - a0) * k), end: a1 });
  return { d, at, n };
}

/**
 * Steps in order: each node pops in on its cue, the connector to it draws on
 * just before, and a dot keeps travelling along every drawn connector so the
 * flow stays alive. A cycle closes its ring after the last step.
 */
export function Steps({ spec, scene, theme, sfx }: { spec: Spec; scene: Scene; theme: Theme; sfx: Record<string, string> }) {
  const t = useT();
  const n = spec.steps.length;
  const times = cueTimes(scene.words, scene.narration, scene.durationS, spec.steps.map((s) => s.cue));
  const pts = layout(n, spec.cycle);
  const current = times.reduce((c, at, i) => (t >= at ? i : c), -1);

  const links: { d: string; at: number; color: string; point: (k: number) => { x: number; y: number } }[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const a = pts[i]!, b = pts[i + 1]!;
    if (spec.cycle) {
      const { d, at } = arc(a, b, n);
      links.push({ d, at: times[i + 1]!, color: theme.accents[(i + 1) % theme.accents.length]!, point: at });
    } else {
      const x0 = a.x + DISC / 2 + 24, x1 = b.x - DISC / 2 - 24;
      links.push({ d: `M ${x0} ${a.y} L ${x1} ${b.y}`, at: times[i + 1]!, color: theme.accents[(i + 1) % theme.accents.length]!, point: (k) => ({ x: x0 + (x1 - x0) * k, y: a.y }) });
    }
  }
  if (spec.cycle && n > 2) {
    const { d, at } = arc(pts[n - 1]!, pts[0]!, n);
    links.push({ d, at: times[n - 1]! + 1.1, color: theme.accents[0]!, point: at });
  }

  return (
    <AbsoluteFill style={{ fontFamily: theme.font }}>
      <Title text={spec.title} theme={theme} t={t} />
      {times.map((at, i) => (
        <Cue key={`s${i}`} src={sfx.pop} at={at} />
      ))}
      <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
        {links.map((l, i) => {
          const drawn = ease(t, l.at - 0.55, 0.55);
          if (drawn <= 0) return null;
          const k = ((t - l.at) % 1.8) / 1.8;
          const dot = drawn >= 1 && t >= l.at ? l.point(k) : null;
          return (
            <g key={i}>
              <DrawPath d={l.d} stroke={theme.track} width={10} progress={drawn} />
              {dot && <circle cx={dot.x} cy={dot.y} r={13} fill={l.color} />}
            </g>
          );
        })}
      </svg>
      {spec.steps.map((s, i) => {
        const at = times[i]!;
        const p = pts[i]!;
        const color = theme.accents[i % theme.accents.length]!;
        const grow = 1 + 0.07 * pulse(t, at + 0.35, 0.8);
        const dim = current > i && !spec.cycle ? 0.78 : 1;
        return (
          <div key={i} style={{ position: "absolute", left: p.x - 200, top: p.y - DISC / 2, width: 400, display: "flex", flexDirection: "column", alignItems: "center", ...enter(t, at, 0.45, "pop") }}>
            <div style={{ transform: `scale(${grow})`, opacity: dim }}>
              <Disc icon={s.icon} color={color} size={DISC} theme={theme} />
            </div>
            <div style={{ marginTop: 22, fontSize: 40, fontWeight: 500, color: theme.ink, textAlign: "center", lineHeight: 1.15, opacity: dim }}>{s.label}</div>
            {s.sub && <div style={{ marginTop: 6, fontSize: 30, color: theme.muted, textAlign: "center" }}>{s.sub}</div>}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
