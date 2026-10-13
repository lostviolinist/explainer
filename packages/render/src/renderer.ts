/**
 * Renderer implementations for the pipeline's `Renderer` interface.
 *
 *  LocalRenderer  — bundles once, renders with @remotion/renderer on the worker.
 *  LambdaRenderer — Remotion Lambda; serve URL and function name from env.
 *
 * Both write MP4 + SRT through the provided `upload` callback and return URLs.
 */
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { cpus, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
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

/** Make sure local rendering has a browser: REMOTION_BROWSER_EXECUTABLE, or Remotion's headless shell (downloaded if missing). */
export async function ensureRenderBrowser(): Promise<string> {
  const exe = process.env.REMOTION_BROWSER_EXECUTABLE;
  if (exe) {
    await access(exe);
    return exe;
  }
  // In a child process: a failed download surfaces as an uncaught error inside Remotion
  // that would crash this server. Same cwd, so it lands in the cache renders read from.
  // Path from this file, not require.resolve: bundlers rewrite that into a module id.
  const renderer = resolve(dirname(fileURLToPath(import.meta.url)), "../node_modules/@remotion/renderer");
  const script = `require(${JSON.stringify(renderer)}).ensureBrowser({ logLevel: "error" }).then((s) => { console.log(s.path ?? s.type); process.exit(0); })`;
  return new Promise((ok, fail) =>
    execFile(process.execPath, ["-e", script], { cwd: process.cwd(), timeout: 10 * 60_000 }, (err, stdout, stderr) => {
      if (err) fail(new Error(`could not download Remotion's headless Chrome: ${(stderr.match(/Error: .*/)?.[0] ?? err.message).slice(0, 200)}`));
      else ok(stdout.trim());
    }),
  );
}

/**
 * Speed settings for the local render. Frames are painted in parallel Chrome tabs
 * (one per core by default; Remotion's own default is half the cores) and encoded
 * with a fast x264 preset: for flat graphics the difference from "medium" is
 * invisible, the time saved is not. Override with RENDER_CONCURRENCY,
 * RENDER_X264_PRESET and RENDER_CRF.
 */
export const RENDER_SPEED = {
  concurrency: Number(process.env.RENDER_CONCURRENCY) || cpus().length,
  x264Preset: (process.env.RENDER_X264_PRESET || "veryfast") as "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow",
  crf: Number(process.env.RENDER_CRF) || 20,
  // Output size as a fraction of 1920×1080: frame capture is the bottleneck and scales with pixels (0.6667 = 720p, about twice as fast).
  scale: Math.min(1, Math.max(0.25, Number(process.env.RENDER_SCALE) || 1)),
};

export class LocalRenderer {
  private serveUrl: Promise<string> | null = null;
  constructor(private upload: Upload) {}

  private async bundle(): Promise<string> {
    if (!this.serveUrl) {
      this.serveUrl = (async () => {
        const { bundle } = await import("@remotion/bundler");
        const { webpackOverride } = await import("./webpack-override.js");
        const here = dirname(fileURLToPath(import.meta.url));
        return bundle({ entryPoint: resolve(here, "Root.tsx"), webpackOverride });
      })();
    }
    return this.serveUrl;
  }

  async render(props: ExplainerProps): Promise<RenderOut> {
    const { renderMedia, selectComposition } = await import("@remotion/renderer");
    const serveUrl = await this.bundle();
    // Optional: a preinstalled Chrome/Chromium instead of Remotion's downloaded headless shell.
    const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props, browserExecutable });
    const dir = await mkdtemp(join(tmpdir(), "explainer-"));
    const out = join(dir, `${props.projectId}.mp4`);
    await renderMedia({
      composition,
      serveUrl,
      codec: "h264",
      outputLocation: out,
      inputProps: props,
      ...RENDER_SPEED,
      audioBitrate: "192k",
      browserExecutable,
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
