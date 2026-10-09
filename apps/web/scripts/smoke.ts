/**
 * End-to-end smoke run of the real pipeline with fake OpenAI / Exa / Hedra.
 *
 * Real: the Inngest function body, every stage, the Postgres store, the S3
 * mirror, ffmpeg frame sampling and the Remotion render. Fake: the three paid
 * APIs. The fake Hedra validates every submit against the models' published
 * input schemas (unknown fields, required fields, enums), so a request the
 * real API would reject fails here too.
 *
 * Needs Postgres (DATABASE_URL) and an S3 bucket (S3_*, ASSETS_PUBLIC_BASE),
 * e.g. the docker compose stack. Run from apps/web:  pnpm smoke
 */
import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";
import type { z } from "zod";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { AssetMirror, HedraError, type JobResult } from "@explainer/hedra";
import { makeFunctions, loadHouseStyle, FallbackAligner, type Ctx, type LLM, type Search } from "@explainer/pipeline";
import { LocalRenderer, FfmpegFrameSampler, remotionFf } from "@explainer/render";
import { db, schema } from "../src/lib/db";
import { drizzleStore } from "../src/lib/store";

// SMOKE_DELAY_MS slows every fake call, to watch the progress page; SMOKE_KEEP=1 keeps the project afterwards.
const DELAY = Number(process.env.SMOKE_DELAY_MS ?? 0);
const pause = () => (DELAY ? new Promise((r) => setTimeout(r, DELAY * (0.5 + Math.random()))) : Promise.resolve());
const env = (k: string, d?: string) => process.env[k] || d || (() => { throw new Error(`${k} is not set`); })();
const ffmpeg = () => remotionFf;

// ---------------------------------------------------------------- media ---

function png(w: number, h: number, rgb: number[]): Buffer {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const td = Buffer.concat([Buffer.from(t), d]); const o = Buffer.alloc(td.length + 8); o.writeUInt32BE(d.length, 0); td.copy(o, 4); o.writeUInt32BE(crc(td), td.length + 4); return o; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => rgb).flat())]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

function wav(seconds: number): Buffer {
  const rate = 22050, n = Math.round(seconds * rate), data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 3000), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

const STILL_RGB = [230, 140, 40];
const CLIP_START_RGB = [200, 30, 30];
const CLIP_END_RGB = [30, 180, 60];

async function makeClip(dir: string, ms: number, frames?: Buffer[]): Promise<Buffer> {
  const n = Math.round((ms / 1000) * 24);
  const [a, b] = frames?.length ? [frames[0]!, frames.at(-1)!] : [png(640, 360, CLIP_START_RGB), png(640, 360, CLIP_END_RGB)];
  const src = join(dir, `clip-${ms}.pngs`), out = join(dir, `clip-${ms}.mp4`);
  writeFileSync(src, Buffer.concat(Array.from({ length: n }, (_, i) => (i < n / 2 ? a : b))));
  await ffmpeg()("ffmpeg", ["-v", "error", "-f", "image2pipe", "-c:v", "png", "-r", "24", "-i", src, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", out]);
  return readFileSync(out);
}

// ----------------------------------------------------- fake Hedra (schemas) ---

type Rule = { allowed: string[]; required: string[]; enums?: Record<string, unknown[]>; max?: Record<string, number>; range?: Record<string, [number, number]> };
const LANG = ["auto", "en"];
const range = (a: number, b: number, s: number) => Array.from({ length: (b - a) / s + 1 }, (_, i) => a + i * s);
// From GET /v3/models/{model} (input_schema), 2026-10-09.
const RULES: Record<string, Rule> = {
  "gpt-image-2": { allowed: ["prompt", "num_outputs", "enhance_prompt", "aspect_ratio", "resolution", "images", "output_format", "quality"], required: ["aspect_ratio", "prompt", "resolution"], enums: { aspect_ratio: ["16:9", "9:16", "4:3", "3:4", "1:1"], resolution: ["1K", "2K", "4K"], output_format: ["jpeg", "png", "webp"] }, max: { prompt: 32000, images: 16 } },
  "recraft-v3": { allowed: ["prompt", "num_outputs", "enhance_prompt", "aspect_ratio", "resolution"], required: ["aspect_ratio", "prompt", "resolution"], enums: { aspect_ratio: ["1:1", "16:9", "9:16", "4:3", "3:4"], resolution: ["540p", "720p", "1080p"] }, max: { prompt: 1000 } },
  "kling-25-turbo": { allowed: ["num_outputs", "prompt", "aspect_ratio", "resolution", "duration_ms", "start_image", "negative_prompt", "cfg_scale"], required: ["aspect_ratio", "duration_ms", "prompt"], enums: { aspect_ratio: ["16:9", "9:16", "1:1"], resolution: ["1080p"], duration_ms: [5000, 10000] }, max: { prompt: 2500 } },
  "wan-3-0": { allowed: ["num_outputs", "prompt", "aspect_ratio", "resolution", "duration_ms", "generate_audio", "seed", "start_image", "end_image", "images", "videos", "audios", "quality"], required: ["aspect_ratio", "duration_ms", "prompt", "resolution"], enums: { aspect_ratio: ["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16"], resolution: ["480p", "720p", "1080p"], duration_ms: range(2000, 30000, 1000) }, max: { prompt: 5000, images: 10 } },
  "minimax-h3": { allowed: ["num_outputs", "prompt", "resolution", "duration_ms", "start_image", "end_image", "aspect_ratio", "images", "videos", "audios"], required: ["duration_ms", "prompt", "resolution"], enums: { resolution: ["480p", "768p", "2K", "4K"], duration_ms: range(5000, 15000, 1000) }, max: { prompt: 7000, images: 5 } },
  "elevenlabs-multilingual-v2": { allowed: ["text", "stability", "speed", "language", "voice_id"], required: ["text", "voice_id"], enums: { language: LANG }, max: { text: 10000 }, range: { speed: [0.7, 1.2], stability: [0, 1] } },
  "elevenlabs-v3": { allowed: ["text", "stability", "speed", "language", "voice_id"], required: ["text", "voice_id"], enums: { language: LANG }, max: { text: 5000 }, range: { speed: [0.7, 1.2], stability: [0, 1] } },
};

function violations(model: string, input: Record<string, unknown>): string[] {
  const r = RULES[model];
  if (!r) return [`unknown model ${model}`];
  const v: string[] = [];
  for (const k of Object.keys(input)) if (!r.allowed.includes(k)) v.push(`unknown field ${k}`);
  for (const k of r.required) if (input[k] === undefined) v.push(`missing required ${k}`);
  for (const [k, vals] of Object.entries(r.enums ?? {})) if (input[k] !== undefined && !vals.includes(input[k])) v.push(`${k}=${JSON.stringify(input[k])} not in ${JSON.stringify(vals)}`);
  for (const [k, m] of Object.entries(r.max ?? {})) { const x = input[k] as any; if (x !== undefined && x.length > m) v.push(`${k} longer than ${m}`); }
  for (const [k, [a, b]] of Object.entries(r.range ?? {})) { const x = input[k] as number; if (x !== undefined && (x < a || x > b)) v.push(`${k}=${x} outside ${a}–${b}`); }
  const ref = (x: any) => x && ((x.source === "asset" && /^asset_/.test(x.asset_id)) || (x.source === "url" && /^https?:/.test(x.url)));
  for (const k of ["start_image", "end_image"]) if (input[k] !== undefined && !ref(input[k])) v.push(`${k} is not a media ref`);
  if (input.images !== undefined && !(Array.isArray(input.images) && input.images.length >= 1 && input.images.every(ref))) v.push("images must be 1+ media refs");
  if (model === "wan-3-0" && input.images && input.start_image) v.push("images and start_image are exclusive");
  if (model === "minimax-h3" && input.images && !input.aspect_ratio) v.push("aspect_ratio required with images");
  return v;
}

// ------------------------------------------------------------- fake LLM ---

const NARRATION: Record<string, string> = {
  hook: "Why is the sky blue and not violet? The answer is hiding in the air itself.",
  ground: "Sunlight looks white, but it mixes every colour of the rainbow. Each colour is light of a different wavelength.",
  misconception: "Many people think the sky reflects the ocean. It does not. The sky is blue over deserts too, far from any sea, and it stays blue above the clouds on every flight you take.",
  "build-up": "Air is full of tiny nitrogen and oxygen molecules, far smaller than a wavelength of light.",
  core: "Those molecules scatter short blue wavelengths much more strongly than long red ones. Scattered blue light reaches your eye from every direction.",
  payoff: "Blue light scatters about five times more than red light. That is Rayleigh scattering.",
  recap: "After watching, you can explain why the daytime sky looks blue.",
};
const TYPES: Record<string, string> = { hook: "still-animated", ground: "diagram", misconception: "clip", "build-up": "presenter", core: "reference-seq", payoff: "chart", recap: "text" };
const BEATS = Object.keys(NARRATION);

function fakeLLM(log: string[]): LLM {
  let visionCalls = 0;
  const answer = (system: string, user: string): unknown => {
    if (/turn a learner's question/.test(system)) return { topic: "why the sky is blue", learningGoal: "After watching, the viewer can explain why the daytime sky looks blue.", level: "basics", ageMode: null, tone: "neutral", background: "light", statement: "A 3-minute neutral explainer on sky colour." };
    if (/web search queries/.test(system)) return { queries: ["why is the sky blue", "rayleigh scattering wavelength", "sky blue misconception ocean"] };
    if (/Extract the claims from this page/.test(system)) {
      const k = Object.keys(TITLES).findIndex((u) => user.includes(u));
      return { claims: [0, 1, 2].map((j) => FACTS[(Math.max(0, k) * 2 + j) % FACTS.length]!).map((text, j) => ({ text, type: j === 2 ? "number" : "fact", fit: j === 0 ? "needed" : "nice", quote: text.slice(0, 200) })) };
    }
    if (/Merge overlapping claims/.test(system)) return {
      claims: [
        { id: "c1", text: "Sunlight contains all visible wavelengths.", type: "fact", fit: "needed", evidence: [0, 3], contested: false },
        { id: "c2", text: "Air molecules scatter shorter wavelengths more strongly (Rayleigh scattering).", type: "process", fit: "needed", evidence: [1, 4], contested: false },
        { id: "c3", text: "Blue light scatters about five times more than red.", type: "number", fit: "nice", evidence: [2, 99], contested: false },
      ],
      misconceptions: [
        { belief: "The sky is blue because it reflects the colour of the ocean.", correctsWith: ["c2"] },
        { belief: "Sunsets are red because the Sun cools down in the evening.", correctsWith: ["c1"] },
      ],
      analogies: [{ text: "Like small pebbles deflecting ripples", explains: ["c2"], breaksDown: "light is not a water wave" }],
    };
    if (/exactly seven beats/.test(system)) return { beats: BEATS.map((b) => ({ beat: b, purpose: `the ${b}`, claimIds: ["c1", "c2"], targetS: 17 })) };
    if (/Write the scenes for this arc/.test(system)) return { scenes: BEATS.map((b) => ({ beat: b, purpose: `the ${b}`, narration: NARRATION[b], claimIds: ["c1", "c2"], visualDirection: `a sunbeam as a bundle of coloured threads for the ${b}, with air molecules as tiny beads and an eye looking up`, visualType: TYPES[b], targetS: b === "misconception" ? 60 : 12, onScreenTerms: b === "ground" ? ["wavelength"] : [] })) };
    if (/You will hear the narration/.test(system)) return { goalAnswer: "Air scatters blue light most.", unclearSentences: [], couldMeetGoal: true };
    if (/careful subject expert/.test(system)) return { unsourced: [], overstated: [] };
    if (/You write generation prompts/.test(system)) {
      const type = /\(([a-z-]+), ([a-z-]+)\)/.exec(user)?.[2];
      const animSpec =
        type === "diagram" ? { kind: "labelled-diagram", labels: [{ text: "wavelength", cueWord: "wavelength" }, { text: "sunlight", cueWord: "Sunlight" }] }
        : type === "chart" ? { kind: "chart", chartType: "bar", series: [{ label: "blue", value: 5 }, { label: "red", value: 1 }], claimId: "c3" }
        : type === "text" ? { kind: "kinetic-text", lines: [{ text: "Short waves scatter most", cueWord: "explain" }] }
        : { kind: "none" };
      return { hedraPrompt: type === "chart" || type === "text" ? null : "Flat vector illustration, detailed. A sunbeam splitting into coloured threads. No text, no labels.", animSpec };
    }
    if (/Final transcript check/.test(system)) return { driftedSentences: [] };
    if (/You are the intended learner/.test(system)) return { goalAnswer: "Blue scatters most.", couldMeetGoal: true, confusingScenes: [] };
    throw new Error(`fake LLM has no answer for: ${system.slice(0, 80)}`);
  };
  return {
    async json<T>(a: { system: string; user: string; schema: z.ZodType<T> }) {
      log.push(`llm.json ${a.system.slice(0, 40)}`);
      await pause();
      return a.schema.parse(answer(a.system, a.user));
    },
    async vision<T>(a: { imageUrls: string[]; schema: z.ZodType<T> }) {
      const n = ++visionCalls;
      await pause();
      for (const u of a.imageUrls) {
        const r = await fetch(u);
        if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("image/")) throw new Error(`vision got a non-image: ${u.slice(0, 80)}`);
      }
      log.push(`llm.vision ${a.imageUrls.length} image(s)`);
      // The 3rd check fails once, to exercise the retry path.
      const ok = n !== 3;
      return a.schema.parse({ matchesDirection: ok ? 0.9 : 0.3, styleMatch: 0.9, hasText: false, notes: ok ? "ok" : "wrong metaphor" });
    },
  };
}

const TITLES: Record<string, string> = {
  "https://en.wikipedia.org/wiki/Rayleigh_scattering": "Rayleigh scattering",
  "https://spaceplace.nasa.gov/blue-sky/": "Why Is the Sky Blue? | NASA Space Place",
  "https://www.britannica.com/story/why-is-the-sky-blue": "Why Is the Sky Blue? | Britannica",
  "https://math.ucr.edu/home/baez/physics/General/BlueSky/blue_sky.html": "Why is the sky blue? — UC Riverside",
  "https://www.metoffice.gov.uk/weather/learn-about/weather/optical-effects/why-is-the-sky-blue": "Why is the sky blue? — Met Office",
  "https://www.scientificamerican.com/article/why-is-the-sky-blue/": "Why Is the Sky Blue? | Scientific American",
};

const FACTS = [
  "Sunlight looks white but contains every visible wavelength, from violet to red.",
  "Nitrogen and oxygen molecules are far smaller than the wavelength of visible light.",
  "Blue light is scattered about five times more strongly than red light by air molecules.",
  "The sky isn't violet partly because our eyes are much less sensitive to violet light.",
  "At sunset, sunlight crosses up to 40 times more air, so most of the blue is scattered away before it reaches you.",
  "On the Moon there is almost no atmosphere, so the daytime sky looks black.",
  "Lord Rayleigh worked out the maths of this scattering in 1871.",
  "Mars has a butterscotch daytime sky and blue sunsets, because its dust scatters light differently.",
];

const fakeSearch: Search = {
  async search(q) {
    return Object.keys(TITLES).filter((_, i) => i % 3 === q.length % 3 || i < 2).map((url) => ({ url, title: TITLES[url]!, snippet: q }));
  },
  async open(url) {
    return { url, title: TITLES[url] ?? url, text: "Sunlight contains all visible wavelengths. Air molecules scatter shorter wavelengths more strongly. ".repeat(20) };
  },
};

// ------------------------------------------------------------------ run ---

async function main() {
  const dir = mkdtempSync(join(tmpdir(), "smoke-"));
  const media = new Map<string, { bytes: Buffer; type: string }>();
  const server = http.createServer((req, res) => {
    const m = media.get(req.url ?? "");
    if (!m) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": m.type, "content-length": m.bytes.length }).end(m.bytes);
  }).listen(0);
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  media.set("/still.png", { bytes: png(1920, 1080, STILL_RGB), type: "image/png" });
  const jpg = join(dir, "still.jpg");
  writeFileSync(join(dir, "still.png"), media.get("/still.png")!.bytes);
  await ffmpeg()("ffmpeg", ["-v", "error", "-i", join(dir, "still.png"), "-y", jpg]);
  media.set("/still.jpg", { bytes: readFileSync(jpg), type: "image/jpeg" });
  // SMOKE_STILLS=a.png,b.png: use real images as the fake stills (nicer when watching the progress page).
  const stills = (process.env.SMOKE_STILLS ?? "").split(",").filter(Boolean);
  stills.forEach((f, i) => media.set(`/still-${i}.png`, { bytes: readFileSync(f), type: "image/png" }));

  const log: string[] = [];
  const bad: string[] = [];
  let jobs = 0;
  let moderated = false;
  const hedra = {
    async run(model: string, input: Record<string, unknown>): Promise<JobResult> {
      await pause();
      if (!model.startsWith("elevenlabs")) await pause();
      const v = violations(model, input);
      if (v.length) {
        bad.push(`${model}: ${v.join("; ")}`);
        throw new HedraError(`Invalid input: ${v.join("; ")}`, "INVALID_ARGUMENT", 400, false);
      }
      // First still is refused by moderation once, to exercise model fallback.
      if (model === "gpt-image-2" && !moderated) {
        moderated = true;
        throw new HedraError("moderation", "MODERATION_FAILED", 200, false);
      }
      const id = `asset_00000000-0000-4000-8000-${String(++jobs).padStart(12, "0")}`;
      log.push(`hedra ${model}`);
      let out: { path: string; type: string; w: number | null; h: number | null; ms: number | null };
      if (model.startsWith("elevenlabs")) {
        const s = String(input.text).split(/\s+/).length / 2.75;
        media.set(`/${id}.wav`, { bytes: wav(s), type: "audio/wav" });
        out = { path: `/${id}.wav`, type: "audio/wav", w: null, h: null, ms: Math.round(s * 1000) };
      } else if (RULES[model]!.required.includes("duration_ms")) {
        const ms = input.duration_ms as number;
        if (!media.has(`/clip-${ms}.mp4`)) media.set(`/clip-${ms}.mp4`, { bytes: await makeClip(dir, ms, stills.map((f) => readFileSync(f))), type: "video/mp4" });
        out = { path: `/clip-${ms}.mp4`, type: "video/mp4", w: 640, h: 360, ms };
      } else {
        const j = input.output_format === "jpeg";
        out = stills.length
          ? { path: `/still-${jobs % stills.length}.png`, type: "image/png", w: 1280, h: 720, ms: null }
          : { path: j ? "/still.jpg" : "/still.png", type: j ? "image/jpeg" : "image/png", w: 1920, h: 1080, ms: null };
      }
      return {
        job_id: `job_${jobs}`, model, status: "COMPLETED", error: null, cost: 0.01, currency: "USD",
        outputs: [{ status: "COMPLETED", asset_id: id, voice_id: null, url: `${base}${out.path}`, content_type: out.type, width: out.w, height: out.h, duration_ms: out.ms, fps: out.ms && out.w ? 24 : null, error: null }],
      };
    },
  };

  const s3cfg = { region: env("S3_REGION", "us-east-1"), endpoint: env("S3_ENDPOINT"), bucket: env("S3_BUCKET"), accessKeyId: env("S3_ACCESS_KEY_ID", "local"), secretAccessKey: env("S3_SECRET_ACCESS_KEY", "local"), publicBase: env("ASSETS_PUBLIC_BASE") };
  const s3 = new S3Client({ region: s3cfg.region, endpoint: s3cfg.endpoint, forcePathStyle: true, credentials: { accessKeyId: s3cfg.accessKeyId, secretAccessKey: s3cfg.secretAccessKey } });
  const upload = async (key: string, bytes: Uint8Array, contentType: string) => {
    await s3.send(new PutObjectCommand({ Bucket: s3cfg.bucket, Key: key, Body: bytes, ContentType: contentType }));
    return `${s3cfg.publicBase.replace(/\/$/, "")}/${key}`;
  };

  const ctx: Ctx = {
    llm: fakeLLM(log),
    search: fakeSearch,
    hedra: hedra as any,
    mirror: new AssetMirror(s3cfg),
    aligner: new FallbackAligner(null),
    frames: new FfmpegFrameSampler(),
    store: drizzleStore,
    style: loadHouseStyle(),
    now: () => new Date().toISOString(),
  };

  const question = "why is the sky blue?";
  const [project] = await db.insert(schema.projects).values({ question, shareSlug: `smoke-${Date.now()}` }).returning({ id: schema.projects.id });
  const projectId = project!.id;
  console.log(`project ${projectId}`);

  // Drive the real Inngest handler; step results round-trip through JSON as they do in Inngest.
  const [fn] = makeFunctions(() => ctx, () => new LocalRenderer(upload));
  const step = {
    run: async (id: string, f: () => Promise<unknown>) => {
      const t = Date.now();
      const r = await f();
      console.log(`  step ${id} ${((Date.now() - t) / 1000).toFixed(1)}s`);
      return r === undefined ? undefined : JSON.parse(JSON.stringify(r));
    },
    sendEvent: async () => undefined,
  };
  const t0 = Date.now();
  const result = (await (fn as any).fn({ event: { name: "project/created", data: { projectId, question } }, step })) as { videoUrl: string; durationS: number; qa: { check: string; passed: boolean; notes: string | null }[] };
  console.log(`pipeline finished in ${((Date.now() - t0) / 1000).toFixed(0)}s → ${result.videoUrl} (${result.durationS.toFixed(1)}s)`);

  // ---- checks
  const fail: string[] = [...bad.map((b) => `Hedra schema violation: ${b}`)];
  const [p] = await db.select().from(schema.projects).where(eq(schema.projects.id, projectId));
  if (p?.stage !== "done") fail.push(`project stage is ${p?.stage}, expected done`);

  const video = join(dir, "out.mp4");
  const res = await fetch(result.videoUrl);
  if (!res.ok) fail.push(`video not downloadable: ${res.status}`);
  writeFileSync(video, Buffer.from(await res.arrayBuffer()));
  const probed = Number((await ffmpeg()("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video])).trim());
  if (Math.abs(probed - result.durationS) > 0.5) fail.push(`video is ${probed}s, expected ${result.durationS}s`);

  // The clip scene's narration outlasts its clip: late in the scene we must still see the clip's last frame.
  const plan = (await db.select().from(schema.artifacts).where(eq(schema.artifacts.projectId, projectId))).filter((a) => a.kind === "plan").at(-1)!.data as any;
  const assets = (await db.select().from(schema.artifacts).where(eq(schema.artifacts.projectId, projectId))).filter((a) => a.kind === "sceneAssets").map((a) => a.data as any);
  let offset = 0;
  for (const s of plan.scenes) {
    const a = assets.find((x) => x.sceneId === s.id);
    const clip = a.visuals.find((v: any) => v.role === "clip");
    if (s.visualType === "clip" && clip) {
      const t = offset + a.audio.durationS - 0.8;
      const clipS = clip.asset.durationMs / 1000;
      if (a.audio.durationS - 0.8 <= clipS) fail.push(`test setup: clip scene narration (${a.audio.durationS}s) not longer than clip (${clipS}s)`);
      const frame = join(dir, "late.png");
      await ffmpeg()("ffmpeg", ["-v", "error", "-ss", t.toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-y", frame]);
      const pngBytes = readFileSync(frame);
      const i = pngBytes.indexOf("IDAT");
      const [, r = 0, g = 0, b = 0] = inflateSync(pngBytes.subarray(i + 4, i + 4 + pngBytes.readUInt32BE(i - 4)));
      console.log(`  clip scene ${s.id}: frame at ${t.toFixed(1)}s (clip is ${clipS}s) = rgb(${r},${g},${b})`);
      if (!stills.length && !(g > 120 && r < 120)) fail.push(`clip scene ${s.id}: expected the clip's last (green) frame held at ${t.toFixed(1)}s, got rgb(${r},${g},${b})`);
    }
    offset += a.audio.durationS + 0.6;
  }

  const types = plan.scenes.map((s: any) => `${s.id}:${s.visualType}`).join(" ");
  console.log(`  scenes ${types}`);
  if (plan.scenes.some((s: any) => s.visualType === "presenter")) fail.push("presenter scene was not mapped");
  if (plan.scenes.some((s: any) => s.targetS > 45)) fail.push("targetS not clamped");
  const qaFailed = assets.flatMap((a) => a.qa.filter((q: any) => !q.passed).map((q: any) => `${a.sceneId} ${q.check}: ${q.notes ?? q.fallback}`));
  console.log(`  expected QA retries:\n    ${qaFailed.join("\n    ") || "(none)"}`);
  if (!qaFailed.some((q) => /MODERATION_FAILED/.test(q)) && !log.includes("hedra recraft-v3")) fail.push("moderation fallback path not exercised");
  console.log(`  ${log.filter((l) => l.startsWith("hedra")).length} Hedra jobs, ${log.filter((l) => l.startsWith("llm")).length} LLM calls`);

  server.close();
  if (fail.length) {
    console.error(`\nSMOKE FAILED:\n- ${fail.join("\n- ")}`);
    process.exit(1);
  }
  if (!process.env.SMOKE_KEEP) await db.delete(schema.projects).where(eq(schema.projects.id, projectId)); // keep the library clean
  console.log("\nSMOKE OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
