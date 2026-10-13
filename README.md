# Explainer

Type a question. About ten minutes later you get a short animated explainer video — researched, sourced, narrated, captioned — and you can watch it being made.

That's the whole interface. There is no editor, no template picker, no "review your script" step. One question in, one video out. Everything below is about the decisions that make that possible without the result being junk.

## Running it

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) and three API keys: [Hedra](https://www.hedra.com/) (pictures, clips, voice, music), [OpenAI](https://platform.openai.com/) (the writing and the checking), and [Exa](https://exa.ai/) (web search).

```bash
cp .env.example .env            # put the three keys in
docker compose up --build
```

Then open http://localhost:3000, type a question, and watch. The first run takes a few extra minutes while Docker builds things.

Good to know:

- **Setup problems** show at http://localhost:3000/?setup (missing key, no credits, a service that isn't running). Visitors never see that page; if something is broken they just get "we can't make videos right now".
- **Which version is running** is written at the bottom of the home page (`build 83547ba (main) · date`). After `git pull`, run `docker compose up --build` again and that line should change.
- **To update:** `git pull`, then `docker compose up --build`. To stop everything: `docker compose down`.
- **Something failed?** http://localhost:8288 shows every step of every run with its logs and errors.

Keys and credits are the only things that can stop a run. The app checks them quietly before it starts one.

## The philosophy

### Nothing is asked of the user

The person typing the question doesn't know what level they want, how long the video should be, or what tone fits. So we don't ask. We read the question: "why do leaves change colour" is a beginner question in a neutral tone; "how does chlorophyll degradation trigger anthocyanin synthesis" is a deep one. Space and physics get a dark background; most other things get a light one. Medicine, law, money and grief get a serious voice; "why is X so weird" gets a playful one.

If we guessed wrong, the viewer presses **Simpler** or **Deeper** after watching and gets a new video. Those two buttons are the whole feedback system. We'd rather make a second video than make the first one a form.

### Sources: reputation first, then agreement

The video must not say anything it can't point to. So before a word is written:

1. We search the web several ways, including one search aimed at **what people commonly get wrong** about the topic.
2. We **rank the results by who published them**, and only open the top handful. Universities, governments, NASA, NIH, WHO, Britannica, Nature and the like rank highest; Wikipedia and serious journalism in the middle; forums, Quora, Medium and content farms at the bottom. An unknown site is treated with mild suspicion.
3. From each page we pull out **claims with a verbatim quote** behind each one. A number is only allowed if it literally appears on the page. A page that can't be read is dropped.
4. We **merge the claims across pages and see which ones agree**. A claim backed by two or more reputable pages is *corroborated*. A claim only one page makes — or only low-reputation pages make — is *single-sourced* and is said more carefully. A claim the sources **disagree** on is *contested* and is left out, or scripted as a disagreement, never stated flatly.
5. Each claim is marked **needed**, **nice**, or **advanced** for this learner. Needed claims set the length of the video: a topic that needs six things explained gets a two-minute video; one that needs twelve would get five — but see the cap below.

Alongside the claims, we collect the **misconceptions** a learner at this level probably holds, and **analogies** that help, each with a note on where the analogy breaks down. Both end up in the script.

### The script: a fixed arc, then two readers who have to pass it

Every video follows the same seven beats, in this order: **hook, ground, misconception, build-up, core, payoff, recap.** The hook is a surprising fact or a question; the misconception is stated and then corrected; the recap uses the exact words of the learning goal. Fixed structure is what lets a machine write something that feels shaped.

The script is written in short sentences, speaking to "you", with a question planted early and answered later, and a turn in every scene — something unexpected, a comparison with something familiar, or a "but here's the catch". Numbers are said as comparisons ("five times more"), not figures.

Then two readers have to pass it, and the video doesn't proceed until both do:

- **The learner** is told their level, reads the script once, and has to answer the learning goal in their own words and list any sentence they couldn't follow, or any term used before it was explained.
- **The expert** has the research notes and has to list every sentence with no claim behind it, or stated more confidently than its claim allows.

If either fails, the script is rewritten. If it fails twice, the arc is simplified: fewer claims, more time for each. Simpler beats faster.

**The length cap.** A video is capped at three minutes, a little over is fine. A topic with more research than fits is condensed to what the learner needs to meet the goal — deep detail is dropped rather than rushed. This is also the main control on how much each video costs.

### Scenes: what each one shows, and why

Each scene is one idea with one picture. The script says what's seen in the way a director would — naming the metaphor and what moves, in what order, on which words — and picks a type of picture for it:

- **Motion graphics** for how things work: processes, flows, cycles, cause and effect, comparisons, quantities. Built on screen as the narration explains it: shapes draw themselves on, things travel and transform, the thing being talked about is the thing that moves.
- **An illustration** for what something looks like — anatomy, a machine, a place — generated in the house style, with animated callouts that point at each part as it's mentioned.
- **A short generated clip** for establishing shots and demonstrations.
- **A 3D scene** when something is spatial: orbits, molecules, light paths.
- **A chart** when the point is a number, and **a title card** for a recap.

The rule that matters most, learned from watching bad output: **one idea per scene, drawn as things rather than as diagrams of things.** A word is a word card, light is a moving dot, heat is a glow. Boxes-and-arrows only when the narration is literally about boxes and arrows. Before any scene is animated, the director has to say in eight words what a first-time viewer sees in the first second; if that can't be said, the scene is too complicated and gets simplified. A scene with more than fourteen things in it is refused outright.

The same things look the same in every scene. Early on, the script names the three to six recurring "cast members" of the video — the subject, its key parts, the viewer's stand-in — with a fixed look and colour each, and every scene draws them that way.

### Two styles

- **Illustrated**: the flat house style — a limited palette, simple shapes, no outlines, generous space — animated. Pictures come from Hedra; motion graphics, callouts and 3D scenes are written as code and rendered in a sandbox.
- **3Blue1Brown**: scenes written as [Manim](https://www.manim.community/) code — equations, graphs, geometry, built up step by step on black. No generated pictures at all, so it costs a fraction of an illustrated video.

### Building the video

Narration is recorded first, because everything else is timed to it. The voice gets a few delivery marks per scene (curious, a dramatic pause) chosen by the model and checked word for word against the script; if a single word differs, the plain script is read instead. The recording is then transcribed to get the exact time of every word, so captions highlight the word being spoken and animations cue to it.

Every picture is **checked by looking at it**. Still images are judged for whether they show what was asked and whether they match the house style. Animations are judged on frames at known moments against the plan: does each frame show what should be on screen then, is something visibly different between frames, would a first-time viewer understand it at a glance. A failure goes back to the model with the reviewer's notes, up to three times. After that the scene steps down to something safer — a simpler animation, a plain illustration — and a scene is never left blank.

Then the cut: a flat colour swipe between scenes, a sound kit (pops, whooshes, a chime on the end card), and a music bed under the narration. The music is composed once per tone and played **end-aligned** — it starts partway in so its composed ending lands exactly on the end card, so it never cuts off mid-phrase. The video closes on the learning goal and the list of sources that were actually opened.

### While you wait

Ten minutes is a long time to stare at a progress bar, so the progress page is built from what the pipeline has already found, the moment it finds it:

- **The sources**, as each one is opened, with a fact pulled from it.
- **Did you know?** — the strongest claims from the research, deduplicated so the same fact doesn't appear twice in different words.
- **Myth or fact?** — a quiz built from the misconceptions the research found (the myths) and the best-corroborated facts, interleaved so the answer isn't always "myth", with the correcting claim shown after each answer and a running score.
- **The storyboard**: every scene's picture and narration as it's made, with a play button for the voice.
- **The rough cut**, once scenes are finished: they play back to back with narration and captions while the final video (music, transitions, sound) still renders.

By the time the video is ready, a curious viewer has already learned most of it.

### What it costs

Per video: a few cents of search and writing, a dollar or two of narration and pictures in the illustrated style (clips are the expensive part), much less in the 3Blue1Brown style. One-time: about $2.40 per tone for its music bed and a few cents for the sound kit, kept and reused forever. Every paid request carries a key derived from its content, so a retry never pays twice. The three-minute cap is the main lever on cost.

## If you want to change how it works

The decisions above are data and short rule texts, not spread through the code:

| What | Where |
| --- | --- |
| Which sites count as reputable | `packages/pipeline/src/providers/search.ts` → `domainReputation` |
| How level, tone and background are inferred | `packages/pipeline/src/stages/intake.ts` |
| The seven beats, the writing rules, the length cap | `packages/pipeline/src/stages/script.ts`; `MAX_VIDEO_SECONDS` in `.env` |
| What each scene type is for, and the clarity rules for animations | `packages/pipeline/src/stages/engines.ts` |
| The house style: palette, voice, which models for which picture | `config/house-style.json` |
| Music levels, cut length, sound volume | `packages/render/src/props.ts` |
| Music and sound prompts | `packages/pipeline/src/stages/library.ts` |

It's a TypeScript monorepo: a Next.js app (`apps/web`), the pipeline stages (`packages/pipeline`), the Hedra client (`packages/hedra`), the video composition (`packages/render`), and two sandboxes that run model-written animation code with no keys and no internet (`animator/manim` and `packages/render/src/animator`). `pnpm -r test` runs the tests; `pnpm --filter @explainer/web smoke` runs the whole pipeline end to end against fake APIs and renders a real video (`docker compose exec web pnpm --filter @explainer/web smoke` inside the stack).

Speed: the longest step is the final render, which is bound by how fast Chrome can paint 1080p frames — give Docker Desktop more cores (Settings → Resources) before anything else; `RENDER_SCALE=0.6667` in `.env` renders 720p about twice as fast. Hosting notes, every setting and its default: `.env.example`.
