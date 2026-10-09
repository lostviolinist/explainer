/**
 * Pulls still frames out of a clip for vision QA, using the ffmpeg/ffprobe
 * binaries Remotion already ships (a minimal build: seek + scale + mjpeg).
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Ff = (bin: "ffmpeg" | "ffprobe", args: string[]) => Promise<string>;

const remotionFf: Ff = async (bin, args) => {
  const { RenderInternals } = await import("@remotion/renderer");
  const r = await RenderInternals.callFf({ bin, args, indent: false, logLevel: "error", binariesDirectory: null, cancelSignal: undefined });
  return r.stdout;
};

/** Evenly spaced timestamps, inset from both ends so a seek always lands on a frame. */
export function sampleTimes(durationS: number, count: number): number[] {
  const inset = Math.min(0.5, durationS / 10);
  const span = durationS - 2 * inset;
  if (count === 1) return [inset + span / 2];
  return Array.from({ length: count }, (_, i) => inset + (span * i) / (count - 1));
}

export class FfmpegFrameSampler {
  constructor(private ff: Ff = remotionFf, private f: typeof fetch = fetch) {}

  async sample(videoUrl: string, count: number): Promise<string[]> {
    const res = await this.f(videoUrl);
    if (!res.ok) throw new Error(`could not fetch clip for frame sampling: ${res.status} ${videoUrl}`);
    const dir = await mkdtemp(join(tmpdir(), "frames-"));
    try {
      const clip = join(dir, "clip");
      await writeFile(clip, Buffer.from(await res.arrayBuffer()));
      const probed = await this.ff("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clip]);
      const durationS = Number(probed.trim());
      if (!(durationS > 0)) throw new Error(`could not read clip duration (${probed.trim() || "empty"}): ${videoUrl}`);
      const frames: string[] = [];
      for (const [i, t] of sampleTimes(durationS, count).entries()) {
        const out = join(dir, `f${i}.jpg`);
        await this.ff("ffmpeg", ["-v", "error", "-ss", t.toFixed(3), "-i", clip, "-frames:v", "1", "-vf", "scale=768:-2", "-q:v", "4", "-y", out]);
        frames.push(`data:image/jpeg;base64,${(await readFile(out)).toString("base64")}`);
      }
      return frames;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
