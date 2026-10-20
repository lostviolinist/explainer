# Unfold redesign: handoff

This folder is the redesign of the Explainer app (the Next.js app on `localhost:3000`). The app is renamed **Unfold**. Build the app to match it.

Start with the screenshots in `screens/`. They are the source of truth for layout and look. Use `tokens.css` and the files in `source/` for exact values.

## What's in here

| Path | What it is |
|---|---|
| `screens/desktop/` | Home, Being made (progress) and Watch at 1440px wide, full page |
| `screens/phone/` | The same three pages at 390px wide |
| `screens/states/` | Every progress stage, a scene retrying, a video that stopped, Home when the setup check fails, the quiz answered, the Sources tab |
| `tokens.css` | Colors, fonts, type sizes, radii and spacing as CSS variables |
| `brand/` | Logo mark (dark and light backgrounds), app icon, a sheet of logo options |
| `source/` | The design files the screenshots were rendered from (see "Reading the source files") |

## Reading the source files

`source/*.dc.html` use a design-tool format, not production code. Don't ship them or try to run them. They are useful because every element has its exact inline styles.

- `{{name}}` is a value computed in the `<script>` block at the bottom of the file (`renderVals()`).
- `<sc-for list="{{items}}" as="x">` repeats its children. `<sc-if value="{{flag}}">` shows them only when the flag is true.
- `<dc-import name="Making" stage="stopped">` embeds another file with props. The phone and error-state files are just wrappers like this.
- The `data-props` attribute lists design tweaks. `Making.dc.html` has a `stage` prop that drives every progress state. `Main.dc.html` has `status` ("ok" or "setup").
- `Main.dc.html` is Home, `Making.dc.html` is Being made, `Watch.dc.html` is Watch.

## Look and feel

- **Dark only.** Background `#0D0D10`, cards `#16161B` with a 1px `#2A2A33` border and 18px radius. No gradients, no glows. The old purple-to-pink gradient washes, gradient buttons and gradient text are gone.
- **One accent:** `#A99BFF`, used solid. Text on accent is `#0D0D10`. Selected things get a 12% accent background and a 45% accent border.
- **Fonts:** Instrument Sans for headings, Geist for everything else, Geist Mono for times, counts and percentages. Inter is gone.
- **Sizes:** the Home hero is `clamp(44px, 6vw, 84px)`, weight 700, letter-spacing -0.025em. Page titles are `clamp(30px, 3.4vw, 44px)`, weight 700, letter-spacing -0.02em. Section titles are 28px. Small uppercase labels are 12px, weight 600, letter-spacing 0.08em, color `#8A8995`.
- **Touch targets:** anything clickable is at least 44px tall.
- **Width:** content is 1200px max on Home and 1280px on the other pages, with 24px side padding.
- **Two-column pages** use a wrapping flex row: main `flex: 999 1 560px`, sidebar `flex: 1 1 340px`. On a phone the sidebar drops below. Breakpoints used: 960px, 720px, 600px.
- **Titles** are clean sentence case ("What is backpropagation?"), not the raw query ("what is a backpropagation?"). Generate a cleaned title when a project is created.

## Logo

A play button with its top-left corner folded down like a dog-eared page (`brand/unfold-mark.svg`). The folded flap is a lighter tint of the accent (`#DDD7FF`). On light backgrounds use `unfold-mark-on-light.svg`. In the header: 28px mark, then "Unfold" in Instrument Sans 21px, weight 650.

## Home (`screens/desktop/01-home.png`)

1. **Header:** logo left, "Recent" link right.
2. **Hero:** keep the existing copy. "understand" is in the accent color.
3. **Composer:** one card holding everything about the request.
   - A 2-line textarea, 22px text.
   - Below it, the **style choice** as two toggle buttons, each with a small thumbnail: Illustrated and Mathematical. The style used to sit outside the input as two big cards. "3Blue1Brown" is renamed "Mathematical" so it doesn't use a real creator's name. The subtitle still says Manim.
   - On the right, "about 10 min" (mono) and the **Explain it** button.
4. **Example prompts:** a "Try" row of chips. Clicking one fills the textarea.
5. **Still being made:** a new row listing any project that isn't finished yet. Each shows title, progress bar, %, current stage, scenes ready and time left, plus a "Watch it being made" link to its progress page. The current app doesn't list in-progress projects anywhere.
6. **Made here recently:** a 4-column grid. The newest video is a large featured card spanning 2x2. Each card has a 16:9 thumbnail, duration chip, cleaned title and the style ("Illustrated" or "Mathematical") under it. The style label tells apart the two "What is a transformer model?" videos. A "Show all" button sits below.
7. **Footer:** no build hash.

**Thumbnail bug:** the Henry VIII card is blank and one transformer card is solid black. Those cards use the video itself at `#t=0.5`, which is still the empty first frame. Use a frame from the middle of the video, or the poster image other projects already have.

**Setup check failed** (`screens/states/home-setup-check-failed.png`): when the existing setup check fails, show an amber banner above the composer. Title "Can't start new videos right now", a reason line, and a "Check again" button. While it re-checks, the reason line reads "Checking the setup (OpenAI, Exa, Hedra, storage, renderer, animators)…". "Explain it" is disabled. Everything below still works.

## Being made (`screens/desktop/02-being-made.png`, states in `screens/states/being-made-*.png`)

The live progress page. It uses data the app already has: stages, status line, time left, opening line, rough cut, storyboard, learning goal, facts, myth or fact, and sources.

1. **Title**, then a **progress card**:
   - Five equal segments for the app's stages: Understanding, Researching, Writing, Illustrating, Editing. These replace the pills and gradient bar.
   - Each segment has a bar, an icon, the stage name and a short note: done is a filled check, current is a spinner, waiting is an empty circle. Notes look like "13 sources", "11 scenes, tested on a learner" or "1 of 11 scenes ready".
   - Below a divider: the live status line (e.g. "Animating scene 3…"), time left, and %.
   - **Show time left as a range** ("About 7–9 min left"). The single number jumped 13, 18, 7 during one run.
   - On a phone, the stage names hide and a line "Step 4 of 5 · Illustrating" shows instead.
2. **Rough cut:** the player with "1 of 11 scenes · no music yet".
   - Until there is something to play, the frame shows the opening line as a title card ("Your video opens with…" plus the hook) instead of a blank cream frame. This removes the separate "Your video opens with" card.
   - Under the player, a strip of one segment per scene with a legend: cream for in the cut, accent for being animated, purple tint for built in the edit, dark for still drawing. Amber means retrying, coral means it didn't draw.
3. **Storyboard:** a compact list, one row per scene. It replaces the 3-column grid of mostly empty cards. Each row has:
   - number and a small thumbnail
   - the scene-type tag (HOOK, GROUNDING, MYTH-BUSTER, BUILD-UP, CORE IDEA, PAYOFF, RECAP; colors in `tokens.css`) and the first line of narration
   - three status marks: Script, Voice, Picture. Picture reads Drawing, Animating, In the edit, Retrying or Didn't draw. The app works on scenes in parallel, and these marks make that visible.
   - a 44px button to play that scene's voice

   On a phone the marks collapse to a one-word status under the line.
4. **Sidebar, in this order:**
   - **"No need to wait here"**, moved from the bottom to the top and tinted with the accent. Copy: "It keeps going if you close this tab. Come back to this link any time. The tab title shows how far along it is." Buttons: "Notify me when it's ready" (pressed state: "We'll notify you", with a note that a browser notification needs one tab open) and "Copy link". The old card said "it keeps going if you close this tab" next to "keep the tab open", which contradicted itself. On a phone a short version of this card sits right under the progress card.
   - **By the end you'll be able to:** the learning goal, plus chips for level, tone and length.
   - **While you wait:** the "Did you know?" fact carousel (n/12, with source) and "Myth or fact?" in one card.
   - **Sources** with letter avatars, the first 6 shown, then "Show all 13".
5. **Done:** all segments checked, a "Watch it" button over the finished frame, linking to the Watch page.

**Problems** (new states):

- **Retrying** (`being-made-7-retrying.png`): when a scene fails and is retried automatically, the status line turns amber ("Scene 7 didn't draw cleanly. Trying again with a simpler picture…"). That scene's Picture mark reads "Retrying, 2 of 3" in amber.
- **Stopped** (`being-made-8-stopped.png`): the Illustrating segment turns coral with an X. An alert replaces the status line: "This one stopped at Illustrating". It names the failed scenes and says the research, script, voice and other scenes are kept. Actions: **Try those 3 scenes again** (primary), **Start over**, **Report a problem**. Failed rows show "Didn't draw" in coral. The waiting card is hidden.

## Watch (`screens/desktop/03-watch.png`)

1. **Player:** the poster frame with a floating dark control bar (play, time, captions, volume, full screen). The bar keeps the controls readable on cream frames. The progress bar has tick marks at each transcript paragraph.
2. **Title**, then one meta line: style chip, duration, number of sources, and the cost ("$1.63 to make" with an info tooltip: "Search, writing, voice, pictures and the checks"). The cost used to be its own line between the buttons and the follow-up box.
3. **Actions:**
   - **Simpler** and **Deeper** are grouped under "Make another version" (accent-tinted) because they start a new paid video.
   - **Share** and **Captions (.srt)** are plain buttons on the right.
4. **Still curious?** The follow-up box, with the placeholder shortened to "Wait, why does…?".
5. **Did it land?** Two numbered cards, stacked:
   - **Myth or fact:** after a pick, a result line appears ("Right, it's a myth." in teal or "Not quite: it's a myth." in orange) with the explanation.
   - **In your own words:** the prompt is a real question ("How does a neural network learn from one wrong guess?"). The old prompt pasted the learning goal into the question, which gave away the answer and left a ".?" typo. "Check my explanation" stays visibly disabled, with the hint "Write a sentence or two, then check it.", until there's text.
6. **Sidebar:** tabs for **Transcript** and **Sources**, replacing the bottom-of-page list and the collapsed transcript.
   - Transcript paragraphs each have a timestamp. Clicking one seeks the video, and the current one is highlighted.
   - Sources are numbered, titles clamp to 2 lines, and the domain sits underneath. Clean source titles: strip leading numbers ("14 Backpropagation – …" becomes "Backpropagation – …"). Show "Untitled page" when a title is missing.

## Sample values

These are placeholders in the design, not real data: time-left ranges, "Took 16 min", "Retrying, 2 of 3", which scenes failed (5, 7, 10), the 1:24 rough-cut length, transcript timestamps (estimated from paragraph length), and the "1:00" playhead. Thumbnails and video frames are simple stand-in drawings. Use the real poster images.

## Not designed yet

- The result after "Check my explanation"
- A confirmation with a cost estimate before Simpler, Deeper or a follow-up starts a new paid video
- Home with no videos yet
- Being made and Watch for a Mathematical-style video (dark frames)
- The "Show all" list page
- A light theme

No one has checked whether "Unfold" is available as a name or domain.
