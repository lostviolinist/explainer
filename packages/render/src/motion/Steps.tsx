import { AbsoluteFill } from "remotion";
import type { AnimSpec } from "@explainer/schemas";
import type { ExplainerProps } from "../props.js";
import { Cue, Disc, DrawPath, Title, enter, useT, type Area } from "./Pieces.js";
import { cueTimes, ease, pulse } from "./timing.js";
import type { Theme } from "./theme.js";

type Spec = Extract<AnimSpec, { kind: "steps" }>;
type Scene = ExplainerProps["scenes"][number];

type Node = { x: number; y: number; a: number };
type Link = { d: string; at: number; color: string; point: (k: number) => { x: number; y: number } };

/** Nodes across the frame (up to five, when there is room), on a ring for a cycle, or down the side beside a picture. */
function layout(n: number, cycle: boolean, area: Area): { nodes: Node[]; mode: "row" | "ring" | "column"; disc: number } {
  if (cycle && !area.picture) {
    const r = 300;
    return { mode: "ring", disc: 176, nodes: Array.from({ length: n }, (_, i) => ({ x: 960 + r * Math.cos(-Math.PI / 2 + (2 * Math.PI * i) / n), y: 520 + r * Math.sin(-Math.PI / 2 + (2 * Math.PI * i) / n), a: -Math.PI / 2 + (2 * Math.PI * i) / n })) };
  }
  if (!area.picture && n <= 5) {
    const left = n === 2 ? 560 : n === 3 ? 400 : 300;
    const right = 1920 - left;
    return { mode: "row", disc: n >= 5 ? 160 : 176, nodes: Array.from({ length: n }, (_, i) => ({ x: left + ((right - left) * i) / (n - 1), y: 470, a: 0 })) };
  }
  const top = 230, bottom = 880;
  const gap = Math.min(150, (bottom - top) / (n - 1));
  const y0 = top + ((bottom - top) - gap * (n - 1)) / 2;
  return { mode: "column", disc: n >= 6 ? 100 : 116, nodes: Array.from({ length: n }, (_, i) => ({ x: area.x + 70, y: y0 + gap * i, a: 0 })) };
}

/** Arc of the ring from node i to node j, clockwise, stopping short of both discs. */
function arc(from: Node, to: Node, disc: number): Pick<Link, "d" | "point"> {
  const r = 300;
  const gap = Math.asin((disc / 2 + 22) / r);
  const a0 = from.a + gap;
  const a1 = (from.a < to.a ? to.a : to.a + 2 * Math.PI) - gap;
  const p = (a: number) => `${(960 + r * Math.cos(a)).toFixed(1)} ${(520 + r * Math.sin(a)).toFixed(1)}`;
  return { d: `M ${p(a0)} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${p(a1)}`, point: (k) => ({ x: 960 + r * Math.cos(a0 + (a1 - a0) * k), y: 520 + r * Math.sin(a0 + (a1 - a0) * k) }) };
}

/**
 * Steps in order: each node pops in on its cue, the connector to it draws on
 * just before, and a dot keeps travelling along every drawn connector so the
 * flow stays alive. A cycle closes its ring after the last step. Beside a
 * picture (or with six steps) the steps run down the side like a timeline.
 */
export function Steps({ spec, scene, theme, sfx, area }: { spec: Spec; scene: Scene; theme: Theme; sfx: Record<string, string>; area: Area }) {
  const t = useT();
  const n = spec.steps.length;
  const times = cueTimes(scene.words, scene.narration, scene.durationS, spec.steps.map((s) => s.cue));
  const { nodes, mode, disc } = layout(n, spec.cycle, area);
  const current = times.reduce((c, at, i) => (t >= at ? i : c), -1);

  const links: Link[] = [];
  const pad = disc / 2 + 22;
  for (let i = 0; i + 1 < n; i++) {
    const a = nodes[i]!, b = nodes[i + 1]!;
    const color = theme.accents[(i + 1) % theme.accents.length]!;
    if (mode === "ring") links.push({ ...arc(a, b, disc), at: times[i + 1]!, color });
    else if (mode === "row") {
      const x0 = a.x + pad, x1 = b.x - pad;
      links.push({ d: `M ${x0} ${a.y} L ${x1} ${b.y}`, at: times[i + 1]!, color, point: (k) => ({ x: x0 + (x1 - x0) * k, y: a.y }) });
    } else {
      const y0 = a.y + pad, y1 = b.y - pad;
      links.push({ d: `M ${a.x} ${y0} L ${b.x} ${y1}`, at: times[i + 1]!, color, point: (k) => ({ x: a.x, y: y0 + (y1 - y0) * k }) });
    }
  }
  if (mode === "ring" && n > 2) links.push({ ...arc(nodes[n - 1]!, nodes[0]!, disc), at: times[n - 1]! + 1.1, color: theme.accents[0]! });
  // Space for each label: between the nodes in a row, the rest of the area in a column.
  const slot = mode === "row" ? (nodes[1]!.x - nodes[0]!.x) - 28 : mode === "ring" ? 360 : area.x + area.w - nodes[0]!.x - 90;
  const labelSize = mode === "column" ? 38 : n >= 5 ? 32 : n === 4 ? 36 : 40;

  return (
    <AbsoluteFill style={{ fontFamily: theme.font }}>
      <Title text={spec.title} theme={theme} t={t} area={area} />
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
              {dot && <circle cx={dot.x} cy={dot.y} r={12} fill={l.color} />}
            </g>
          );
        })}
      </svg>
      {spec.steps.map((s, i) => {
        const at = times[i]!;
        const p = nodes[i]!;
        const color = theme.accents[i % theme.accents.length]!;
        const grow = 1 + 0.07 * pulse(t, at + 0.35, 0.8);
        const dim = current > i && mode !== "ring" ? 0.78 : 1;
        const text = (
          <>
            <div style={{ fontSize: labelSize, fontWeight: 500, color: theme.ink, lineHeight: 1.15, opacity: dim }}>{s.label}</div>
            {s.sub && <div style={{ marginTop: 4, fontSize: labelSize * 0.72, color: theme.muted, lineHeight: 1.2 }}>{s.sub}</div>}
          </>
        );
        if (mode === "column") {
          return (
            <div key={i} style={{ position: "absolute", left: p.x - disc / 2, top: p.y - disc / 2, width: slot + disc, display: "flex", alignItems: "center", gap: 30, ...enter(t, at, 0.45, "left") }}>
              <div style={{ transform: `scale(${grow})`, opacity: dim }}>
                <Disc icon={s.icon} color={color} size={disc} theme={theme} />
              </div>
              <div style={{ minWidth: 0 }}>{text}</div>
            </div>
          );
        }
        return (
          <div key={i} style={{ position: "absolute", left: p.x - slot / 2, top: p.y - disc / 2, width: slot, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", ...enter(t, at, 0.45, "pop") }}>
            <div style={{ transform: `scale(${grow})`, opacity: dim }}>
              <Disc icon={s.icon} color={color} size={disc} theme={theme} />
            </div>
            <div style={{ marginTop: 20 }}>{text}</div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
}
