import { AbsoluteFill, Audio, Sequence, interpolate, useCurrentFrame } from "remotion";
import { ExplainerProps, FPS, PALETTE, END_CARD_S, sceneFrames } from "./props.js";
import { Captions } from "./Captions.js";
import { Programmatic, Visual } from "./SceneLayers.js";

function Fade({ children, durationInFrames }: { children: React.ReactNode; durationInFrames: number }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12, durationInFrames - 12, durationInFrames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

function EndCard({ sources, learningGoal, background }: Pick<ExplainerProps, "sources" | "learningGoal" | "background">) {
  const pal = PALETTE[background];
  return (
    <AbsoluteFill style={{ background: pal.bg, padding: 120, fontFamily: "Inter, system-ui, sans-serif", color: pal.ink }}>
      <div style={{ fontSize: 34, color: pal.muted, marginBottom: 16 }}>You can now</div>
      <div style={{ fontSize: 52, fontWeight: 600, lineHeight: 1.2, maxWidth: 1400 }}>{learningGoal.replace(/^After watching,\s*the viewer can\s*/i, "")}</div>
      <div style={{ marginTop: 72, fontSize: 30, color: pal.muted }}>Sources</div>
      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 48px", fontSize: 28 }}>
        {sources.slice(0, 10).map((s, i) => (
          <div key={i} style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ color: PALETTE.accents[i % 4] }}>●</span> {s.title} <span style={{ color: pal.muted }}>· {s.domain}</span>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
}

export function Explainer(props: ExplainerProps) {
  const pal = PALETTE[props.background];
  let cursor = 0;
  return (
    <AbsoluteFill style={{ background: pal.bg }}>
      {props.scenes.map((s) => {
        const frames = sceneFrames(s.durationS);
        const from = cursor;
        cursor += frames;
        return (
          <Sequence key={s.id} from={from} durationInFrames={frames} name={s.id}>
            <Fade durationInFrames={frames}>
              <Visual scene={s} />
              <Programmatic scene={s} background={props.background} />
              <Captions words={s.words} narration={s.narration} background={props.background} />
            </Fade>
            <Audio src={s.audioUrl} />
          </Sequence>
        );
      })}
      <Sequence from={cursor} durationInFrames={END_CARD_S * FPS} name="end-card">
        <Fade durationInFrames={END_CARD_S * FPS}>
          <EndCard sources={props.sources} learningGoal={props.learningGoal} background={props.background} />
        </Fade>
      </Sequence>
    </AbsoluteFill>
  );
}
