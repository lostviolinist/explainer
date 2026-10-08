/**
 * Renderer implementations for the pipeline's `Renderer` interface.
 *
 *  LocalRenderer  — bundles once, renders with @remotion/renderer on the worker.
 *  LambdaRenderer — Remotion Lambda; serve URL and function name from env.
 *
 * Both write MP4 + SRT through the provided `upload` callback and return URLs.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExplainerProps } from "./props.js";
import { COMPOSITION_ID, FPS, SCENE_TAIL_S, totalFrames } from "./props.js";

export type Upload = (key: string, bytes: Uint8Array, contentType: string) => Promise<string>;

export interface RenderOut {
  videoUrl: string;
  srtUrl: string;
  durationS: number;
}

function srtTime(s: number) {
  const ms = Math.round(s * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000), sec = Math.floor((ms % 60000) / 1000), r = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(r).padStart(3, "0")}`;
}

/** Sentence-level SRT from word timestamps, offset by each scene's start. */
export function buildSrt(props: ExplainerProps): string {
  const cues: { start: number; end: number; text: string }[] = [];
  let offset = 0;
  for (const s of props.scenes) {
    const tokens = s.narration.split(/\s+/).filter(Boolean);
    let cur: number[] = [];
    tokens.forEach((tok, i) => {
      cur.push(i);
      if (/[.!?]["')]?$/.test(tok) || i === tokens.length - 1) {
        const ws = cur.map((j) => s.words[j]).filter(Boolean) as typeof s.words;
        if (ws.length) cues.push({ start: offset + ws[0]!.start, end: offset + ws.at(-1)!.end, text: cur.map((j) => tokens[j]).join(" ") });
        cur = [];
      }
    });
    offset += s.durationS + SCENE_TAIL_S;
  }
  return cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join("\n");
}

export class LocalRenderer {
  private serveUrl: Promise<string> | null = null;
  constructor(private upload: Upload) {}

  private async bundle(): Promise<string> {
    if (!this.serveUrl) {
      this.serveUrl = (async () => {
        const { bundle } = await import("@remotion/bundler");
        const here = dirname(fileURLToPath(import.meta.url));
        return bundle({ entryPoint: resolve(here, "Root.tsx"), webpackOverride: (c) => c });
      })();
    }
    return this.serveUrl;
  }

  async render(props: ExplainerProps): Promise<RenderOut> {
    const { renderMedia, selectComposition } = await import("@remotion/renderer");
    const serveUrl = await this.bundle();
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props });
    const dir = await mkdtemp(join(tmpdir(), "explainer-"));
    const out = join(dir, `${props.projectId}.mp4`);
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: out,
      inputProps: props,
      crf: 18,
      audioBitrate: "192k",
      concurrency: null,
    });
    const srt = buildSrt(props);
    const srtPath = join(dir, `${props.projectId}.srt`);
    await writeFile(srtPath, srt);
    const [videoUrl, srtUrl] = await Promise.all([
      this.upload(`renders/${props.projectId}/video.mp4`, new Uint8Array(await readFile(out)), "video/mp4"),
      this.upload(`renders/${props.projectId}/captions.srt`, new TextEncoder().encode(srt), "application/x-subrip"),
    ]);
    return { videoUrl, srtUrl, durationS: totalFrames(props) / FPS };
  }
}

export class LambdaRenderer {
  constructor(
    private upload: Upload,
    private cfg: { functionName: string; serveUrl: string; region: string },
  ) {}

  async render(props: ExplainerProps): Promise<RenderOut> {
    const lambda = await import("@remotion/lambda/client");
    const { renderId, bucketName } = await lambda.renderMediaOnLambda({
      region: this.cfg.region as any,
      functionName: this.cfg.functionName,
      serveUrl: this.cfg.serveUrl,
      composition: COMPOSITION_ID,
      inputProps: props,
      codec: "h264",
      crf: 18,
      privacy: "public",
      outName: `renders/${props.projectId}/video.mp4`,
    });
    for (;;) {
      const p = await lambda.getRenderProgress({ renderId, bucketName, functionName: this.cfg.functionName, region: this.cfg.region as any });
      if (p.fatalErrorEncountered) throw new Error(p.errors.map((e) => e.message).join("; "));
      if (p.done && p.outputFile) {
        const srtUrl = await this.upload(`renders/${props.projectId}/captions.srt`, new TextEncoder().encode(buildSrt(props)), "application/x-subrip");
        return { videoUrl: p.outputFile, srtUrl, durationS: totalFrames(props) / FPS };
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}
