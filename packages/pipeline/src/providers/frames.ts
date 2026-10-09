/**
 * Frame sampling for vision QA on video. Vision models take images, not
 * video, so clips are scored on a few frames pulled from start to end.
 * Implemented with ffmpeg in @explainer/render; injected by the app.
 */
export interface FrameSampler {
  /** `count` frames spread from start to end, as image data URLs. */
  sample(videoUrl: string, count: number): Promise<string[]>;
}
