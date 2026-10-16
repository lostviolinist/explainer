"use client";

import { Player, Thumbnail } from "@remotion/player";
import { Explainer } from "@explainer/render/explainer";
import { FPS, HEIGHT, WIDTH, sceneFrames, totalFrames, type ExplainerProps } from "@explainer/render/props";

/**
 * The rough cut is the real composition, played in the browser: the finished
 * scenes with their narration, captions, motion templates and transitions,
 * exactly as the final render will draw them (minus the music, which is
 * mixed in at the end).
 */
export function RoughCutPlayer({ props }: { props: ExplainerProps }) {
  return (
    <Player
      component={Explainer}
      inputProps={props}
      durationInFrames={totalFrames(props)}
      fps={FPS}
      compositionWidth={WIDTH}
      compositionHeight={HEIGHT}
      controls
      style={{ width: "100%" }}
      acknowledgeRemotionLicense
    />
  );
}

/** One frame of a scene (past its first beats), for the storyboard. */
export function SceneThumb({ props, sceneId }: { props: ExplainerProps; sceneId: string }) {
  let from = 0;
  let scene: ExplainerProps["scenes"][number] | undefined;
  for (const s of props.scenes) {
    if (s.id === sceneId) {
      scene = s;
      break;
    }
    from += sceneFrames(s.durationS);
  }
  if (!scene) return null;
  const frame = from + Math.round(scene.durationS * 0.7 * FPS);
  return <Thumbnail component={Explainer} inputProps={props} frameToDisplay={frame} durationInFrames={totalFrames(props)} fps={FPS} compositionWidth={WIDTH} compositionHeight={HEIGHT} style={{ width: "100%" }} />;
}
