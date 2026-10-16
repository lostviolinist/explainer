import { AbsoluteFill, Audio, Sequence, useCurrentFrame } from "remotion";
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
  const s = 1 + 0.03 * x;
  return <AbsoluteFill style={{ transform: `scale(${s})`, transformOrigin: "50% 42%" }}>{children}</AbsoluteFill>;
}

/** The scene's title, top-left, in from below. */
export function Title({ text, theme, t, at = 0.35 }: { text: string | null; theme: Theme; t: number; at?: number }) {
  if (!text) return null;
  return (
    <div style={{ position: "absolute", left: 96, top: 84, fontFamily: theme.font, fontSize: 46, fontWeight: 600, letterSpacing: -0.5, color: theme.ink, ...enter(t, at, 0.5, "up") }}>
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
export function DrawPath({ d, stroke, width, progress, dash }: { d: string; stroke: string; width: number; progress: number; dash?: boolean }) {
  if (progress <= 0) return null;
  return <path d={d} fill="none" stroke={stroke} strokeWidth={width} strokeLinecap="round" pathLength={1} strokeDasharray={dash ? "0.04 0.03" : 1} strokeDashoffset={dash ? 0 : 1 - progress} style={dash ? { clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)` } : undefined} />;
}
