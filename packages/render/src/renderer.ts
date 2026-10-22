/**
 * Renderer implementations for the pipeline's `Renderer` interface.
 *
 *  LocalRenderer  — bundles once, renders with @remotion/renderer on the worker.
 *  LambdaRenderer — Remotion Lambda; serve URL and function name from env.
 *
 * Both write MP4 + SRT through the provided `upload` callback and return URLs.
 */
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { cpus, totalmem, tmpdir } from "node:os";
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

/** Memory this process may use: the cgroup limit when Docker set one, else the machine's (in Docker Desktop, the VM's). */
export function memoryBudgetBytes(): number {
  let limit = totalmem();
  for (const f of ["/sys/fs/cgroup/memory.max", "/sys/fs/cgroup/memory/memory.limit_in_bytes"]) {
    try {
      const n = Number(readFileSync(f, "utf8").trim()); // "max" reads as NaN: no limit set
      if (Number.isFinite(n) && n > 0) limit = Math.min(limit, n);
    } catch {}
  }
  return limit;
}

/** What the rest of the stack needs while a render runs: the app, the encoder, Postgres, the worker, the sandboxes idling. */
const OTHERS_BYTES = 2.5 * 1024 ** 3;

/** What one tab painting frames needs, by output scale: about 700 MB at 1080p, 450 MB at 720p. */
export function perTabBytes(scale: number): number {
  return (250 + 450 * scale * scale) * 1024 ** 2;
}

/**
 * How many Chrome tabs paint frames at once: half the cores (beyond that, tabs add little speed and
 * much memory), and never more than fit in memory. More tabs than fit end with the kernel killing
 * the process part-way: the render dies at a random frame and the container restarts.
 */
export function defaultConcurrency(cores: number, memBytes: number, scale: number): number {
  const byCores = Math.max(1, Math.floor(cores / 2));
  const byMemory = Math.floor((memBytes - OTHERS_BYTES) / perTabBytes(scale));
  return Math.max(1, Math.min(byCores, byMemory));
}

/**
 * Remotion multiplies the composition's size by the scale and hands the product to the encoder,
 * which needs whole, even pixels: 0.6667 of 1920 is 1280.064 and the render stops at once with
 * "width must be an integer, passed to stitchFramesToVideo()". This is the nearest scale whose
 * width and height both come out whole and even, in the same floating-point arithmetic.
 */
export function snapScale(width: number, height: number, scale: number): number {
  let best = 1;
  for (let w = 2; w <= width; w += 2) {
    const s = w / width;
    const h = height * s;
    if (!Number.isInteger(width * s) || !Number.isInteger(h) || h % 2 !== 0) continue;
    if (Math.abs(s - scale) < Math.abs(best - scale)) best = s;
  }
  return best;
}

/** Not even one tab fits beside the rest of the stack: the render may be killed for lack of memory. */
export function memoryIsTight(memBytes: number, scale: number): boolean {
  return memBytes < OTHERS_BYTES + perTabBytes(scale);
}

/**
 * Speed settings for the local render. Frames are painted in parallel Chrome tabs, as many as
 * the cores and the memory allow (see defaultConcurrency), and encoded with a fast x264 preset:
 * for flat graphics the difference from "medium" is invisible, the time saved is not. Override
 * with RENDER_CONCURRENCY, RENDER_X264_PRESET and RENDER_CRF.
 */
const scale = Math.min(1, Math.max(0.25, Number(process.env.RENDER_SCALE) || 1)); // of 1920×1080: frame capture scales with pixels (0.6667 = 720p, about twice as fast)
export const RENDER_SPEED = {
  concurrency: Number(process.env.RENDER_CONCURRENCY) || defaultConcurrency(cpus().length, memoryBudgetBytes(), scale),
  x264Preset: (process.env.RENDER_X264_PRESET || "veryfast") as "ultrafast" | "superfast" | "veryfast" | "faster" | "fast" | "medium" | "slow",
  crf: Number(process.env.RENDER_CRF) || 20,
  scale,
};

/** How far a render has got, for logs and the progress page. */
export type RenderProgress = { frames: number; total: number; fps: number; fraction: number; elapsedS: number };
export type RenderOptions = { onProgress?: (p: RenderProgress) => void };

/** The render ran past RENDER_TIMEOUT_S (default 90 minutes): it is stopped rather than left running for hours. */
export class RenderTimeout extends Error {
  override name = "RenderTimeout";
}
export const RENDER_TIMEOUT_S = Math.max(300, Number(process.env.RENDER_TIMEOUT_S) || 5400);

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

  async render(props: ExplainerProps, opts: RenderOptions = {}): Promise<RenderOut> {
    const { renderMedia, selectComposition, makeCancelSignal } = await import("@remotion/renderer");
    const t0 = Date.now();
    const serveUrl = await this.bundle();
    // Optional: a preinstalled Chrome/Chromium instead of Remotion's downloaded headless shell.
    const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
    const composition = await selectComposition({ serveUrl, id: COMPOSITION_ID, inputProps: props, browserExecutable });
    const total = composition.durationInFrames;
    const memGb = memoryBudgetBytes() / 1024 ** 3;
    const scale = snapScale(composition.width, composition.height, RENDER_SPEED.scale);
    console.log(`[render] ${props.projectId}: ${total} frames at ${composition.width * scale}×${composition.height * scale}, ${RENDER_SPEED.concurrency} tabs (${cpus().length} cores, ${memGb.toFixed(1)} GB); bundled in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    if (memoryIsTight(memoryBudgetBytes(), scale)) console.warn(`[render] ${memGb.toFixed(1)} GB is not enough to be sure of finishing: give Docker Desktop at least 4 GB (Settings → Resources), or set RENDER_SCALE=0.6667`);
    const dir = await mkdtemp(join(tmpdir(), "explainer-"));
    const out = join(dir, `${props.projectId}.mp4`);

    // Progress, so a slow render is visible (every 10% in the log, every call to the page), and a
    // ceiling, so a stuck one is stopped with a reason instead of running all night.
    const started = Date.now();
    let last: RenderProgress = { frames: 0, total, fps: 0, fraction: 0, elapsedS: 0 };
    let logged = 0;
    const { cancelSignal, cancel } = makeCancelSignal();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      cancel();
    }, RENDER_TIMEOUT_S * 1000);
    try {
      await renderMedia({
        composition,
        serveUrl,
        codec: "h264",
        outputLocation: out,
        inputProps: props,
        ...RENDER_SPEED,
        scale,
        audioBitrate: "192k",
        browserExecutable,
        cancelSignal,
        onProgress: ({ renderedFrames, progress }) => {
          const elapsedS = (Date.now() - started) / 1000;
          last = { frames: renderedFrames, total, fps: elapsedS > 0 ? renderedFrames / elapsedS : 0, fraction: progress, elapsedS };
          if (progress * 10 >= logged + 1 || renderedFrames === total) {
            logged = Math.floor(progress * 10);
            const left = last.fps > 0 ? (total - renderedFrames) / last.fps / 60 : 0;
            console.log(`[render] ${props.projectId}: ${renderedFrames}/${total} frames, ${last.fps.toFixed(1)} fps, about ${Math.ceil(left)} min left`);
          }
          opts.onProgress?.(last);
        },
      });
    } catch (e) {
      if (timedOut) throw new RenderTimeout(`the render ran for more than ${Math.round(RENDER_TIMEOUT_S / 60)} min (${last.frames} of ${total} frames at ${last.fps.toFixed(1)} fps). The machine is too slow for this video at this size: give Docker more CPUs and memory, or set RENDER_SCALE=0.6667 for 720p`);
      throw e;
    } finally {
      clearTimeout(timer);
    }
    console.log(`[render] ${props.projectId}: done in ${((Date.now() - started) / 60000).toFixed(1)} min (${last.fps.toFixed(1)} fps)`);
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

  async render(props: ExplainerProps, opts: RenderOptions = {}): Promise<RenderOut> {
    const lambda = await import("@remotion/lambda/client");
    const started = Date.now();
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
      opts.onProgress?.({ frames: p.framesRendered, total: totalFrames(props), fps: 0, fraction: p.overallProgress, elapsedS: (Date.now() - started) / 1000 });
      if (p.done && p.outputFile) {
        const srtUrl = await this.upload(`renders/${props.projectId}/captions.srt`, new TextEncoder().encode(buildSrt(props)), "application/x-subrip");
        return { videoUrl: p.outputFile, srtUrl, durationS: totalFrames(props) / FPS };
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}
