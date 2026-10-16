import { AbsoluteFill, Audio, Img, Sequence, useCurrentFrame } from "remotion";
import { FPS, SFX_VOLUME } from "../props.js";
import { iconPath } from "./icons.js";
import { ease } from "./timing.js";
import type { Theme } from "./theme.js";

/** The current second of the scene. */
export const useT = () => useCurrentFrame() / FPS;

/** A short sound at a second of the scene, when the kit has it. */
export function Cue({ src, at, volume = SFX_VOLUME }: { src?: string; at: number; volume?: number }) {
  if (!src || !(at >= 0)) return null;
  return (
    <Sequence from={Math.round(at * FPS)} name="cue">
      <Audio src={src} volume={volume} />
    </Sequence>
  );
}

/** A line icon, `size` px square. */
export function Icon({ name, size, color, width = 6 }: { name: string | null | undefined; size: number; color: string; width?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ display: "block", flex: "none" }}>
      <path d={iconPath(name)} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A solid accent disc with an icon: the recurring "thing" of every template. */
export function Disc({ icon, color, size = 160, theme, children, style }: { icon?: string | null; color: string; size?: number; theme: Theme; children?: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ width: size, height: size, borderRadius: "50%", background: color, display: "flex", alignItems: "center", justifyContent: "center", flex: "none", ...style }}>
      {children ?? <Icon name={icon} size={size * 0.52} color={theme.onAccent} width={6.5} />}
    </div>
  );
}

/** How a thing arrives: a soft pop, or a slide from a side, over `over` seconds from `at`. Before `at` it is not there. */
export function enter(t: number, at: number, over = 0.45, from: "pop" | "left" | "right" | "up" | "down" = "pop"): React.CSSProperties {
  if (t < at) return { opacity: 0, visibility: "hidden" };
  const e = ease(t, at, over);
  const tx = from === "left" ? -(1 - e) * 48 : from === "right" ? (1 - e) * 48 : 0;
  const ty = from === "up" ? (1 - e) * 28 : from === "down" ? -(1 - e) * 28 : 0;
  const scale = from === "pop" ? 0.72 + 0.28 * e : 1;
  return { opacity: Math.min(1, e * 1.4), transform: `translate(${tx}px, ${ty}px) scale(${scale})` };
}

/** The whole template drifts very slightly across the scene, so no frame is ever quite still. */
export function Breathe({ durationS, children }: { durationS: number; children: React.ReactNode }) {
  const t = useT();
  const x = Math.min(1, t / Math.max(1, durationS));
  const s = 1 + 0.035 * x;
  return <AbsoluteFill style={{ transform: `scale(${s}) translateX(${-6 * x}px)`, transformOrigin: "50% 45%" }}>{children}</AbsoluteFill>;
}

/**
 * Where a template lays its content out: the whole frame, or the part beside
 * the picture panel. The bottom-right stays clear for the captions either way.
 */
export type Area = { x: number; w: number; picture: boolean };
export const FULL: Area = { x: 96, w: 1728, picture: false };
export const BESIDE: Area = { x: 860, w: 964, picture: true };
export const PANEL = { x: 120, y: 150, w: 640, h: 780 } as const;

/** A soft accent blob in the background, so the frame has depth before anything arrives. */
export function Backdrop({ theme, area }: { theme: Theme; area: Area }) {
  const t = useT();
  const c = theme.accents[1]!;
  const cx = area.picture ? PANEL.x + PANEL.w * 0.55 : 1560;
  const cy = area.picture ? PANEL.y + PANEL.h * 0.45 : 170;
  const r = area.picture ? 470 : 520;
  const e = ease(t, 0, 1.2);
  return (
    <svg width={1920} height={1080} style={{ position: "absolute", inset: 0 }}>
      <circle cx={cx} cy={cy} r={r * (0.8 + 0.2 * e)} fill={c} opacity={0.14 * e} />
    </svg>
  );
}

/** The scene's illustration beside the template, in a rounded panel that slowly pushes in. */
export function Picture({ src, t, durationS }: { src: string; t: number; durationS: number }) {
  const z = 1.02 + 0.08 * Math.min(1, t / Math.max(1, durationS));
  return (
    <div style={{ position: "absolute", left: PANEL.x, top: PANEL.y, width: PANEL.w, height: PANEL.h, borderRadius: 40, overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.18)", ...enter(t, 0.25, 0.6, "left") }}>
      <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${z})`, transformOrigin: "50% 40%" }} />
    </div>
  );
}

/** The scene's title, top-left of its area, in from below. */
export function Title({ text, theme, t, area = FULL, at = 0.35 }: { text: string | null; theme: Theme; t: number; area?: Area; at?: number }) {
  if (!text) return null;
  return (
    <div style={{ position: "absolute", left: area.x, top: 78, maxWidth: area.w, fontFamily: theme.font, fontSize: 50, fontWeight: 600, letterSpacing: -0.5, lineHeight: 1.1, color: theme.ink, ...enter(t, at, 0.5, "up") }}>
      {text}
    </div>
  );
}

/** A self-sizing label pill: words never spill, because the browser sizes the box. */
export function Pill({ text, color, ink, size = 36, style }: { text: string; color: string; ink: string; size?: number; style?: React.CSSProperties }) {
  return (
    <div style={{ display: "inline-block", padding: `${size * 0.34}px ${size * 0.72}px`, borderRadius: 999, background: color, color: ink, fontSize: size, fontWeight: 500, lineHeight: 1.2, whiteSpace: "nowrap", ...style }}>
      {text}
    </div>
  );
}

/** Rough width of a pill, for placing it before it is measured. */
export const pillWidth = (text: string, size = 36) => text.length * size * 0.56 + size * 1.44;

/** A stroked path that draws itself on: progress 0–1. */
export function DrawPath({ d, stroke, width, progress }: { d: string; stroke: string; width: number; progress: number }) {
  if (progress <= 0) return null;
  return <path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1 - progress} />;
}
