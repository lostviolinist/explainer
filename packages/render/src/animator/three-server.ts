/**
 * three.js sandbox: renders an AI-written React Three Fiber scene to MP4 with Remotion.
 *
 *   GET  /health                              -> {"ok": true, "engine": "three"}
 *   POST /render {code, duration_s, background} -> 200 video/mp4
 *                                               422 {"error"} when the code fails (fed back to the model)
 *                                               504 {"error"} on timeout
 *
 * The code is a module `export default function Scene()` returning R3F elements,
 * animated from Remotion's frame clock. It is bundled into a throwaway Remotion
 * project and rendered in headless Chrome with software WebGL. Run in a container
 * with no secrets and no internet; imports are limited to react, three,
 * @react-three/fiber and remotion.
 */
import http from "node:http";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { webpackOverride } from "../webpack-override.js";
import { ensureRenderBrowser } from "../renderer.js";

const PORT = Number(process.env.PORT ?? 8002);
const TIMEOUT_MS = Number(process.env.RENDER_TIMEOUT_S ?? 300) * 1000;
const FPS = 30;
const [W, H] = [1920, 1080];
const MAX_BODY = 256 * 1024;
// Jobs live inside packages/render so the bundle resolves react/three/remotion from its node_modules.
const JOBS = resolve(dirname(fileURLToPath(import.meta.url)), "../../.three-jobs");

const ALLOWED_IMPORTS = new Set(["react", "three", "@react-three/fiber", "remotion"]);
const FORBIDDEN = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|eval|Function)\s*\(|\bnew\s+(Worker|Function)\b|\brequire\s*\(|\bimport\s*\(/;

/** Static checks before anything runs: module shape and imports. */
export function checkCode(code: string): string | null {
  if (!/export\s+default\s+function\s+Scene\s*\(/.test(code)) return "The code must be a module with `export default function Scene()`.";
  for (const m of code.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/gm)) {
    if (!ALLOWED_IMPORTS.has(m[1]!)) return `Import "${m[1]}" is not available. Only react, three, @react-three/fiber and remotion can be imported.`;
  }
  const bad = code.match(FORBIDDEN);
  if (bad) return `"${bad[0].trim()}" is not allowed: the scene must not load anything or run dynamic code.`;
  return null;
}

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

let busy = 0;
const MAX_PARALLEL = Number(process.env.MAX_PARALLEL ?? 1);
const queue: (() => void)[] = [];
const slot = () => (busy < MAX_PARALLEL ? (busy++, Promise.resolve()) : new Promise<void>((r) => queue.push(() => (busy++, r()))));
const release = () => (busy--, queue.shift()?.());

export async function renderThree(code: string, durationS: number, background = "#000000"): Promise<{ status: number; video?: Buffer; error?: string }> {
  const problem = checkCode(code);
  if (problem) return { status: 422, error: problem };
  const dir = join(JOBS, randomUUID());
  await mkdir(dir, { recursive: true });
  const { makeCancelSignal, renderMedia, selectComposition } = await import("@remotion/renderer");
  const { cancelSignal, cancel } = makeCancelSignal();
  const timer = setTimeout(cancel, TIMEOUT_MS);
  try {
    await writeFile(join(dir, "Scene.tsx"), code);
    await writeFile(join(dir, "Root.tsx"), root(Math.max(1, Math.round(durationS * FPS)), background));
    const { bundle } = await import("@remotion/bundler");
    let serveUrl: string;
    try {
      serveUrl = await bundle({ entryPoint: join(dir, "Root.tsx"), webpackOverride, outDir: join(dir, "bundle") });
    } catch (e) {
      return { status: 422, error: `The code did not compile: ${errorText(e)}` };
    }
    const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
    const chromiumOptions = { gl: "swangle" as const };
    const out = join(dir, "out.mp4");
    try {
      const composition = await selectComposition({ serveUrl, id: "ThreeScene", inputProps: {}, browserExecutable, chromiumOptions });
      await renderMedia({ composition, serveUrl, codec: "h264", outputLocation: out, browserExecutable, chromiumOptions, cancelSignal, concurrency: 2, logLevel: "error" });
    } catch (e) {
      if (/cancel/i.test(errorText(e))) return { status: 504, error: `Rendering took longer than ${TIMEOUT_MS / 1000}s; simplify the scene (fewer meshes, cheaper materials).` };
      return { status: 422, error: `The scene failed while rendering: ${errorText(e)}` };
    }
    return { status: 200, video: await readFile(out) };
  } finally {
    clearTimeout(timer);
    await rm(dir, { recursive: true, force: true });
  }
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(data) }).end(data);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  http
    .createServer(async (req, res) => {
      if (req.method === "GET" && req.url === "/health") {
        try {
          await ensureRenderBrowser();
          return json(res, 200, { ok: true, engine: "three" });
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
      let code: string, duration: number, background: string;
      try {
        const body = JSON.parse(raw);
        code = String(body.code);
        duration = Number(body.duration_s);
        background = /^#[0-9a-fA-F]{6}$/.test(body.background ?? "") ? body.background : "#000000";
      } catch {
        return json(res, 400, { error: "expected {code, duration_s, background?}" });
      }
      if (!(duration >= 1 && duration <= 90)) return json(res, 400, { error: "duration_s must be 1–90" });
      await slot();
      try {
        const r = await renderThree(code, duration, background);
        if (r.status !== 200) return json(res, r.status, { error: r.error });
        res.writeHead(200, { "content-type": "video/mp4", "content-length": r.video!.length }).end(r.video);
      } catch (e) {
        json(res, 500, { error: errorText(e) });
      } finally {
        release();
      }
    })
    .listen(PORT, () => console.log(`[three] listening on :${PORT}`));
}
