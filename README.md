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

## Smoke test without paid APIs

`pnpm --filter @explainer/web smoke` runs the whole pipeline — every stage, the Postgres store, the S3 mirror, frame sampling and a real Remotion render — with fake OpenAI, Exa and Hedra. The fake Hedra rejects any request that breaks a model's published input schema. It needs the database and bucket from `.env` (the Docker stack works: `docker compose exec web pnpm --filter @explainer/web smoke`) and prints `SMOKE OK` with the rendered video's URL. To watch the progress page fill in, slow it down and keep the project: `SMOKE_DELAY_MS=3000 SMOKE_KEEP=1`, then open the `/p/<project id>` it prints (`SMOKE_STILLS=a.png,b.png` uses real images as the fake stills).

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
4. **visuals** (per scene, in parallel): narration via Hedra at the house voice and speed → forced alignment → storyboard still with the house reference frame → vision check → clip or animated still → vision check → retry on the next model → demote to a safer visual type.
5. **assemble**: pacing, factual-integrity and watchability checks, then a Remotion render (local or Lambda), captions, sources end card.

Every Hedra call carries an idempotency key from a hash of its input, so retries never pay twice. Every Hedra output is mirrored to our bucket; both the Hedra asset id and our URL are recorded.

## What's decided and where

| Decision | Where |
| --- | --- |
| House style: flat illustration, detailed; dark/light backgrounds | `config/house-style.json` → `styleText`, `backgrounds`, `referenceFrames` |
| Narrator: David O. on `elevenlabs-multilingual-v2` at 1.1× | `config/house-style.json` → `voice` |
| Models per visual type (`kling-25-turbo` stills-in-motion, `wan-3-0` clips, `minimax-h3` retry) | `config/house-style.json` → `models` |
| Scene budget: ~165 wpm, 20–40 s scenes | `packages/schemas/src/index.ts` → `sceneBudget` |
| Length cap: 3 min (`MAX_VIDEO_SECONDS`); over-long scripts are rewritten, then trimmed, before any media is made | `packages/pipeline/src/stages/script.ts` → `estimateVideoS`, `trimToFit` |
| QA pass thresholds and demotion ladder | `packages/pipeline/src/stages/visuals.ts` |

## Still to wire up

- **Forced alignment service.** Hedra returns audio + duration only; `ALIGNMENT_URL` expects a WhisperX-class endpoint (`{audio_url, transcript} → {words}`). Without it, words are spread evenly across the clip (fine for captions, not for cue words).
- **Music bed and SFX.** Helpers exist in `packages/hedra`; the mix step in the composition is not yet written. Plan: a pre-generated bed per tone, ducked under speech.
- **Auth and library.** `users` table exists; no sign-in yet. Level inference from history reads `pressedSimpler/pressedDeeper` counts.
- **Internal QA queue.** Videos whose watchability check fell back are recorded in `qa`; a review UI for us is not built.
- **Remotion Lambda deploy.** `RENDER_TARGET=lambda` expects a deployed site and function; local rendering works out of the box.

## Tests

```bash
pnpm -r typecheck
pnpm -r test     # schemas, hedra client (fake fetch), pipeline stages (scripted LLM), render SRT/timing
```
