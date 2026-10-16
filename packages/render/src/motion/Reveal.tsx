import { AbsoluteFill, Img } from "remotion";
import type { AnimSpec } from "@explainer/schemas";
import type { ExplainerProps } from "../props.js";
import { Drift } from "../SceneLayers.js";
import { Cue, Pill, pillWidth, useT } from "./Pieces.js";
import { cueTimesEach, ease } from "./timing.js";
import { FRAME, type Theme } from "./theme.js";

type Spec = Extract<AnimSpec, { kind: "reveal" }>;
type Scene = ExplainerProps["scenes"][number];

const SIZE = 36;
const PAD = 40;

/** Where a label goes for a point: beside it, away from the frame's edges and the caption box. */
function place(px: number, py: number, text: string) {
  const w = pillWidth(text, SIZE);
  const h = SIZE * 1.9;
  const gap = 58;
  const candidates: { x: number; y: number }[] = [
    { x: px + gap, y: py - h / 2 - 26 }, // right
    { x: px - gap - w, y: py - h / 2 - 26 }, // left
    { x: px - w / 2, y: py - gap - h }, // above
    { x: px - w / 2, y: py + gap }, // below
  ];
  const fits = (c: { x: number; y: number }) =>
    c.x >= PAD && c.x + w <= FRAME.w - PAD && c.y >= PAD && c.y + h <= FRAME.h - PAD && !(c.x + w > FRAME.captionX && c.y + h > FRAME.captionY);
  const pick = candidates.find(fits) ?? candidates[2]!;
  const x = Math.max(PAD, Math.min(FRAME.w - PAD - w, pick.x));
  const y = Math.max(PAD, Math.min(FRAME.captionY - h - 8, pick.y));
  // The leader meets the pill on the edge facing the point.
  const ax = px < x ? x : px > x + w ? x + w : Math.max(x, Math.min(x + w, px));
  const ay = py < y ? y : py > y + h ? y + h : py;
  return { x, y, w, h, ax, ay };
}

/**
 * Callouts over the illustration: as each part is mentioned, a dot lands on
 * it, a leader draws to a label beside it, and the label pops. The picture
 * and the callouts drift together, so the dots stay on their parts. Parts
 * that could not be located stack in a column instead.
 */
export function Reveal({ spec, scene, theme, sfx }: { spec: Spec; scene: Scene; theme: Theme; sfx: Record<string, string> }) {
  const t = useT();
  const still = scene.visuals.find((v) => v.role === "still" || v.role === "background");
  // Each callout lands on its own word, whatever order the parts were listed in.
  const times = cueTimesEach(scene.words, scene.narration, scene.durationS, spec.items.map((i) => i.cue));
  const current = times.reduce((c, at, i) => (t >= at && (c < 0 || at >= times[c]!) ? i : c), -1);
  // Unlocated parts stack in a column in the order they appear.
  const columnOrder = spec.items.map((item, i) => ({ i, at: times[i]! })).filter(({ i }) => spec.items[i]!.x === null || spec.items[i]!.y === null).sort((a, b) => a.at - b.at).map((x) => x.i);
  return (
    <Drift scene={scene}>
      {still && <Img src={still.asset.url} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />}
      {times.map((at, i) => (
        <Cue key={`r${i}`} src={sfx.pop} at={at} />
      ))}
      <AbsoluteFill style={{ fontFamily: theme.font }}>
        <svg width={FRAME.w} height={FRAME.h} style={{ position: "absolute", inset: 0 }}>
          {spec.items.map((item, i) => {
            const at = times[i]!;
            if (t < at || item.x === null || item.y === null) return null;
            const px = item.x * FRAME.w, py = item.y * FRAME.h;
            const color = theme.accents[i % theme.accents.length]!;
            const p = place(px, py, item.label);
            const ring = ease(t, at, 0.8);
            const lead = ease(t, at + 0.1, 0.35);
            return (
              <g key={i} opacity={current === i ? 1 : 0.85}>
                {ring < 1 && <circle cx={px} cy={py} r={14 + 40 * ring} fill="none" stroke={color} strokeWidth={5} opacity={1 - ring} />}
                <circle cx={px} cy={py} r={15} fill={color} stroke={theme.bg} strokeWidth={4} />
                <line x1={px} y1={py} x2={px + (p.ax - px) * lead} y2={py + (p.ay - py) * lead} stroke={color} strokeWidth={6} strokeLinecap="round" />
              </g>
            );
          })}
        </svg>
        {spec.items.map((item, i) => {
          const at = times[i]!;
          if (t < at) return null;
          const color = theme.accents[i % theme.accents.length]!;
          const e = ease(t, at + 0.3, 0.4);
          const located = item.x !== null && item.y !== null;
          const p = located ? place(item.x! * FRAME.w, item.y! * FRAME.h, item.label) : { x: 96, y: 150 + 84 * columnOrder.indexOf(i) };
          return (
            <div key={i} style={{ position: "absolute", left: p.x, top: p.y, opacity: Math.min(1, e * 1.3) * (current === i ? 1 : 0.85), transform: `scale(${0.8 + 0.2 * e})`, transformOrigin: located && item.x! * FRAME.w > p.x ? "right center" : "left center" }}>
              <Pill text={item.label} color={color} ink={theme.onAccent} size={SIZE} style={{ boxShadow: "0 6px 24px rgba(0,0,0,0.18)" }} />
            </div>
          );
        })}
      </AbsoluteFill>
    </Drift>
  );
}
