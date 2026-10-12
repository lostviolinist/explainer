/**
 * Remotion sandbox: renders AI-written scene code to MP4. Two engines:
 *
 *   three   React Three Fiber (three.js) 3D scenes, rendered with software WebGL.
 *   motion  2D motion graphics (React + SVG, @remotion/shapes, @remotion/paths) in the
 *           flat house style; optionally drawn over a still (`image`), which zooms
 *           slowly together with the overlay so callouts stay on target.
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
const MAX_BODY = 16 * 1024 * 1024; // room for a still in overlay mode
// Jobs live inside packages/render so the bundle resolves react/three/remotion from its node_modules.
const JOBS = resolve(dirname(fileURLToPath(import.meta.url)), "../../.three-jobs");

export type Engine = "three" | "motion";
const ALLOWED_IMPORTS: Record<Engine, Set<string>> = {
  three: new Set(["react", "three", "@react-three/fiber", "remotion"]),
  motion: new Set(["react", "remotion", "@remotion/shapes", "@remotion/paths", "./Label"]),
};

/**
 * Text helper for motion scenes: an HTML label that sizes itself to its text, so
 * a pill can never be narrower than the words in it (SVG <text> has no auto-size,
 * and models guess pill widths). Anchored at (x, y) in frame pixels.
 */
const LABEL_TSX = `import React from "react";

type Props = {
  x: number;
  y: number;
  children: React.ReactNode;
  /** Pill colour; "none" for plain text. */
  color?: string;
  ink?: string;
  size?: number;
  /** Which point of the label sits at (x, y): its left-middle, centre or right-middle. */
  anchor?: "start" | "middle" | "end";
  opacity?: number;
  scale?: number;
  weight?: number;
};

export function Label({ x, y, children, color = "#F2C14E", ink = "#1B2235", size = 44, anchor = "start", opacity = 1, scale = 1, weight = 700 }: Props) {
  const tx = anchor === "middle" ? "-50%" : anchor === "end" ? "-100%" : "0%";
  const origin = anchor === "middle" ? "center" : anchor === "end" ? "right center" : "left center";
  const pill = color !== "none";
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        transform: \`translate(\${tx}, -50%) scale(\${scale})\`,
        transformOrigin: origin,
        opacity,
        padding: pill ? \`\${Math.round(size * 0.22)}px \${Math.round(size * 0.55)}px\` : 0,
        borderRadius: 999,
        background: pill ? color : "transparent",
        color: ink,
        fontSize: size,
        fontWeight: weight,
        lineHeight: 1.15,
        whiteSpace: "nowrap",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {children}
    </div>
  );
}
`;
const FORBIDDEN = /\b(fetch|XMLHttpRequest|WebSocket|EventSource|importScripts|eval|Function)\s*\(|\bnew\s+(Worker|Function)\b|\brequire\s*\(|\bimport\s*\(/;

/** Static checks before anything runs: module shape and imports. */
export function checkCode(code: string, engine: Engine = "three"): string | null {
  if (!/export\s+default\s+function\s+Scene\s*\(/.test(code)) return "The code must be a module with `export default function Scene()`.";
  const allowed = ALLOWED_IMPORTS[engine];
  for (const m of code.matchAll(/^\s*import\s+(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/gm)) {
    if (!allowed.has(m[1]!)) return `Import "${m[1]}" is not available. Only ${[...allowed].join(", ")} can be imported.`;
  }
  const bad = code.match(FORBIDDEN);
  if (bad) return `"${bad[0].trim()}" is not allowed: the scene must not load anything or run dynamic code.`;
  return null;
}

const motionRoot = (durationInFrames: number, background: string, image: string | null) => `import { AbsoluteFill, Composition, Img, interpolate, registerRoot, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import Scene from "./Scene";

function Frame() {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  // The still and the overlay zoom together, so callouts stay on the parts they point at.
  const zoom = ${image ? "interpolate(frame, [0, durationInFrames], [1, 1.06])" : "1"};
  return (
    <AbsoluteFill style={{ backgroundColor: ${JSON.stringify(background)}, overflow: "hidden" }}>
      <AbsoluteFill style={{ transform: \`scale(\${zoom})\` }}>
        ${image ? `<Img src={staticFile(${JSON.stringify(image)})} style={{ width: "100%", height: "100%", objectFit: "cover" }} />` : ""}
        <AbsoluteFill style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
          <Scene />
        </AbsoluteFill>
      </AbsoluteFill>
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

let busy = 0;
const MAX_PARALLEL = Number(process.env.MAX_PARALLEL ?? 1);
const queue: (() => void)[] = [];
const slot = () => (busy < MAX_PARALLEL ? (busy++, Promise.resolve()) : new Promise<void>((r) => queue.push(() => (busy++, r()))));
const release = () => (busy--, queue.shift()?.());

export async function renderThree(
  code: string,
  durationS: number,
  background = "#000000",
  engine: Engine = "three",
  image?: { data: Buffer; type: string },
): Promise<{ status: number; video?: Buffer; error?: string }> {
  const problem = checkCode(code, engine);
  if (problem) return { status: 422, error: problem };
  const dir = join(JOBS, randomUUID());
  await mkdir(join(dir, "public"), { recursive: true });
  const { makeCancelSignal, renderMedia, selectComposition } = await import("@remotion/renderer");
  const { cancelSignal, cancel } = makeCancelSignal();
  const timer = setTimeout(cancel, TIMEOUT_MS);
  try {
    await writeFile(join(dir, "Scene.tsx"), code);
    if (engine === "motion") await writeFile(join(dir, "Label.tsx"), LABEL_TSX);
    const frames = Math.max(1, Math.round(durationS * FPS));
    let imageName: string | null = null;
    if (engine === "motion" && image) {
      imageName = `still.${image.type.includes("png") ? "png" : image.type.includes("webp") ? "webp" : "jpg"}`;
      await writeFile(join(dir, "public", imageName), image.data);
    }
    await writeFile(join(dir, "Root.tsx"), engine === "motion" ? motionRoot(frames, background, imageName) : root(frames, background));
    const { bundle } = await import("@remotion/bundler");
    let serveUrl: string;
    try {
      serveUrl = await bundle({ entryPoint: join(dir, "Root.tsx"), webpackOverride, outDir: join(dir, "bundle"), publicDir: join(dir, "public") });
    } catch (e) {
      return { status: 422, error: `The code did not compile: ${errorText(e)}` };
    }
    const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE || null;
    const chromiumOptions = engine === "three" ? { gl: "swangle" as const } : {};
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
      await slot();
      try {
        const r = await renderThree(code, duration, background, engine, image);
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
