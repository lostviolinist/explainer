# Explainer

One question in, one animated explainer video out. The user types a topic or a question; the pipeline infers everything else, researches it with sources, writes a script that passes a learner check and an expert check, generates every visual and audio asset through the Hedra API in one fixed house style, renders with Remotion, runs automated QA in place of user review, and returns a video with captions and a sources card.

Planning doc with the reasoning behind every decision here: see the Claude doc "Explainer video pipeline: one question in, one video out".

## Layout

```
apps/web             Next.js: the question box, progress view, player, reactions, share page, Inngest serve route
packages/schemas     zod contracts between stages (Brief → ResearchBrief → ScenePlan → SceneAssets → RenderResult)
packages/hedra       Hedra v3 client: submit/poll, idempotency keys, model fallback, asset mirroring, webhook verify
packages/pipeline    the five stages as functions + Inngest orchestration; LLM/search/alignment/store behind interfaces
packages/render      Remotion composition (captions from word timestamps, programmatic layers, end card) + renderers
config/house-style.json  the style, reference frame asset ids, voice, model allowlists. Decisions, as data.
```

## Running with Docker

Requires Docker Desktop (or Docker Engine with Compose). Starts Postgres, an S3-compatible store (SeaweedFS), the Inngest dev server, and the app; tables and the bucket are created on startup.

```bash
cp .env.example .env            # fill in HEDRA_API_KEY, OPENAI_API_KEY, EXA_API_KEY
docker compose up --build
```

App: http://localhost:3000 · Inngest runs (step-by-step logs and errors): http://localhost:8288. Database and storage settings in `.env` are ignored here; the compose file points them at its own services. `docker compose down -v` wipes the data.

**Which version is running?** The footer of the home page (and `curl localhost:3000/api/version`) shows the git commit, branch and build time the site was built from; `git log -1` in your checkout should show the same commit. If it doesn't, the image wasn't rebuilt (`docker compose up --build` rebuilds it), or something other than the Docker stack is serving port 3000: `docker compose ps` lists the stack's containers, and on a Mac `lsof -nP -iTCP:3000 -sTCP:LISTEN` shows whatever process owns the port (a leftover `pnpm dev`, say; `kill` it, or a second copy of the stack in another folder, `docker ps` shows it).

The home page checks the setup (keys, credits, storage, renderer, animators) quietly in the background; visitors never see it unless something is broken, in which case the form is held with a plain message. To see every check, open http://localhost:3000/?setup (in development it's always shown). A run is also checked server-side before it starts.

## Video styles and animation sandboxes

The home page offers two styles:

- **Illustrated**: the flat house style, animated. Mechanisms and processes are flat motion graphics built on screen as they're explained, written against a toolkit that does for flat scenes what Manim does for 3Blue1Brown ones (`packages/render/src/animator/kit/Kit.tsx`: draw-on, grow, pop, transform, move along paths, indicate, circumscribe, spotlight, a camera with keyframes, counters, bars, a line-icon set, self-sizing labels). Each scene is planned first (its subject, what a viewer sees at first glance in eight words, then 4–8 shots), coded against that plan, and reviewed on frames at known times for match, style and clarity. The sandbox refuses code that uses SVG text (labels and rows size themselves, so words can't spill out of boxes) or draws more than 14 things (one subject and a few supporting details read at a glance; a diagram of everything doesn't). Detailed pictures are Hedra stills whose parts get animated callouts as they're mentioned. Plus Hedra clips and animated stills, and 3D scenes where a 3D view explains better. Scenes cut with a flat colour swipe.
- **3Blue1Brown**: scenes written as [Manim](https://www.manim.community/) code (equations, graphs, geometry), plus 3D scenes. No Hedra images or video, only narration, so it costs a fraction of an illustrated video.

Manim, motion-graphics and 3D scenes are code the model writes per scene, timed to the narration. Two sandbox services render it: `animator/manim` (the official Manim image plus a small render server) and `three` (React + SVG motion graphics and React Three Fiber 3D, both rendered with Remotion; `packages/render/src/animator/three-server.ts`). For callouts, a vision pass first locates the still's parts; the code then draws over the still, which is sent along with it. Render errors and reviewer notes on sampled frames go back to the model for up to three attempts. After that, a Manim scene falls back to a plain safe scene, a motion scene becomes an illustrated diagram, a 3D scene becomes an animated illustration (or Manim in the 3Blue1Brown style), and a diagram whose callouts never work keeps its plain still.

The sandboxes run model-written code, so in the compose file they get no keys, no `.env`, and only the internal `sandbox` network (no internet), with memory, CPU and process limits. When hosting, deploy them privately (not exposed to the internet) and point `MANIM_URL` / `THREE_URL` at them. Both are optional: if one is missing, the setup check shows a warning and the pipeline doesn't use it (without `three`, illustrated videos are back to stills and Hedra clips). Manim's rules for the model distil [adithya-s-k/manim_skill](https://github.com/adithya-s-k/manim_skill) (MIT).

## Music, sound and voice

- **Music bed**: one instrumental track per tone (`elevenlabs-music`, about $2.40 per tone), composed to end on a resolved chord, generated the first time a video with that tone is made and kept in the bucket under `library/`. The composition plays it *end-aligned*: it starts partway into the track so the track's ending lands on the end card, and it is ducked under the narration. `MUSIC_BED=0` turns it off.
- **Sound effects**: a five-sound kit (pop, whoosh, tick, chime, swoosh; `elevenlabs-sound-effects`, a few cents in total, made once). Code scenes report their own cues; labels and chart bars pop; every swipe cut gets a swoosh; the end card a chime.
- **Voice**: `elevenlabs-v3` with a few delivery tags per scene (curious, excited, whispers, a dramatic pause…) chosen by the model and checked word for word against the script; if the tagged text changes a single word, or v3 refuses, the plain script goes to `elevenlabs-multilingual-v2`. Captions always show the clean script.

## Speed

Where the time goes, measured with the fake APIs (so this is our own work, not vendor latency), on a 4-core box: the **final render** is the longest step (a 64 s video takes ~4 min: Remotion captures 1080p frames from Chrome at 13–18 fps whatever is on them, and video scenes cost a little more), then the **animation sandbox** (each attempt bundled a fresh Remotion project for 12–29 s before ~45 s of rendering), then everything the model writes. What's done about it:

- The sandbox keeps stable render slots so Remotion's webpack cache stays warm: bundling drops from ~16 s to ~3 s per attempt after the first; two scenes render at a time (`MAX_PARALLEL`, with 4 cores in the compose file).
- Reviews that only need the script (facts, watchability; learner and expert) run in parallel and alongside the scene generation instead of before the render.
- Quick judgements (frame checks, delivery tags, prompt planning) ask the model for low reasoning effort; it falls back silently on a model without that setting.
- The final render paints on every core and encodes with x264 `veryfast` (measured: encoder and tab count barely matter; frame capture is the limit). `RENDER_SCALE=0.6667` renders 720p about twice as fast if that trade is acceptable.
- While the final render runs, the progress page plays a **rough cut**: the finished scenes with narration and captions, straight from the bucket, no render needed.

The lever that is yours: **Docker Desktop → Settings → Resources**: the stack is CPU-bound while rendering, and 6–8 cores make a visible difference. The structural next step, if render time matters more than anything, is to assemble the final video with ffmpeg (burned-in captions, crossfades, audio mix) instead of re-painting already-rendered scenes through Chrome; that is a rewrite of the composition, not a setting. Everything else is vendor latency (Hedra video generation, the model writing code) and the QA retries, which trade time for quality.

## Smoke test without paid APIs

`pnpm --filter @explainer/web smoke` runs the whole pipeline in both styles (the 3Blue1Brown run needs `MANIM_URL`; motion graphics, callouts and 3D scenes need `THREE_URL`) — every stage, the Postgres store, the S3 mirror, frame sampling and a real Remotion render — with fake OpenAI, Exa and Hedra. The fake Hedra rejects any request that breaks a model's published input schema. It needs the database and bucket from `.env` (the Docker stack works: `docker compose exec web pnpm --filter @explainer/web smoke`) and prints `SMOKE OK` with the rendered video's URL. To watch the progress page fill in, slow it down and keep the project: `SMOKE_DELAY_MS=3000 SMOKE_KEEP=1`, then open the `/p/<project id>` it prints (`SMOKE_STILLS=a.png,b.png` uses real images as the fake stills).

## Running locally

Requirements: Node 22, pnpm 10, Postgres, an S3-compatible bucket (MinIO is fine), and keys for Hedra, OpenAI, and Exa.

```bash
cp .env.example .env            # fill in keys; never commit .env
ln -s ../../.env apps/web/.env  # Next.js only reads .env from apps/web
pnpm install
pnpm db:push                    # creates tables via drizzle-kit
pnpm dev                        # Next.js on :3000
pnpm inngest                    # Inngest dev server; discovers /api/inngest
pnpm render:preview             # Remotion Studio for the composition, optional
```

Open http://localhost:3000, type a question, watch the progress view. The project page flips to the player when the `done` event arrives.

## How a video gets made

1. **intake** infers the brief (level, tone, background, learning goal) from the question. Nothing is asked.
2. **research** searches, opens pages (reputation-ranked), extracts claims with verbatim quotes, corroborates, finds misconceptions and analogies. Sets the video length from the count of *needed* claims.
3. **script** writes a seven-beat arc, then scenes with narration / visual direction / claim ids. A *learner* pass and an *expert* pass must both pass; two failures simplify the arc.
4. **visuals** (per scene, in parallel): narration via Hedra at the house voice and speed → word timestamps (OpenAI transcription, matched to the script) → storyboard still with the house reference frame → vision check → clip or animated still → vision check → retry on the next model → demote to a safer visual type.
5. **assemble**: pacing, factual-integrity and watchability checks, then a Remotion render (local or Lambda), captions, sources end card.

Every Hedra call carries an idempotency key from a hash of its input, so retries never pay twice. Every Hedra output is mirrored to our bucket; both the Hedra asset id and our URL are recorded.

## What's decided and where

| Decision | Where |
| --- | --- |
| House style: flat illustration, detailed; dark/light backgrounds | `config/house-style.json` → `styleText`, `backgrounds`, `referenceFrames` |
| Narrator: David O. on `elevenlabs-v3` at 1.1× (falls back to `multilingual-v2`) | `config/house-style.json` → `voice`; delivery tags in `packages/pipeline/src/stages/visuals.ts` → `deliveryFor` |
| Music levels, swipe length, sound-effect volume | `packages/render/src/props.ts` → `MUSIC`, `SWIPE_FRAMES`, `SFX_VOLUME` |
| Music beds and the sound kit (prompts, versions) | `packages/pipeline/src/stages/library.ts` |
| Models per visual type (`kling-25-turbo` stills-in-motion, `wan-3-0` clips, `minimax-h3` retry) | `config/house-style.json` → `models` |
| Scene budget: ~165 wpm, 20–40 s scenes | `packages/schemas/src/index.ts` → `sceneBudget` |
| Recurring cast (the same things drawn the same way in every scene) | `packages/pipeline/src/stages/script.ts` (`cast`), used in Hedra prompts and scene code |
| Captions: one sentence or clause at a time, two lines, word highlight from the timestamps | `packages/render/src/captions-layout.ts`, `Captions.tsx` |
| Video styles and which scene types each offers | `packages/pipeline/src/stages/script.ts` → `visualTypesFor` |
| Rules for model-written Manim / motion-graphics / three.js code | `packages/pipeline/src/stages/engines.ts` → `MANIM_RULES`, `motionRules`, `threeRules` |
| Length cap: 3 min (`MAX_VIDEO_SECONDS`); over-long scripts are rewritten, then trimmed, before any media is made | `packages/pipeline/src/stages/script.ts` → `estimateVideoS`, `trimToFit` |
| QA pass thresholds and demotion ladder | `packages/pipeline/src/stages/visuals.ts` |

## Still to wire up

- **Forced alignment service.** Word timing comes from OpenAI's transcription API (whisper-1 word timestamps, matched to the script). `ALIGNMENT_URL` can point at a WhisperX-class endpoint instead (`{audio_url, transcript} → {words}`). If both fail, timing is estimated from the text (word lengths and punctuation pauses); the caption highlight then drifts a little.
- **Auth and library.** `users` table exists; no sign-in yet. Level inference from history reads `pressedSimpler/pressedDeeper` counts.
- **Internal QA queue.** Videos whose watchability check fell back are recorded in `qa`; a review UI for us is not built.
- **Remotion Lambda deploy.** `RENDER_TARGET=lambda` expects a deployed site and function; local rendering works out of the box.

## Tests

```bash
pnpm -r typecheck
pnpm -r test     # schemas, hedra client (fake fetch), pipeline stages (scripted LLM), render SRT/timing
```
