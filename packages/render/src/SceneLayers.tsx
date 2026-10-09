import { AbsoluteFill, Freeze, Img, OffthreadVideo, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FPS, PALETTE, cueFrame } from "./props.js";
import type { ExplainerProps } from "./props.js";

type Scene = ExplainerProps["scenes"][number];

/**
 * A slow camera move across the whole scene so no shot sits still: push in, with a
 * gentle pan whose direction alternates by scene.
 */
function Drift({ scene, children }: { scene: Scene; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const total = Math.max(1, scene.durationS * FPS);
  const t = interpolate(frame, [0, total], [0, 1], { extrapolateRight: "clamp" });
  const ease = t * t * (3 - 2 * t);
  const dir = Number(scene.id.replace(/\D/g, "") || 0) % 2 ? 1 : -1;
  const transform = `scale(${1.04 + 0.08 * ease}) translate(${dir * (1.5 - 3 * ease)}%, ${0.8 - 1.6 * ease}%)`;
  return <AbsoluteFill style={{ transform, willChange: "transform" }}>{children}</AbsoluteFill>;
}

/** Frame within a clip of `n` frames, played forward then backward, so a short clip never freezes. */
export function pingPong(frame: number, n: number): number {
  if (n <= 1) return 0;
  const cycle = 2 * (n - 1);
  const t = frame % cycle;
  return t < n ? t : cycle - t;
}

/** The generated visual: a clip (looped forward and back) or a still, under a slow camera move. */
export function Visual({ scene }: { scene: Scene }) {
  const frame = useCurrentFrame();
  const clip = scene.visuals.find((v) => v.role === "clip");
  const still = scene.visuals.find((v) => v.role === "still" || v.role === "background");

  if (clip) {
    // Clips are 5–8 s and narration runs 20–40 s: after the first pass, bounce instead of freezing.
    const video = <OffthreadVideo src={clip.asset.url} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />;
    const n = clip.asset.durationMs ? Math.floor((clip.asset.durationMs / 1000) * FPS) - 1 : null;
    return <Drift scene={scene}>{n !== null && frame >= n ? <Freeze frame={pingPong(frame, n)}>{video}</Freeze> : video}</Drift>;
  }
  if (still) {
    return (
      <Drift scene={scene}>
        <Img src={still.asset.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </Drift>
    );
  }
  return null;
}

/** Programmatic layer driven by the anim spec and word timestamps. */
export function Programmatic({ scene, background }: { scene: Scene; background: "dark" | "light" }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pal = PALETTE[background];
  const spec = scene.animSpec;

  if (spec.kind === "labelled-diagram") {
    return (
      <AbsoluteFill style={{ padding: 96, fontFamily: "Inter, system-ui, sans-serif" }}>
        {spec.labels.map((l, i) => {
          const at = cueFrame(scene.words, l.cueWord);
          const s = spring({ frame: frame - at, fps, config: { damping: 200 } });
          if (frame < at) return null;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: 96,
                top: 140 + i * 84,
                padding: "10px 22px",
                borderRadius: 12,
                background: PALETTE.accents[i % PALETTE.accents.length],
                color: "#1B2235",
                fontSize: 34,
                fontWeight: 500,
                opacity: s,
                transform: `translateX(${(1 - s) * -24}px)`,
              }}
            >
              {l.text}
            </div>
          );
        })}
      </AbsoluteFill>
    );
  }

  if (spec.kind === "kinetic-text") {
    return (
      <AbsoluteFill style={{ justifyContent: "center", padding: "0 160px", fontFamily: "Inter, system-ui, sans-serif" }}>
        {spec.lines.map((l, i) => {
          const at = cueFrame(scene.words, l.cueWord);
          const s = spring({ frame: frame - at, fps, config: { damping: 200 } });
          if (frame < at) return null;
          return (
            <div key={i} style={{ fontSize: 72, fontWeight: 600, color: pal.ink, lineHeight: 1.15, marginBottom: 24, opacity: s, transform: `translateY(${(1 - s) * 20}px)` }}>
              {l.text}
            </div>
          );
        })}
      </AbsoluteFill>
    );
  }

  if (spec.kind === "chart") {
    const max = Math.max(...spec.series.map((x) => x.value), 1);
    const grow = spring({ frame, fps, config: { damping: 200 }, durationInFrames: 45 });
    return (
      <AbsoluteFill style={{ padding: "160px 200px", display: "flex", flexDirection: "row", alignItems: "flex-end", gap: 48, fontFamily: "Inter, system-ui, sans-serif" }}>
        {spec.series.map((x, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
            <div style={{ color: pal.ink, fontSize: 40, fontWeight: 600 }}>{x.value}</div>
            <div style={{ width: "100%", height: (x.value / max) * 520 * grow, background: PALETTE.accents[i % PALETTE.accents.length], borderRadius: 12 }} />
            <div style={{ color: pal.muted, fontSize: 30 }}>{x.label}</div>
          </div>
        ))}
      </AbsoluteFill>
    );
  }

  return null;
}
