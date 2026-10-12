import { AbsoluteFill, Audio, Sequence, interpolate, useCurrentFrame } from "remotion";
import { ExplainerProps, FPS, PALETTE, END_CARD_S, MUSIC, SFX_VOLUME, SWIPE_FRAMES, accentsFor, musicStart, musicVolume, sceneFrames, speechWindows, totalFrames } from "./props.js";
import { Captions } from "./Captions.js";
import { Programmatic, Visual } from "./SceneLayers.js";

function Fade({ children, durationInFrames, inFrames = 12, outFrames = 12 }: { children: React.ReactNode; durationInFrames: number; inFrames?: number; outFrames?: number }) {
  const frame = useCurrentFrame();
  const clamp = { extrapolateLeft: "clamp" as const, extrapolateRight: "clamp" as const };
  const fadeIn = inFrames > 0 ? interpolate(frame, [0, inFrames], [0, 1], clamp) : 1;
  const fadeOut = outFrames > 0 ? interpolate(frame, [durationInFrames - outFrames, durationInFrames], [1, 0], clamp) : 1;
  return <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>{children}</AbsoluteFill>;
}

const snap = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/**
 * Swipe transition (illustrated style): a flat panel slides in from the right
 * over the last frames of a scene and out to the left over the first frames of
 * the next, so the cut reads as one movement. `inColor` is the panel that
 * uncovers this scene (null for the first), `outColor` the one that covers it.
 */
function Swipe({ children, durationInFrames, inColor, outColor }: { children: React.ReactNode; durationInFrames: number; inColor: string | null; outColor: string | null }) {
  const frame = useCurrentFrame();
  const uncover = inColor ? snap(interpolate(frame, [0, SWIPE_FRAMES], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })) : 1;
  const cover = outColor ? snap(interpolate(frame, [durationInFrames - SWIPE_FRAMES, durationInFrames], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })) : 0;
  return (
    <AbsoluteFill>
      {inColor ? children : <Fade durationInFrames={durationInFrames} outFrames={0}>{children}</Fade>}
      {inColor && uncover < 1 && <AbsoluteFill style={{ background: inColor, transform: `translateX(${-uncover * 102}%)` }} />}
      {outColor && cover > 0 && <AbsoluteFill style={{ background: outColor, transform: `translateX(${(1 - cover) * 102}%)` }} />}
    </AbsoluteFill>
  );
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

/** One short sound at a frame of the composition. */
function Sfx({ src, from, volume = SFX_VOLUME }: { src?: string; from: number; volume?: number }) {
  if (!src || from < 0) return null;
  return (
    <Sequence from={from} name="sfx">
      <Audio src={src} volume={volume} />
    </Sequence>
  );
}

/**
 * The music bed, end-aligned: it starts partway in so its composed ending
 * (a resolved chord ringing out) lands on the end card. Ducked under speech.
 */
function MusicBed({ props }: { props: ExplainerProps }) {
  if (!props.music) return null;
  const total = totalFrames(props);
  const { startFrom, loop } = musicStart(props.music.durationS, total);
  const windows = speechWindows(props);
  return <Audio src={props.music.url} startFrom={startFrom} loop={loop} volume={(f) => musicVolume(f, windows, total, loop)} name="music" />;
}

export function Explainer(props: ExplainerProps) {
  const pal = PALETTE[props.background];
  const accents = accentsFor(props.background);
  const swipe = props.background !== "math"; // the 3Blue1Brown style keeps its cuts
  const n = props.scenes.length;
  let cursor = 0;
  const sfx = props.sfx ?? {};
  return (
    <AbsoluteFill style={{ background: pal.bg }}>
      {props.scenes.map((s, i) => {
        const frames = sceneFrames(s.durationS);
        const from = cursor;
        cursor += frames;
        const inner = (
          <>
            <Visual scene={s} />
            {/* Animated scenes draw their own labels and callouts. */}
            {!s.visuals.some((v) => v.role === "animation") && <Programmatic scene={s} background={props.background} sfx={sfx} />}
            <Captions words={s.words} narration={s.narration} background={props.background} />
          </>
        );
        return (
          <Sequence key={s.id} from={from} durationInFrames={frames} name={s.id}>
            {swipe ? (
              <Swipe durationInFrames={frames} inColor={i === 0 ? null : accents[(i - 1) % accents.length]!} outColor={accents[i % accents.length]!}>
                {inner}
              </Swipe>
            ) : (
              <Fade durationInFrames={frames}>{inner}</Fade>
            )}
            <Audio src={s.audioUrl} />
            {(s.sounds ?? []).map((c, k) => (
              <Sfx key={k} src={sfx[c.kind]} from={Math.round(c.at * FPS)} />
            ))}
            {swipe && <Sfx src={sfx.swoosh} from={frames - SWIPE_FRAMES - 4} volume={0.25} />}
          </Sequence>
        );
      })}
      <Sequence from={cursor} durationInFrames={END_CARD_S * FPS} name="end-card">
        {swipe ? (
          <Swipe durationInFrames={END_CARD_S * FPS} inColor={accents[(n - 1) % accents.length]!} outColor={null}>
            <Fade durationInFrames={END_CARD_S * FPS} inFrames={0}>
              <EndCard sources={props.sources} learningGoal={props.learningGoal} background={props.background} />
            </Fade>
          </Swipe>
        ) : (
          <Fade durationInFrames={END_CARD_S * FPS}>
            <EndCard sources={props.sources} learningGoal={props.learningGoal} background={props.background} />
          </Fade>
        )}
        <Sfx src={sfx.chime} from={SWIPE_FRAMES} volume={0.3} />
      </Sequence>
      <MusicBed props={props} />
    </AbsoluteFill>
  );
}
