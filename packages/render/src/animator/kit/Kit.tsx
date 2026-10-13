/**
 * The flat motion toolkit: what Manim is to a 3Blue1Brown scene, this is to a
 * flat-illustration scene. Model-written code composes these on a timeline
 * (seconds from the scene start) and the kit does the easing, the draw-on,
 * the camera and the exits, so every scene moves the same good way.
 *
 * Grammar (mirrors Manim's): enter = draw (Create / DrawBorderThenFill), fade
 * (FadeIn), grow (GrowFromCenter), pop (with overshoot), slide; exit = fade
 * (FadeOut), shrink (ShrinkToCenter), undraw (Uncreate); <Transform> is
 * ReplacementTransform; <Move> is .animate.shift / MoveAlongPath; <Indicate>,
 * <Circumscribe>, <Flash> and <Highlight> draw attention; <Stage camera> is
 * MovingCameraScene; <Fixed> is fix_in_frame.
 *
 * Copied into every motion job by the sandbox server (three-server.ts).
 */
import React, { createContext, useContext, useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { evolvePath, getBoundingBox, getLength, getPointAtLength, interpolatePath } from "@remotion/paths";

export const W = 1920;
export const H = 1080;

/** The house palette. */
export const PALETTE = { ink: "#1B2235", paper: "#F6F3EC", navy: "#0B1C3F", yellow: "#F2C14E", blue: "#8FB8E8", red: "#E4573D", green: "#5FA36B" };

// ---------------------------------------------------------------------------
// Time and easing

/** Seconds since the scene started. */
export function useT(): number {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return frame / fps;
}

/** The scene's length in seconds. */
export function useDuration(): number {
  const { fps, durationInFrames } = useVideoConfig();
  return durationInFrames / fps;
}

export type Ease = "smooth" | "linear" | "out" | "in" | "spring";
const smooth = (x: number) => x * x * (3 - 2 * x);
const springy = (x: number) => (x >= 1 ? 1 : 1 - Math.exp(-5 * x) * Math.cos(7 * x));
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Progress 0→1 of something that starts at `at` and takes `over` seconds. */
export function prog(t: number, at: number, over = 1, ease: Ease = "smooth"): number {
  if (over <= 0) return t >= at ? 1 : 0;
  const x = clamp01((t - at) / over);
  switch (ease) {
    case "linear": return x;
    case "out": return 1 - (1 - x) ** 3;
    case "in": return x ** 3;
    case "spring": return springy(x);
    default: return smooth(x);
  }
}

export type Enter = "draw" | "fade" | "grow" | "pop" | "slide" | "none";
export type Exit = "fade" | "shrink" | "undraw" | "none";
export type Timing = { at?: number; over?: number; until?: number; enter?: Enter; exit?: Exit; ease?: Ease };
const EXIT_OVER = 0.5;

/** Enter progress p, exit progress q (0 until `until`), or null when not on screen. */
function presence(t: number, { at = 0, over = 1, until, enter = "draw", exit, ease }: Timing): { p: number; q: number } | null {
  if (t < at) return null;
  if (until !== undefined && t >= until + (exit === "none" ? 0 : EXIT_OVER)) return null;
  const p = enter === "none" ? 1 : prog(t, at, over, ease ?? (enter === "pop" ? "spring" : "smooth"));
  const q = until !== undefined && t >= until ? clamp01((t - until) / EXIT_OVER) : 0;
  return { p, q };
}

const scaleAbout = (cx: number, cy: number, s: number) => `translate(${cx} ${cy}) scale(${s}) translate(${-cx} ${-cy})`;
const pointAt = (path: string, len: number) => getPointAtLength(path, len) ?? { x: 0, y: 0 };

function safeBox(d: string): { cx: number; cy: number; w: number; h: number } {
  try {
    const b = getBoundingBox(d);
    return { cx: (b.x1 + b.x2) / 2, cy: (b.y1 + b.y2) / 2, w: b.width, h: b.height };
  } catch {
    return { cx: W / 2, cy: H / 2, w: 0, h: 0 };
  }
}

// ---------------------------------------------------------------------------
// Path helpers (all in frame pixels, 1920×1080)

export const circle = (cx: number, cy: number, r: number) => `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
export const ellipse = (cx: number, cy: number, rx: number, ry: number) => `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${2 * rx} 0 a ${rx} ${ry} 0 1 0 ${-2 * rx} 0 Z`;
export const rect = (x: number, y: number, w: number, h: number, r = 0) =>
  r <= 0
    ? `M ${x} ${y} h ${w} v ${h} h ${-w} Z`
    : `M ${x + r} ${y} h ${w - 2 * r} a ${r} ${r} 0 0 1 ${r} ${r} v ${h - 2 * r} a ${r} ${r} 0 0 1 ${-r} ${r} h ${-(w - 2 * r)} a ${r} ${r} 0 0 1 ${-r} ${-r} v ${-(h - 2 * r)} a ${r} ${r} 0 0 1 ${r} ${-r} Z`;
export const line = (x1: number, y1: number, x2: number, y2: number) => `M ${x1} ${y1} L ${x2} ${y2}`;
export const polygon = (points: [number, number][]) => `M ${points.map((p) => p.join(" ")).join(" L ")} Z`;
/** A line with an arrowhead folded into the path, so it draws on tip last. */
export const arrow = (x1: number, y1: number, x2: number, y2: number, head = 26) => {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const l = (ang: number) => `${x2 - head * Math.cos(a - ang)} ${y2 - head * Math.sin(a - ang)}`;
  return `M ${x1} ${y1} L ${x2} ${y2} M ${l(0.45)} L ${x2} ${y2} L ${l(-0.45)}`;
};
/** A gentle curve from A to B, bowing by `bow` pixels to the side. */
export const curve = (x1: number, y1: number, x2: number, y2: number, bow = 120) => {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  return `M ${x1} ${y1} Q ${mx - (dy / len) * bow} ${my + (dx / len) * bow} ${x2} ${y2}`;
};

// ---------------------------------------------------------------------------
// Stage, camera, still

type Cam = { x: number; y: number; zoom: number };
export type CameraKey = { at: number; x?: number; y?: number; zoom?: number; over?: number };
const CameraCtx = createContext<Cam>({ x: W / 2, y: H / 2, zoom: 1 });
const StageCtx = createContext(false);
const StillCtx = createContext<string | null>(null);

/** The sandbox wraps the scene in this when there is a still to draw under it. */
export function StillProvider({ href, children }: { href: string | null; children: React.ReactNode }) {
  return <StillCtx.Provider value={href}>{children}</StillCtx.Provider>;
}

function cameraAt(t: number, keys: CameraKey[] | undefined, drift: number): Cam {
  let cam: Cam = { x: W / 2, y: H / 2, zoom: 1 };
  if (!keys?.length) return { ...cam, zoom: drift };
  for (const k of [...keys].sort((a, b) => a.at - b.at)) {
    if (t < k.at) break;
    const target = { x: k.x ?? cam.x, y: k.y ?? cam.y, zoom: k.zoom ?? cam.zoom };
    const p = prog(t, k.at, k.over ?? 1.5);
    cam = { x: cam.x + (target.x - cam.x) * p, y: cam.y + (target.y - cam.y) * p, zoom: cam.zoom + (target.zoom - cam.zoom) * p };
    if (p >= 1) cam = target;
  }
  return cam;
}

/**
 * The root of every motion scene: one 1920×1080 drawing with a camera. Keys
 * move the camera (zoom 1.5 frames a subject at 1.5× over `over` seconds).
 */
export function Stage({ camera, children, background }: { camera?: CameraKey[]; children?: React.ReactNode; background?: string }) {
  const t = useT();
  const d = useDuration();
  const still = useContext(StillCtx);
  // With a still and no camera moves, a slow push-in keeps the picture alive.
  const cam = cameraAt(t, camera, still && !camera?.length ? 1 + 0.06 * (t / Math.max(1, d)) : 1);
  const transform = `translate(${W / 2} ${H / 2}) scale(${cam.zoom}) translate(${-cam.x} ${-cam.y})`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" style={{ position: "absolute", left: 0, top: 0, fontFamily: "Inter, system-ui, sans-serif" }}>
      {background && <rect width={W} height={H} fill={background} />}
      <CameraCtx.Provider value={cam}>
        <StageCtx.Provider value={true}>
          <g transform={transform}>
            {still && <image href={still} width={W} height={H} preserveAspectRatio="xMidYMid slice" />}
            {children}
          </g>
        </StageCtx.Provider>
      </CameraCtx.Provider>
    </svg>
  );
}

/** Children stay put on screen while the camera moves (titles, legends). */
export function Fixed({ children }: { children?: React.ReactNode }) {
  const cam = useContext(CameraCtx);
  return <g transform={`translate(${cam.x} ${cam.y}) scale(${1 / cam.zoom}) translate(${-W / 2} ${-H / 2})`}>{children}</g>;
}

// ---------------------------------------------------------------------------
// Shapes

export type ShapeProps = Timing & {
  d: string;
  fill?: string;
  stroke?: string;
  width?: number;
  opacity?: number;
  fillRule?: "nonzero" | "evenodd";
  dash?: string;
  transform?: string;
};

/** One path on the timeline. enter="draw" strokes it on, then fills it (the "Create" look). */
export function Shape({ d, fill = "none", stroke = "none", width = 8, opacity = 1, fillRule, dash, transform = "", ...timing }: ShapeProps) {
  const t = useT();
  const pr = presence(t, timing);
  const box = useMemo(() => safeBox(d), [d]);
  if (!pr) return null;
  const { p, q } = pr;
  const enter = timing.enter ?? "draw";
  const exit = timing.exit ?? "fade";
  let op = opacity;
  let tf = transform;
  let fillOpacity = 1;
  let strokeColor = stroke;
  let strokeOpacity = 1;
  let dashProps: { strokeDasharray?: string; strokeDashoffset?: string } = dash ? { strokeDasharray: dash } : {};
  if (enter === "draw" && p < 1) {
    const ev = evolvePath(clamp01(p / 0.8), d);
    dashProps = { strokeDasharray: ev.strokeDasharray, strokeDashoffset: String(ev.strokeDashoffset) };
    fillOpacity = clamp01((p - 0.55) / 0.45);
    if (stroke === "none" && fill !== "none") {
      // A filled shape with no stroke still draws on: its outline in the fill colour, fading as the fill arrives.
      strokeColor = fill;
      strokeOpacity = 1 - fillOpacity;
    }
  } else if (enter === "fade") op *= p;
  else if (enter === "grow") tf = `${tf} ${scaleAbout(box.cx, box.cy, p)}`;
  else if (enter === "pop") {
    tf = `${tf} ${scaleAbout(box.cx, box.cy, Math.max(0.001, p))}`;
    op *= clamp01(p * 3);
  } else if (enter === "slide") {
    tf = `${tf} translate(0 ${(1 - p) * 40})`;
    op *= p;
  }
  if (q > 0) {
    if (exit === "fade") op *= 1 - q;
    else if (exit === "shrink") tf = `${tf} ${scaleAbout(box.cx, box.cy, Math.max(0.001, 1 - q))}`;
    else if (exit === "undraw") {
      const ev = evolvePath(1 - q, d);
      dashProps = { strokeDasharray: ev.strokeDasharray, strokeDashoffset: String(ev.strokeDashoffset) };
      fillOpacity = 1 - q;
    }
  }
  return (
    <path
      d={d}
      fill={fill}
      fillOpacity={fillOpacity}
      fillRule={fillRule}
      stroke={strokeColor}
      strokeOpacity={strokeOpacity}
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={op}
      transform={tf || undefined}
      {...dashProps}
    />
  );
}

/** A group of shapes that enters and leaves together. `origin` is where it grows from. */
export function Group({ children, x = 0, y = 0, origin, opacity = 1, ...timing }: Timing & { children?: React.ReactNode; x?: number; y?: number; origin?: [number, number]; opacity?: number }) {
  const t = useT();
  const pr = presence(t, { ...timing, enter: timing.enter ?? "fade" });
  if (!pr) return null;
  const { p, q } = pr;
  const enter = timing.enter ?? "fade";
  const [ox, oy] = origin ?? [W / 2, H / 2];
  let tf = `translate(${x} ${y})`;
  let op = opacity;
  if (enter === "fade") op *= p;
  else if (enter === "grow") tf += ` ${scaleAbout(ox, oy, p)}`;
  else if (enter === "pop") {
    tf += ` ${scaleAbout(ox, oy, Math.max(0.001, p))}`;
    op *= clamp01(p * 3);
  } else if (enter === "slide") {
    tf += ` translate(0 ${(1 - p) * 40})`;
    op *= p;
  }
  if (q > 0) {
    if ((timing.exit ?? "fade") === "shrink") tf += ` ${scaleAbout(ox, oy, Math.max(0.001, 1 - q))}`;
    op *= 1 - q;
  }
  return <g transform={tf} opacity={op}>{children}</g>;
}

// ---------------------------------------------------------------------------
// Motion

/** Moves its children by (to − from), or along `path` (draw them at the path's start). */
export function Move({ children, from, to, path, at = 0, over = 1, ease = "smooth" }: { children?: React.ReactNode; from?: [number, number]; to?: [number, number]; path?: string; at?: number; over?: number; ease?: Ease }) {
  const t = useT();
  const p = prog(t, at, over, ease);
  let dx = 0;
  let dy = 0;
  if (path) {
    const start = pointAt(path, 0);
    const pt = pointAt(path, p * getLength(path));
    dx = pt.x - start.x;
    dy = pt.y - start.y;
  } else if (from && to) {
    dx = (to[0] - from[0]) * p;
    dy = (to[1] - from[1]) * p;
  }
  return <g transform={`translate(${dx} ${dy})`}>{children}</g>;
}

/**
 * One shape becomes another (ReplacementTransform), starting at `at`. Show the
 * `from` shape before that with <Shape until={at} exit="none" />; this takes over.
 */
export function Transform({ from, to, at = 0, over = 1, fill = "none", stroke = "none", width = 8, opacity = 1, until, exit }: { from: string; to: string; at?: number; over?: number; fill?: string; stroke?: string; width?: number; opacity?: number; until?: number; exit?: Exit }) {
  const t = useT();
  if (t < at) return null;
  const p = prog(t, at, over);
  let d = p <= 0 ? from : p >= 1 ? to : "";
  if (!d) {
    try {
      d = interpolatePath(p, from, to);
    } catch {
      d = p < 0.5 ? from : to;
    }
  }
  return <Shape d={d} fill={fill} stroke={stroke} width={width} opacity={opacity} enter="none" until={until} exit={exit} />;
}

/** A brief grow-and-back on its children (Indicate), about `origin`. */
export function Indicate({ children, at, origin, scale = 1.12, over = 0.8 }: { children?: React.ReactNode; at: number; origin: [number, number]; scale?: number; over?: number }) {
  const t = useT();
  const p = prog(t, at, over, "linear");
  const s = 1 + (scale - 1) * Math.sin(Math.PI * p);
  return <g transform={scaleAbout(origin[0], origin[1], s)}>{children}</g>;
}

/** A rounded ring draws itself around a box, holds, and undraws (Circumscribe). */
export function Circumscribe({ x, y, w, h, at, hold = 1.2, stroke = PALETTE.yellow, width = 8, pad = 18 }: { x: number; y: number; w: number; h: number; at: number; hold?: number; stroke?: string; width?: number; pad?: number }) {
  return <Shape d={rect(x - pad, y - pad, w + 2 * pad, h + 2 * pad, 24)} stroke={stroke} width={width} at={at} over={0.6} enter="draw" until={at + 0.6 + hold} exit="undraw" />;
}

/** Short lines burst out from a point (Flash). */
export function Flash({ x, y, at, color = PALETTE.yellow, r = 60 }: { x: number; y: number; at: number; color?: string; r?: number }) {
  const t = useT();
  if (t < at || t > at + 0.7) return null;
  const p = prog(t, at, 0.7, "out");
  return (
    <g opacity={1 - p} stroke={color} strokeWidth={6} strokeLinecap="round">
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        const r0 = r * 0.4 + r * 0.8 * p;
        const r1 = r0 + r * 0.35;
        return <line key={i} x1={x + r0 * Math.cos(a)} y1={y + r0 * Math.sin(a)} x2={x + r1 * Math.cos(a)} y2={y + r1 * Math.sin(a)} />;
      })}
    </g>
  );
}

/** Dims everything except a box (a spotlight), from `at` until `until`. */
export function Highlight({ x, y, w, h, at, until, dim = 0.45, r = 24, ink = PALETTE.ink }: { x: number; y: number; w: number; h: number; at: number; until?: number; dim?: number; r?: number; ink?: string }) {
  const d = `M 0 0 H ${W} V ${H} H 0 Z ${rect(x, y, w, h, r)}`;
  return <Shape d={d} fill={ink} opacity={dim} fillRule="evenodd" at={at} over={0.5} enter="fade" until={until} exit="fade" />;
}

/** Dots flowing along a path, forever (flow, current, traffic). */
export function Dots({ along, count = 6, r = 10, fill = PALETTE.blue, speed = 200, at = 0, until }: { along: string; count?: number; r?: number; fill?: string; speed?: number; at?: number; until?: number }) {
  const t = useT();
  const pr = presence(t, { at, over: 0.5, until, enter: "fade" });
  if (!pr) return null;
  const L = getLength(along);
  return (
    <g opacity={pr.p * (1 - pr.q)}>
      {Array.from({ length: count }, (_, i) => {
        const s = (((t - at) * speed + (i * L) / count) % L + L) % L;
        const pt = pointAt(along, s);
        return <circle key={i} cx={pt.x} cy={pt.y} r={r} fill={fill} />;
      })}
    </g>
  );
}

/** A bar that grows from its base to `value / max` of `h`. */
export function Bar({ x, y, w, h, value, max, fill = PALETTE.blue, at = 0, over = 1, until }: { x: number; y: number; w: number; h: number; value: number; max: number; fill?: string; at?: number; over?: number; until?: number }) {
  const t = useT();
  const p = prog(t, at, over, "out");
  const hh = Math.max(0, (h * value) / Math.max(max, 1e-6)) * p;
  if (t < at) return null;
  return <Shape d={rect(x, y + h - hh, w, hh, Math.min(12, w / 2))} fill={fill} enter="none" until={until} />;
}

/** A line or arrow that draws on from A to B (`bow` curves it). */
export function Connect({ from, to, at, over = 0.8, head = true, bow = 0, stroke = PALETTE.ink, width = 7, until, dash }: { from: [number, number]; to: [number, number]; at: number; over?: number; head?: boolean; bow?: number; stroke?: string; width?: number; until?: number; dash?: string }) {
  const d = bow ? curve(from[0], from[1], to[0], to[1], bow) : head ? arrow(from[0], from[1], to[0], to[1]) : line(from[0], from[1], to[0], to[1]);
  return <Shape d={d} stroke={stroke} width={width} at={at} over={over} enter="draw" until={until} exit="undraw" dash={dash} />;
}

// ---------------------------------------------------------------------------
// Text

export type LabelProps = Timing & {
  x: number;
  y: number;
  children: React.ReactNode;
  /** Pill colour; "none" for plain text. */
  color?: string;
  ink?: string;
  size?: number;
  anchor?: "start" | "middle" | "end";
  opacity?: number;
  weight?: number;
};

/**
 * Text that sizes itself (HTML inside the drawing), so a pill can never be
 * narrower than its words. Anchored at (x, y): left-middle, centre or right-middle.
 */
export function Label({ x, y, children, color = PALETTE.yellow, ink = PALETTE.ink, size = 44, anchor = "start", opacity = 1, weight = 700, ...timing }: LabelProps) {
  const t = useT();
  const inStage = useContext(StageCtx);
  const pr = presence(t, { ...timing, enter: timing.enter ?? "pop", over: timing.over ?? 0.6 });
  if (!pr) return null;
  const { p, q } = pr;
  const enter = timing.enter ?? "pop";
  const scale = enter === "pop" || enter === "grow" ? Math.max(0.001, p) : 1;
  const op = opacity * (enter === "fade" || enter === "slide" ? p : clamp01(p * 3)) * (1 - q);
  const pill = color !== "none";
  const div = (
    <div
      style={{
        position: "absolute",
        left: anchor === "middle" ? "50%" : anchor === "end" ? undefined : 0,
        right: anchor === "end" ? 0 : undefined,
        top: "50%",
        transform: `translate(${anchor === "middle" ? "-50%" : "0"}, -50%) scale(${scale})`,
        transformOrigin: anchor === "middle" ? "center" : anchor === "end" ? "right center" : "left center",
        opacity: op,
        padding: pill ? `${Math.round(size * 0.22)}px ${Math.round(size * 0.55)}px` : 0,
        borderRadius: 999,
        background: pill ? color : "transparent",
        color: ink,
        fontSize: size,
        fontWeight: weight,
        lineHeight: 1.15,
        whiteSpace: "nowrap",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {children}
    </div>
  );
  const bh = size * 3;
  if (inStage) {
    const bx = anchor === "middle" ? x - W / 2 : anchor === "end" ? x - W : x;
    return (
      <foreignObject x={bx} y={y - bh / 2} width={W} height={bh} style={{ overflow: "visible" }}>
        <div style={{ position: "relative", width: W, height: bh }}>{div}</div>
      </foreignObject>
    );
  }
  // Outside a Stage (older scenes): plain HTML, positioned in frame pixels.
  return (
    <div style={{ position: "absolute", left: anchor === "middle" ? x - W / 2 : anchor === "end" ? x - W : x, top: y - bh / 2, width: W, height: bh, pointerEvents: "none" }}>{div}</div>
  );
}

export type RowProps = {
  items: string[];
  x: number;
  y: number;
  /** Which point sits at (x, y): the row's left-middle, centre or right-middle (a Column's top-left, top-centre, top-right). */
  anchor?: "start" | "middle" | "end";
  gap?: number;
  /** Pill colour; "none" for plain words. */
  color?: string;
  ink?: string;
  size?: number;
  at?: number;
  /** Seconds between one item popping in and the next. */
  lag?: number;
  over?: number;
  until?: number;
  /** Items to light up (grow a little, yellow ring) while their words are spoken. */
  emphasize?: { index: number; at: number; until?: number }[];
  vertical?: boolean;
};

/**
 * A row (or column) of words or short items as self-sizing pills, laid out by
 * the browser: they can never overlap or spill. Items pop in one after another.
 */
export function Row({ items, x, y, anchor = "start", gap = 16, color = PALETTE.blue, ink = PALETTE.ink, size = 40, at = 0, lag = 0.12, over = 0.5, until, emphasize, vertical = false }: RowProps) {
  const t = useT();
  const inStage = useContext(StageCtx);
  if (t < at) return null;
  if (until !== undefined && t >= until + EXIT_OVER) return null;
  const q = until !== undefined && t >= until ? clamp01((t - until) / EXIT_OVER) : 0;
  const bh = vertical ? H : size * 3;
  const pill = color !== "none";
  const content = (
    <div
      style={{
        position: "absolute",
        left: anchor === "middle" ? "50%" : anchor === "end" ? undefined : 0,
        right: anchor === "end" ? 0 : undefined,
        top: vertical ? 0 : "50%",
        transform: `translate(${anchor === "middle" ? "-50%" : "0"}, ${vertical ? "0" : "-50%"})`,
        display: "flex",
        flexDirection: vertical ? "column" : "row",
        alignItems: vertical ? (anchor === "middle" ? "center" : anchor === "end" ? "flex-end" : "flex-start") : "center",
        gap,
        opacity: 1 - q,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {items.map((item, i) => {
        const p = prog(t, at + i * lag, over, "spring");
        const em = emphasize?.some((e) => e.index === i && t >= e.at && (e.until === undefined || t < e.until));
        return (
          <div
            key={i}
            style={{
              padding: pill ? `${Math.round(size * 0.22)}px ${Math.round(size * 0.55)}px` : 0,
              borderRadius: 999,
              background: pill ? color : "transparent",
              color: ink,
              fontSize: size,
              fontWeight: 700,
              lineHeight: 1.15,
              whiteSpace: "nowrap",
              transform: `scale(${Math.max(0.001, p) * (em ? 1.12 : 1)})`,
              opacity: clamp01(p * 3),
              boxShadow: em ? `0 0 0 6px ${PALETTE.yellow}` : undefined,
            }}
          >
            {item}
          </div>
        );
      })}
    </div>
  );
  const bx = anchor === "middle" ? x - W / 2 : anchor === "end" ? x - W : x;
  const by = vertical ? y : y - bh / 2;
  if (inStage) {
    return (
      <foreignObject x={bx} y={by} width={W} height={bh} style={{ overflow: "visible" }}>
        <div style={{ position: "relative", width: W, height: bh }}>{content}</div>
      </foreignObject>
    );
  }
  return <div style={{ position: "absolute", left: bx, top: by, width: W, height: bh, pointerEvents: "none" }}>{content}</div>;
}

/** A Row stacked vertically: (x, y) is its top-left, top-centre or top-right. */
export function Column(props: Omit<RowProps, "vertical">) {
  return <Row {...props} vertical />;
}

/** A number counting from `from` to `to` (a Label). */
export function Counter({ from, to, at, over = 1.5, decimals = 0, prefix = "", suffix = "", ...label }: { from: number; to: number; at: number; over?: number; decimals?: number; prefix?: string; suffix?: string } & Omit<LabelProps, "children" | "at" | "over">) {
  const t = useT();
  const v = from + (to - from) * prog(t, at, over, "out");
  return (
    <Label at={at} over={0.4} {...label}>
      {prefix}
      {v.toFixed(decimals)}
      {suffix}
    </Label>
  );
}

// ---------------------------------------------------------------------------
// Icons: simple line icons in a 100×100 box, drawn with the stroke so enter="draw" works.

export const ICONS: Record<string, string> = {
  sun: "M50 28 a22 22 0 1 0 0.1 0 Z M50 4 V16 M50 84 V96 M4 50 H16 M84 50 H96 M17.4 17.4 L25.9 25.9 M74.1 74.1 L82.6 82.6 M82.6 17.4 L74.1 25.9 M25.9 74.1 L17.4 82.6",
  moon: "M62 10 A40 40 0 1 0 90 62 A30 30 0 0 1 62 10 Z",
  eye: "M8 50 C30 20 70 20 92 50 C70 80 30 80 8 50 Z M50 36 a14 14 0 1 0 0.1 0 Z",
  molecule: "M30 66 a12 12 0 1 0 0.1 0 Z M70 66 a12 12 0 1 0 0.1 0 Z M50 30 a12 12 0 1 0 0.1 0 Z M40 56 L45 41 M60 56 L55 41 M42 66 H58",
  leaf: "M15 85 C15 40 50 15 90 12 C88 55 60 85 15 85 Z M15 85 C35 60 55 45 80 25",
  person: "M50 14 a12 12 0 1 0 0.1 0 Z M22 92 C22 62 78 62 78 92",
  people: "M35 22 a10 10 0 1 0 0.1 0 Z M12 80 C12 56 58 56 58 80 M68 30 a9 9 0 1 0 0.1 0 Z M58 76 C66 60 92 62 92 80",
  cloud: "M30 78 H74 a16 16 0 0 0 2 -32 a22 22 0 0 0 -42 -6 a18 18 0 0 0 -4 38 Z",
  gear: "M50 28 a22 22 0 1 0 0.1 0 Z M50 8 V22 M50 78 V92 M8 50 H22 M78 50 H92 M20 20 L30 30 M70 70 L80 80 M80 20 L70 30 M30 70 L20 80 M50 42 a8 8 0 1 0 0.1 0 Z",
  clock: "M50 10 a40 40 0 1 0 0.1 0 Z M50 26 V50 L66 60",
  drop: "M50 8 C50 8 20 46 20 64 a30 30 0 0 0 60 0 C80 46 50 8 50 8 Z",
  star: "M50 8 L61 38 L94 38 L67 57 L77 88 L50 70 L23 88 L33 57 L6 38 L39 38 Z",
  box: "M14 30 L50 12 L86 30 L86 70 L50 88 L14 70 Z M14 30 L50 48 L86 30 M50 48 V88",
  heart: "M50 88 C20 65 8 50 8 34 a18 18 0 0 1 42 -8 a18 18 0 0 1 42 8 C92 50 80 65 50 88 Z",
  bulb: "M50 10 a26 26 0 0 0 -14 48 V70 H64 V58 a26 26 0 0 0 -14 -48 Z M38 82 H62 M42 92 H58",
  earth: "M50 10 a40 40 0 1 0 0.1 0 Z M10 50 H90 M50 10 C30 30 30 70 50 90 M50 10 C70 30 70 70 50 90",
  bolt: "M56 6 L22 56 H46 L40 94 L78 42 H54 Z",
  arrow: "M10 50 H86 M62 26 L86 50 L62 74",
  check: "M14 52 L40 78 L88 24",
  cross: "M20 20 L80 80 M80 20 L20 80",
  question: "M30 34 a20 20 0 1 1 28 18 C52 56 50 60 50 68 M50 86 V88",
  flask: "M38 8 H62 M44 8 V38 L14 86 H86 L56 38 V8 M28 64 H72",
  wave: "M4 50 C16 20 28 20 40 50 C52 80 64 80 76 50 C84 32 92 32 96 40",
  mountain: "M4 86 L36 30 L54 58 L66 42 L96 86 Z M36 30 L28 44 L36 40 L44 44 Z",
  book: "M50 24 C40 14 24 14 12 18 V82 C24 78 40 78 50 88 C60 78 76 78 88 82 V18 C76 14 60 14 50 24 Z M50 24 V88",
  house: "M10 50 L50 14 L90 50 M22 42 V86 H78 V42 M42 86 V62 H58 V86",
  tree: "M50 10 L22 50 H36 L18 76 H82 L64 50 H78 Z M50 76 V94",
  brain: "M48 16 C36 10 24 18 24 30 C14 32 12 50 22 56 C16 68 28 80 40 76 C44 86 56 86 60 76 C72 80 84 68 78 56 C88 50 86 32 76 30 C76 18 64 10 52 16 M50 16 V84",
  rocket: "M50 6 C66 20 70 44 64 70 H36 C30 44 34 20 50 6 Z M36 70 L24 84 H40 M64 70 L76 84 H60 M50 38 a8 8 0 1 0 0.1 0 Z",
  magnet: "M24 10 V54 a26 26 0 0 0 52 0 V10 M24 10 H38 V54 a12 12 0 0 0 24 0 V10 H76",
  battery: "M8 32 H78 V68 H8 Z M78 44 H92 V56 H78 M16 40 H40 V60 H16 Z",
  thermometer: "M50 8 a10 10 0 0 1 10 10 V62 a16 16 0 1 1 -20 0 V18 a10 10 0 0 1 10 -10 Z M50 36 V72",
  magnifier: "M42 10 a32 32 0 1 0 0.1 0 Z M64 64 L90 90",
  coin: "M50 10 a40 40 0 1 0 0.1 0 Z M50 26 V74 M62 36 C60 28 40 28 40 42 C40 54 60 50 60 62 C60 74 40 74 38 66",
  dna: "M30 6 C30 30 70 40 70 60 C70 80 30 90 30 96 M70 6 C70 30 30 40 30 60 C30 80 70 90 70 96 M36 22 H64 M36 78 H64 M40 50 H60",
};

/** A line icon by name, centred at (x, y), `size` pixels wide. */
export function Icon({ name, x, y, size = 160, stroke = PALETTE.ink, fill = "none", width = 6, ...timing }: Timing & { name: string; x: number; y: number; size?: number; stroke?: string; fill?: string; width?: number }) {
  const d = ICONS[name] ?? ICONS.question!;
  const s = size / 100;
  return (
    <g transform={`translate(${x - size / 2} ${y - size / 2}) scale(${s})`}>
      <Shape d={d} stroke={stroke} fill={fill} width={width / s} {...timing} />
    </g>
  );
}
