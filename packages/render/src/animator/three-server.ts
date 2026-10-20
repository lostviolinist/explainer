/**
 * Remotion sandbox: renders AI-written scene code to MP4. Two engines:
 *
 *   three   React Three Fiber (three.js) 3D scenes, rendered with software WebGL
 *           (the 3Blue1Brown style).
 *   motion  2D motion graphics (React + SVG, @remotion/shapes, @remotion/paths) in the
 *           flat house style, built around the scene's picture (`image`), which the code
 *           places with <Picture> from the kit. Only used when the operator opts in
 *           (ANIMATION_AUTHOR=model); otherwise Illustrated scenes are templates in
 *           ../motion and need no sandbox.
 *
 *   GET  /health                                               -> {"ok": true, "engines": [...]}
 *   POST /render {engine, code, duration_s, background, image?} -> 200 video/mp4
 *                                                                422 {"error"} when the code fails (fed back to the model)
 *                                                                504 {"error"} on timeout
 *
 * The code is a module `export default function Scene()`, animated from Remotion's
 * frame clock, bundled into a throwaway Remotion project and rendered in headless
 * Chrome. Run in a container with no secrets and no internet.
 */
import http from "node:http";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { webpackOverride } from "../webpack-override.js";
import { ensureRenderBrowser } from "../renderer.js";

const PORT = Number(process.env.PORT ?? 8002);
const TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_S ?? 300) * 1000;
const FPS = 30;
const [W, H] = [1920, 1080];
const MAX_BODY = 16 * 1024 * 1024; // room for the scene's picture
// Jobs live inside packages/render so the bundle resolves react/three/remotion from its node_modules.
const JOBS = resolve(dirname(fileURLToPath(import.meta.url)), "../../.three-jobs");

export type Engine = "three" | "motion";
const ALLOWED_IMPORTS: Record<Engine, Set<string>> = {
  three: new Set(["react", "three", "@react-three/fiber", "remotion"]),
  motion: new Set(["react", "remotion", "@remotion/shapes", "@remotion/paths", "./Kit"]),
};
// The flat motion toolkit (see kit/Kit.tsx), copied into every motion job.
const KIT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "kit");
const KIT_FILES = ["Kit.tsx"];

/** Clutter guard: a scene that needs more than this many drawn things won't read at a glance. */
export const MAX_ELEMENTS = 14;
const KIT_ELEMENTS = /<(Shape|Icon|Label|Row|Column|Bar|Counter|Connect|Dots|Transform|Circumscribe|Highlight|Flash)\b/g;
const FORBIDDEN = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|eval|Function)\s*\(|\bnew\s+(Worker|Function)\b|\brequire\s*\(|\bimport\s*\(/;

/** Static checks before anything runs: module shape, imports, and for motion scenes the kit's rules. */
export function checkCode(code: string, engine: Engine = "three", hasPicture = false): string | null {
  if (!/export\s+default\s+function\s+Scene\s*\(/.test(code)) return "The code must be a module with `export default function Scene()`.";
  const allowed = ALLOWED_IMPORTS[engine];
  for (const m of code.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/gm)) {
    if (!allowed.has(m[1]!)) return `Import "${m[1]}" is not available. Only ${[...allowed].join(", ")} can be imported.`;
  }
  const bad = code.match(FORBIDDEN);
  if (bad) return `"${bad[0].trim()}" is not allowed: the scene must not load anything or run dynamic code.`;
  if (engine === "motion") {
    if (!/<Stage[\s>/]/.test(code)) return 'The scene must be wrapped in <Stage> from "./Kit" (the camera lives there).';
    if (hasPicture && !/<Picture[\s>/]/.test(code)) return 'Place the scene\'s picture with <Picture> from "./Kit": it is the illustration the scene is built around.';
    if (/<(text|foreignObject)\b/.test(code)) return "No SVG <text> or <foreignObject>: all text goes through <Label>, <Row> or <Column> from ./Kit, which size themselves so words never spill out of their boxes.";
    const drawn = (code.match(KIT_ELEMENTS) ?? []).length;
    if (drawn > MAX_ELEMENTS) return `Too much on screen: ${drawn} drawn elements. Keep to ${MAX_ELEMENTS} or fewer so the scene reads at a glance: the picture, one idea, a few supporting details, labels only for what the narration names. A <Row> of words counts as one; many small things of a kind should be one <Dots> or a .map().`;
  }
  return null;
}

const motionRoot = (durationInFrames: number, background: string, image: string | null) => `import { AbsoluteFill, Composition, registerRoot, staticFile } from "remotion";
import { StillProvider } from "./Kit";
import Scene from "./Scene";

// The scene places its picture with <Picture> from the kit; this is where the picture comes from.
function Frame() {
  return (
    <AbsoluteFill style={{ backgroundColor: ${JSON.stringify(background)}, overflow: "hidden", fontFamily: "Inter, system-ui, sans-serif" }}>
      <StillProvider href={${image ? `staticFile(${JSON.stringify(image)})` : "null"}}>
        <Scene />
      </StillProvider>
    </AbsoluteFill>
  );
}

registerRoot(() => <Composition id="ThreeScene" component={Frame} durationInFrames={${durationInFrames}} fps={${FPS}} width={${W}} height={${H}} />);
`;

const root = (durationInFrames: number, background: string) => `import { Composition, registerRoot } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import Scene from "./Scene";

function Frame() {
  return (
    <ThreeCanvas linear width={${W}} height={${H}} camera={{ position: [0, 0, 8], fov: 45 }}>
      <color attach="background" args={[${JSON.stringify(background)}]} />
      <Scene />
    </ThreeCanvas>
  );
}

registerRoot(() => <Composition id="ThreeScene" component={Frame} durationInFrames={${durationInFrames}} fps={${FPS}} width={${W}} height={${H}} />);
`;

/** First useful line(s) of a bundling or browser error, without Remotion's stack noise. */
function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split("\n").filter((l) => l.trim() && !/^\s+at /.test(l)).slice(0, 12).join("\n").slice(0, 3000);
}

/**
 * Render slots: MAX_PARALLEL renders at a time, each in its own stable
 * directory. Remotion keys its webpack cache on the bundle config (entry and
 * output paths included), so a stable directory means the second bundle in a
 * slot recompiles only the scene, not react/remotion/three: seconds instead of
 * tens of seconds per attempt.
 */
const MAX_PARALLEL = Number(process.env.MAX_PARALLEL ?? 1);
const freeSlots = Array.from({ length: MAX_PARALLEL }, (_, i) => join(JOBS, `slot-${i}`));
const queue: ((dir: string) => void)[] = [];
const slot = (): Promise<string> => (freeSlots.length ? Promise.resolve(freeSlots.pop()!) : new Promise((r) => queue.push(r)));
const release = (dir: string) => {
  const next = queue.shift();
  if (next) next(dir);
  else freeSlots.push(dir);
};

export async function renderThree(
  code: string,
  durationS: number,
  background = "#000000",
  engine: Engine = "three",
  image?: { data: Buffer; type: string },
  /** A stable slot directory keeps the webpack cache warm; a fresh one is used when not given. */
  slotDir?: string,
): Promise<{ status: number; video?: Buffer; error?: string }> {
  const problem = checkCode(code, engine, Boolean(image));
  if (problem) return { status: 422, error: problem };
  const dir = slotDir ?? join(JOBS, randomUUID());
  // Start from a clean slot: everything but the bundle output goes (the cache lives in node_modules/.cache).
  await rm(join(dir, "public"), { recursive: true, force: true });
  await rm(join(dir, "out.mp4"), { force: true });
  await mkdir(join(dir, "public"), { recursive: true });
  const { makeCancelSignal, renderMedia, selectComposition } = await import("@remotion/renderer");
  const { cancelSignal, cancel } = makeCancelSignal();
  const timer = setTimeout(cancel, TIMEOUT_MS);
  try {
    await writeFile(join(dir, "Scene.tsx"), code);
    if (engine === "motion") for (const f of KIT_FILES) await copyFile(join(KIT_DIR, f), join(dir, f));
    const frames = Math.max(1, Math.round(durationS * FPS));
    let imageName: string | null = null;
    if (engine === "motion" && image) {
      imageName = `picture.${image.type.includes("png") ? "png" : image.type.includes("webp") ? "webp" : "jpg"}`;
      await writeFile(join(dir, "public", imageName), image.data);
    }
    await writeFile(join(dir, "Root.tsx"), engine === "motion" ? motionRoot(frames, background, imageName) : root(frames, background));
    const { bundle } = await import("@remotion/bundler");
    let serveUrl: string;
    const t0 = Date.now();
    try {
      serveUrl = await bundle({ entryPoint: join(dir, "Root.tsx"), webpackOverride, outDir: join(dir, "bundle"), publicDir: join(dir, "public") });
    } catch (e) {
      return { status: 422, error: `The code did not compile: ${errorText(e)}` };
    }
    const t1 = Date.now();
    const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
    const chromiumOptions = engine === "three" ? { gl: "swangle" as const } : {};
    const out = join(dir, "out.mp4");
    try {
      const composition = await selectComposition({ serveUrl, id: "ThreeScene", inputProps: {}, browserExecutable, chromiumOptions });
      // The same pixel format and range as the final video (broadcast-range yuv420p): a full-range clip plays in the
      // final render, which decodes it with ffmpeg, but Safari's <video> shows it as a still in the rough cut.
      await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: out, browserExecutable, chromiumOptions, cancelSignal, concurrency: 2, logLevel: "error", pixelFormat: "yuv420p", colorSpace: "bt709", x264Preset: "veryfast", crf: 20 });
    } catch (e) {
      if (/cancel/i.test(errorText(e))) return { status: 504, error: `Rendering took longer than ${TIMEOUT_MS / 1000}s; simplify the scene (fewer things on screen, cheaper effects).` };
      return { status: 422, error: `The scene failed while rendering: ${errorText(e)}` };
    }
    console.log(`[three] ${engine} ${durationS}s: bundled in ${((t1 - t0) / 1000).toFixed(1)}s, rendered in ${((Date.now() - t1) / 1000).toFixed(1)}s`);
    return { status: 200, video: await readFile(out) };
  } finally {
    clearTimeout(timer);
    if (slotDir) await rm(join(dir, "public"), { recursive: true, force: true });
    else await rm(dir, { recursive: true, force: true });
  }
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) }).end(data);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Old job dirs and webpack caches from previous runs: start clean (the slots warm up again on first use).
  await rm(JOBS, { recursive: true, force: true });
  await rm(resolve(dirname(fileURLToPath(import.meta.url)), "../../node_modules/.cache/webpack"), { recursive: true, force: true });
  http
    .createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        try {
          await ensureRenderBrowser();
          return json(res, 200, { ok: true, engines: ["three", "motion"] });
        } catch (e) {
          return json(res, 503, { ok: false, engine: "three", error: errorText(e) });
        }
      }
      if (req.method !== "POST" || req.url !== "/render") return json(res, 404, { error: "not found" });
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > MAX_BODY) return json(res, 413, { error: "body too large" });
      }
      let code: string, duration: number, background: string, engine: Engine, image: { data: Buffer; type: string } | undefined;
      try {
        const body = JSON.parse(raw);
        if (body.engine && body.engine !== "three" && body.engine !== "motion") return json(res, 400, { error: `unknown engine ${String(body.engine)}; this sandbox renders three.js and motion scenes` });
        code = String(body.code);
        duration = Number(body.duration_s);
        background = /^#[0-9a-fA-F]{6}$/.test(body.background ?? "") ? body.background : "#000000";
        engine = body.engine === "motion" ? "motion" : "three";
        const m = typeof body.image === "string" ? /^data:(image\/[a-z+]+);base64,(.+)$/.exec(body.image) : null;
        image = m ? { type: m[1]!, data: Buffer.from(m[2]!, "base64") } : undefined;
      } catch {
        return json(res, 400, { error: "expected {engine?, code, duration_s, background?, image?}" });
      }
      if (!(duration >= 1 && duration <= 90)) return json(res, 400, { error: "duration_s must be 1–90" });
      const dir = await slot();
      try {
        const r = await renderThree(code, duration, background, engine, image, dir);
        if (r.status !== 200) {
          console.warn(`[three] ${engine} ${r.status}: ${(r.error ?? "").split("\n")[0]!.slice(0, 240)}`);
          return json(res, r.status, { error: r.error });
        }
        res.writeHead(200, { "content-type": "video/mp4", "content-length": r.video!.length }).end(r.video);
      } catch (e) {
        json(res, 500, { error: errorText(e) });
      } finally {
        release(dir);
      }
    })
    .listen(PORT, () => console.log(`[three] listening on :${PORT}`));
}
