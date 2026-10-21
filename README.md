# Explainer

Type a question. About ten minutes later you get a short animated explainer video — researched, sourced, narrated, captioned — and you can watch it being made.

That's the whole interface. There is no editor, no template picker, no "review your script" step. One question in, one video out. Everything below is about the decisions that make that possible without the result being junk.

## Running it

You need [Docker Desktop](https://www.docker.com/products/docker-desktop/) and three API keys: [Hedra](https://www.hedra.com/) (pictures, clips, voice, music), a language model — [Anthropic](https://console.anthropic.com/) for Claude Opus 5.5 or [OpenAI](https://platform.openai.com/) — and [Exa](https://exa.ai/) (web search).

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
- **A run sits at "Starting…" and never moves?** The background worker (Inngest, http://localhost:8288) isn't running or hasn't found the app. The setup page shows it as "Background worker"; `docker compose restart inngest` usually fixes it, and `docker compose logs inngest web` says why if not.
- **The page says it went quiet?** No progress event for 15 minutes means the run died under it: `docker compose up` was run again, or the laptop slept. Everything it saved is kept, and **Try again** on the page redoes only what is missing.
- **Where are the logs?** Not in a file on your machine: Docker keeps each container's output only while that container lives, and `docker compose up --build` replaces the containers. To write them to a file: `docker compose logs --since 2h --no-color web inngest > ~/Desktop/explainer-logs.txt`. A run's own trail survives restarts in Postgres: `docker compose exec postgres psql -U postgres -d explainer -c "select stage, left(message, 80) as message, at from progress_events order by at desc limit 40"`.
- **Which model writes the videos?** Whichever key you set: `ANTHROPIC_API_KEY` for Claude Opus 5.5, otherwise `OPENAI_API_KEY`. With both set, Claude writes and OpenAI only transcribes the narration so captions land on the exact word (without it, timing is estimated). "Opus 5.5 high" means the same model thinking harder: `LLM_EFFORT=high` (its default is medium). The setup page names the model and effort in use.
- **Want the model to animate, not just fill in templates?** Set `ANIMATION_AUTHOR=model` in `.env` and restart. Each Illustrated motion scene is then written by the model as code on the flat toolkit, around the picture Hedra drew for it, rendered in the `three` sandbox and judged on frames; a scene whose animation fails the review falls back to its template. It is an experiment: slower and costlier per video, and meant for Claude. Leave it blank for the templates.
- **The final render is slow?** It paints every frame in headless Chrome with no GPU: on a laptop in Docker that is a few frames a second, so a 3-minute video takes 10 to 30 minutes. The progress page shows the frame count and rate as it goes, and `docker compose logs web | grep render` prints the same. Two levers: give Docker Desktop more CPUs and memory (Settings → Resources), and `RENDER_SCALE=0.6667` in `.env` for 720p, about twice as fast. A render that runs past `RENDER_TIMEOUT_S` (90 minutes by default) is stopped with the reason, and **Try again** on the page redoes only the edit.
- **The render was killed part-way?** It ran out of memory. Each tab painting frames needs about 700 MB at 1080p, and the stack around it about 2.5 GB; the worker picks the number of tabs to fit what Docker Desktop has (Settings → Resources: 8 GB is comfortable, 4 GB works with `RENDER_SCALE=0.6667`), and prints the choice in `docker compose logs web | grep render`. A killed render is not retried blindly, since the retry would die the same way: the page says what happened, and **Try again** redoes only the edit.
- **The 3Blue1Brown style shows "not available"?** Its Manim sandbox isn't running: `docker compose logs manim`. Illustrated videos don't need any sandbox.

Keys and credits are the only things that can stop a run. The app checks them quietly before it starts one.

To share it beyond your laptop: [deploy/README.md](deploy/README.md). The free way is a tunnel from your laptop (two commands); the always-on way is one server with HTTPS (about fifteen minutes).

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

- **Motion graphics** for how things work. These are not drawn freehand by a model: they are a handful of templates a person designed once, in the house style, and the model only fills them in. Steps in order (or a cycle), two or three things compared, one number that matters, a myth against the fact. Each sits beside an illustration of the scene's subject, and each thing on screen lands on the word that names it.
- **An illustration** for what something looks like — anatomy, a machine, a place — generated in the house style. Its parts are then found in the picture by looking at it, and a label points at each one as it's mentioned.
- **A short generated clip** for establishing shots and demonstrations.
- **A chart** when the point is a number, and **key points** for the recap.

A video must look illustrated: the hook is always a picture, at least a third of the scenes are pictures, and key points appear once, at the end. The script is told so, and the plan is corrected if it forgets.

The rule that matters most, learned from watching bad output: **a model is good at deciding what to say and bad at drawing it.** Earlier versions asked the model to write the animation code itself, and the results were abstract shapes standing in for ideas: a blob labelled "river", boxes with arrows for "language". So the drawing is fixed and the model's job is reduced to words, icons, numbers and timing, which it does well. The templates can't produce clutter, text that spills out of its box, or a diagram where a picture was wanted, because none of those is a choice they offer.

The same things look the same in every scene. Early on, the script names the three to six recurring "cast members" of the video — the subject, its key parts, the viewer's stand-in — with a fixed look and colour each, and every scene draws them that way.

### Two styles

- **Illustrated**: the flat house style — a limited palette, simple shapes, no outlines, generous space — animated. Pictures come from Hedra; the motion comes from the templates above. Nothing a model wrote ever runs, unless the operator opts in (`ANIMATION_AUTHOR=model`): then the model writes each motion scene's animation as code on a small flat toolkit (shapes, labels that size themselves, icons, a camera, the scene's picture as an element), it is rendered in the sandbox with no keys and no internet, frames are judged against the narration, and a scene that never passes is drawn from its template instead.
- **3Blue1Brown**: scenes written as [Manim](https://www.manim.community/) code — equations, graphs, geometry, built up step by step on black — and rendered in a sandbox with no keys and no internet, because here the model does write the code (it has seen a great deal of Manim). No generated pictures at all, so it costs a fraction of an illustrated video.

### Building the video

Narration is recorded first, because everything else is timed to it. The voice gets a few delivery marks per scene (curious, a dramatic pause) chosen by the model and checked word for word against the script; if a single word differs, the plain script is read instead. The recording is then transcribed to get the exact time of every word, so captions highlight the word being spoken and animations cue to it.

Every generated picture is **checked by looking at it**. Still images and clips are judged for whether they show what was asked and whether they match the house style; a failure is retried on the next model, then the scene steps down to something safer, and a scene is never left blank. Template scenes need no check: the schema refuses a template that is filled in wrong (a step too many, an icon that doesn't exist), and the drawing itself can't go wrong. In the 3Blue1Brown style, where the model writes Manim code, frames of each render are judged against the plan and failures go back to the model with the reviewer's notes, up to three times.

Then the cut: a flat colour swipe between scenes, a sound kit (pops, whooshes, a chime on the end card), and a music bed under the narration. The music is composed once per tone and played **end-aligned** — it starts partway in so its composed ending lands exactly on the end card, so it never cuts off mid-phrase. The video closes on the learning goal and the list of sources that were actually opened.

### While you wait

Ten minutes is a long time to stare at a progress bar, so the progress page is built from what the pipeline has already found, the moment it finds it:

- **The sources**, as each one is opened, with a fact pulled from it.
- **Did you know?** — the strongest claims from the research, deduplicated so the same fact doesn't appear twice in different words.
- **Myth or fact?** — a quiz built from the misconceptions the research found (the myths) and the best-corroborated facts, interleaved so the answer isn't always "myth", with the correcting claim shown after each answer and a running score.
- **The storyboard**: every scene's picture and narration as it's made, with a play button for the voice.
- **The rough cut**, once scenes are finished: the real composition plays in the browser — narration, captions, motion, transitions — while the final video (with its music) still renders. Until then the frame shows the opening line. A strip under it colours each scene by where it is: in the cut, being animated, built in the edit, still drawing.
- **The progress card**: five stages (Understanding, Researching, Writing, Illustrating, Editing), each with a note like "13 sources" or "4 of 8 scenes ready", the live status line, the time left as a range, and the percentage, which the tab title also shows.

By the time the video is ready, a curious viewer has already learned most of it.

When a scene is drawn again after a failed attempt, the status line says so in amber and the scene's row reads "Retrying". If the run stops for good, the page says which stage it stopped at and what was kept, and **Try those scenes again** picks it up from there: the research, script, voice and the scenes that were made stay; only what is missing is made, then the cut. **Start over** asks the question afresh.

### After the video

The Watch page is the video with its own control bar (a tick on the progress bar at every scene), the title, one line of facts about it (style, length, sources, what it cost), and the actions: **Simpler** and **Deeper** under "Make another version", since each starts a new paid video, then **Share** and **Captions (.srt)**. A follow-up box asks "Wait, why does…?". Below, **Did it land?**: myth or fact, then explaining it back in your own words to a tutor who says what landed. The sidebar holds the transcript, each paragraph with the time it starts (click one to jump there; the one playing is highlighted), and the numbered sources. The share link shows the same page with "Ask your own question" in place of the paid actions.

### What it costs

Per video: a few cents of search and writing, a dollar or two of narration and pictures in the illustrated style (clips are the expensive part), much less in the 3Blue1Brown style. One-time: about $2.40 per tone for its music bed and a few cents for the sound kit, kept and reused forever. Every paid request carries a key derived from its content, so a retry never pays twice. The three-minute cap is the main lever on cost.

## If you want to change how it works

The decisions above are data and short rule texts, not spread through the code:

| What | Where |
| --- | --- |
| Which sites count as reputable | `packages/pipeline/src/providers/search.ts` → `domainReputation` |
| How level, tone and background are inferred | `packages/pipeline/src/stages/intake.ts` |
| The seven beats, the writing rules, the length cap | `packages/pipeline/src/stages/script.ts`; `MAX_VIDEO_SECONDS` in `.env` |
| What each scene type is for | `packages/pipeline/src/stages/script.ts` → `TYPE_DESCRIPTIONS` |
| What the model is told when it fills a template | `packages/pipeline/src/stages/templates.ts` |
| The templates themselves (how steps, comparisons, counts, splits, points, charts and callouts move) | `packages/render/src/motion/` (`pnpm --filter @explainer/render templates out/` renders a frame of each) |
| The rules for model-written Manim and 3D code (3Blue1Brown style) | `packages/pipeline/src/stages/engines.ts` |
| The house style: palette, voice, which models for which picture | `config/house-style.json` |
| Music levels, cut length, sound volume | `packages/render/src/props.ts` |
| Music and sound prompts | `packages/pipeline/src/stages/library.ts` |

It's a TypeScript monorepo: a Next.js app (`apps/web`), the pipeline stages (`packages/pipeline`), the Hedra client (`packages/hedra`), the video composition and its motion templates (`packages/render`), and two sandboxes for the 3Blue1Brown style that run model-written animation code with no keys and no internet (`animator/manim` for Manim, `packages/render/src/animator` for three.js). `pnpm -r test` runs the tests; `pnpm --filter @explainer/web smoke` runs the whole pipeline end to end against fake APIs and renders a real video (`docker compose exec web pnpm --filter @explainer/web smoke` inside the stack).

Speed: the longest step is the final render, which is bound by how fast Chrome can paint 1080p frames — give Docker Desktop more cores (Settings → Resources) before anything else; `RENDER_SCALE=0.6667` in `.env` renders 720p about twice as fast. Hosting notes, every setting and its default: `.env.example`.
