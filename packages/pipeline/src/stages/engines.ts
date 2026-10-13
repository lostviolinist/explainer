/**
 * Instructions for AI-written scene code. The Manim rules distil the ManimCE
 * best practices from github.com/adithya-s-k/manim_skill (MIT) to what makes
 * generated code fail or look wrong; the three.js rules keep scenes renderable
 * in the sandbox (Remotion's frame clock, no network, allowed imports only).
 */
import type { VideoStyle } from "@explainer/schemas";

export const MANIM_RULES = `You write Manim Community Edition code for one scene of a 3Blue1Brown-style animated explainer.

OUTPUT: Python that defines \`class GeneratedScene(Scene):\` (or MovingCameraScene / ThreeDScene) with a \`construct(self)\` method. \`from manim import *\` is already done; import nothing else. No files, images, SVGs, sounds, network or randomness without a fixed seed.

TIMING
- The scene lasts {DURATION} seconds. The run_time of every self.play plus every self.wait should add up to about {BUDGET} s. Shorter is padded with a pause; longer is cut off.
- Cue each visual to when its words are spoken (timeline below). Use self.wait(x) between cues.
- run_time 0.5–3 s per self.play, as a keyword on self.play: self.play(..., run_time=2). rate_func=smooth (no parentheses).

LOOK (3Blue1Brown)
- Black background (already set). Light text (WHITE, GREY_A); accents BLUE (#58C4DD), YELLOW, TEAL, GREEN, GOLD, RED. One idea on screen at a time, generous spacing.
- Build up step by step: Create / Write / FadeIn / GrowArrow; move between steps with TransformMatchingTex (equations) or ReplacementTransform (swapping objects); point with Indicate / Circumscribe / SurroundingRectangle; FadeOut what is no longer needed.
- No captions or subtitles; never write the narration on screen (captions are added separately). Short labels (≤ 4 words) and equations are welcome.

ENGAGEMENT (what keeps people watching)
- Show before you name: the object appears (Create / GrowFromCenter / FadeIn with shift), then its label a beat later.
- Something changes every 1–2 s while the narration runs; never hold a static frame for more than 2 s.
- When a thing is spoken, it reacts: Indicate, Flash, a colour change, or a brief 10% grow-and-back.
- Zoom when detail matters: use MovingCameraScene and self.play(self.camera.frame.animate.scale(0.6).move_to(obj)), then zoom back out.
- Transform the previous idea into the next (ReplacementTransform, TransformMatchingTex) rather than fading everything out and starting from blank.
- Comparisons side by side (VGroup(...).arrange(RIGHT, buff=1)); quantities as bars that grow or a DecimalNumber counting up (ValueTracker).
- End on the scene's key object alone, centred, with nothing else competing.

LAYOUT
- Frame: x from -7.1 to 7.1, y from -4 to 4, origin at the centre. Keep everything within x ∈ [-6.6, 6.6], y ∈ [-2.2, 3.6]; the bottom strip is reserved for captions.
- Position with to_edge / to_corner / next_to(..., buff=0.3) / arrange(..., buff=0.4) / move_to. Never overlap text. Prefer font_size 32–48 for Text and ≤ 72 for MathTex; scale down rather than overflow.
- Text in a box: SurroundingRectangle(text, buff=0.2, corner_radius=0.15) or BackgroundRectangle(text); never a Rectangle(width=...) with a guessed width, which the text spills out of.
- Check every object stays inside the frame after it moves; if a group is wide, group.scale_to_fit_width(12).

API RULES (the common mistakes)
- MathTex(r"...") is already math mode: no $...$ inside. Tex(r"...") is text; math inside it needs $...$. Always raw strings for LaTeX. Standard LaTeX only (amsmath, amssymb); no \\usepackage.
- To colour or animate parts of an equation, pass parts separately: MathTex("E", "=", "m", "c^2"); then eq[3].set_color(YELLOW). Don't index single characters.
- Transform(A, B) leaves A on screen looking like B (B is never added); ReplacementTransform(A, B) puts B on screen. Use the live variable afterwards.
- Axes(x_range=[min, max, step], y_range=[...], x_length=..., y_length=...), axes.plot(lambda x: ..., color=...), points with axes.c2p(x, y), labels with axes.get_x_axis_label(...). Few tick numbers.
- Continuous change: ValueTracker + always_redraw or add_updater; animate with self.play(tracker.animate.set_value(v), run_time=...); clear_updaters() when done. Never "tracker += 1" to animate.
- Text(...) for words (no LaTeX). Never MathTex for sentences.
- ThreeDScene only if 3D is essential; then self.set_camera_orientation(phi=..., theta=...).
- Manim Community names only (from manim import *), not manimlib / ManimGL.
- Return only the code: no explanations, no markdown fences.`;

const PALETTES: Record<"math" | "dark" | "light", string> = {
  math: "black background; glowing accents: #58C4DD (blue), #FFFF66 (yellow), #83C167 (green), #FC6255 (red), #F0AC5F (gold); emissive or basic materials so colours read on black",
  dark: "deep navy background; flat toon look with meshToonMaterial; accents #F2C14E, #8FB8E8, #E4573D, #5FA36B; soft light",
  light: "warm off-white background; flat toon look with meshToonMaterial; ink #1B2235 and accents #F2C14E, #8FB8E8, #E4573D, #5FA36B; soft light, no harsh shadows",
};

export function threeRules(style: VideoStyle, background: "dark" | "light"): string {
  const palette = PALETTES[style === "math" ? "math" : background];
  return `You write a React Three Fiber scene (three.js) for one scene of an animated explainer. It is rendered frame by frame with Remotion.

OUTPUT: a TypeScript/TSX module with \`export default function Scene()\` that returns R3F elements (<mesh>, <group>, <instancedMesh>, lights, <line>...). It is rendered inside a <ThreeCanvas> with the camera at [0, 0, 8], fov 45, and the background already set. Return only the code: no explanations, no markdown fences.

IMPORTS: only from "react", "three", "@react-three/fiber" and "remotion". No drei, no loaders, textures, fonts, 3D text, images, network, fetch or dynamic imports.

ANIMATION
- Drive everything from Remotion's clock: const frame = useCurrentFrame(); const { fps, durationInFrames } = useVideoConfig(); use interpolate(frame, [a, b], [x, y], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) and spring({ frame, fps }) from "remotion".
- Never useFrame, clocks, Date, setTimeout or Math.random (use random("seed") from "remotion" for deterministic variety).
- The scene lasts {DURATION} s ({FRAMES} frames at 30 fps). Cue each change to when its words are spoken (timeline below, in seconds; frame = seconds × 30).
- Move the camera slowly if it helps: const camera = useThree((s) => s.camera); camera.position.set(...); camera.lookAt(0, 0, 0).

LOOK
- ${palette}.
- One clear subject; 1–3 main objects plus supporting detail. Keep everything in view (roughly x ∈ [-5, 5], y ∈ [-2, 2.8] at z = 0), and keep the bottom strip of the frame clear for captions.
- No text or labels in 3D (labels are added separately).
- Keep people watching: the subject appears first (scales up from nothing), something moves every second, the thing being spoken reacts at its cue (a pulse, a glow, a colour shift), the camera pushes in at the key moment and settles on the subject at the end.
- Keep it light enough to render on a CPU: ≤ 50 meshes, ≤ 64 segments per geometry, instancedMesh for many particles (≤ 2000).`;
}

/** "Sentence (at 3.2 s)" lines, so code can cue visuals to the narration. */
export function narrationTimeline(narration: string, words: { start: number }[]): string {
  const tokens = narration.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let startIdx = 0;
  tokens.forEach((tok, i) => {
    if (/[.!?]["')\]]?$/.test(tok) || i === tokens.length - 1) {
      const at = words[startIdx]?.start ?? 0;
      lines.push(`[${at.toFixed(1)} s] ${tokens.slice(startIdx, i + 1).join(" ")}`);
      startIdx = i + 1;
    }
  });
  return lines.join("\n");
}

/** Models sometimes wrap code in markdown fences even when asked not to. */
export function stripFences(code: string): string {
  return code.replace(/^\s*```[a-zA-Z]*\s*\n/, "").replace(/\n?```\s*$/, "").trim();
}

/** A plain, always-renderable Manim scene: the scene's key line, written out, and its terms. */
export function fallbackManim(narration: string, terms: string[]): string {
  const first = narration.split(/(?<=[.!?])\s/)[0] ?? narration;
  const words = first.split(/\s+/);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines.at(-1);
    if (last && (last + " " + w).length <= 34) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  const title = JSON.stringify(lines.slice(0, 4).join("\n"));
  const items = JSON.stringify(terms.slice(0, 4));
  return `class GeneratedScene(Scene):
    def construct(self):
        title = Text(${title}, font_size=44, color=WHITE, line_spacing=1.1)
        title.move_to(UP * 1.2)
        self.play(Write(title), run_time=2)
        terms = [t for t in ${items} if t.strip()]
        if terms:
            group = VGroup(*[Text(t, font_size=34, color=BLUE) for t in terms]).arrange(RIGHT, buff=0.6)
            group.next_to(title, DOWN, buff=0.8)
            if group.width > 12:
                group.scale_to_fit_width(12)
            self.play(LaggedStart(*[FadeIn(t, shift=UP * 0.2) for t in group], lag_ratio=0.3), run_time=2)
        self.play(Circumscribe(title, color=YELLOW), run_time=1.5)
`;
}

/** A part of a still the overlay can point at, in pixels of the 1920×1080 frame. */
export type StillPart = { name: string; box: [number, number, number, number] };

const HOUSE = {
  light: { bg: "warm off-white #F6F3EC", ink: "#1B2235" },
  dark: { bg: "deep navy #0B1C3F", ink: "#F6F3EC" },
};

/** Before the code: the shots, cue by cue. Shot lists make the code build the scene instead of showing it. */
export const SHOT_LIST_RULES = `You direct one scene of a flat-illustration explainer (2D motion graphics, 1920×1080). Before the code is written, decide what the scene IS and plan the shots.

FIRST, the one reading. subject: the single thing this scene is about (one noun phrase). glance: what a first-time viewer sees and understands in the first second, in at most 8 words ("a ray bouncing off tiny beads into an eye"). If you can't say it in 8 words, the scene is too complicated; simplify until you can.

THEN the shots: 4–8. Each names its moment (seconds from the scene start, matching the narration timeline), what enters / moves / transforms / reacts / leaves, where (left, centre, right, top), and which recurring cast member it is.

RULES OF CLARITY (these matter more than completeness)
- One idea per scene. Show only what the narration is saying right now; never the whole system, architecture or history at once.
- Draw things, not diagrams of things: a word is a word card, a person is a person, light is a moving dot, heat is a glow. Boxes-and-arrows only when the narration itself is about boxes and arrows.
- At most one subject and two or three supporting things on screen at any moment; labels only for what the narration names (≤ 4 words each).
- A shot can be an emphasis or a camera move rather than a new object; prefer that to adding things.
- Show before you name. Build on what is on screen; what is no longer talked about leaves.
- The subject of the sentence being spoken is the thing that moves; everything else holds or dims.
- One or two camera moves at most. End on the key object alone. Keep the bottom-right caption box empty.
Short, concrete actions, no prose.`;

const KIT_ICONS = "sun, moon, eye, molecule, leaf, person, people, cloud, gear, clock, drop, star, box, heart, bulb, earth, bolt, arrow, check, cross, question, flask, wave, mountain, book, house, tree, brain, rocket, magnet, battery, thermometer, magnifier, coin, dna";

/**
 * Flat-style motion graphics on the kit (packages/render/src/animator/kit):
 * the model directs what enters, moves and leaves, and when; the kit does the
 * easing, the draw-on, the camera and the exits. With `parts`, the code
 * animates callouts over the scene's still.
 */
export function motionRules(background: "dark" | "light", parts?: StillPart[]): string {
  const h = HOUSE[background];
  const overlay = parts
    ? `

OVERLAY MODE: the scene's illustration is already painted under your drawing (the Stage draws it and the camera moves it together with your callouts). Its parts, as pixel boxes [x0, y0, x1, y1]:
${parts.map((p) => `- ${p.name}: [${p.box.join(", ")}]`).join("\n")}
Animate on top, so the picture comes alive as it's explained: <Circumscribe> a part when its words are spoken; <Connect> from a <Label> in an empty area to it; <Highlight> it so the rest dims; <Dots> for flow between parts; 1-2-3 Labels for a sequence; a camera key (zoom ≈ 1.4 onto the part being discussed, then back to 1) is welcome. Never cover the illustration with opaque shapes; strokes and translucent fills only.`
    : `

The ${h.bg} background is already painted. Use the whole frame: the main subject large and clear, supporting details around it.`;
  return `You write one scene of a flat-illustration explainer as a React motion-graphics module, rendered frame by frame with Remotion at 1920×1080, 30 fps. The toolkit "./Kit" does for flat scenes what Manim does for 3Blue1Brown scenes: you say what appears, moves and leaves, and when; the kit does the easing, the draw-on, the camera and the exits.

OUTPUT: a TSX module \`export default function Scene()\` whose root element is <Stage>. Return only the code: no explanations, no markdown fences. Times are seconds from the start of the scene; the scene lasts {DURATION} s ({FRAMES} frames).

IMPORTS: only from "./Kit", "react", "remotion" and "@remotion/paths". No other modules, images, fonts, network, fetch or Math.random.

THE KIT (import what you use from "./Kit"):
- <Stage camera={[{ at, x, y, zoom, over }]}> the root. Camera keys move the view: zoom 1 shows the whole frame centred on (960, 540); to frame a subject, zoom ≈ 1.5 centred on it, over 2 s; return to zoom 1 before the end. <Fixed> keeps its children (titles, legends) still while the camera moves.
- Paths, in frame pixels: circle(cx, cy, r), ellipse(cx, cy, rx, ry), rect(x, y, w, h, r), line(x1, y1, x2, y2), arrow(x1, y1, x2, y2), curve(x1, y1, x2, y2, bow), polygon([[x, y], ...]).
- <Shape d fill stroke width at over until enter exit opacity /> one path on the timeline. enter: "draw" (default: the stroke draws on, then the fill arrives — Create / DrawBorderThenFill), "fade", "grow", "pop" (overshoot), "slide", "none". exit at \`until\`: "fade" (default), "shrink", "undraw".
- <Icon name x y size at over enter until fill stroke /> line icons: ${KIT_ICONS}. Give fill for a solid look.
- <Group x y origin at enter exit until> several shapes entering and leaving together (enter "fade" | "grow" | "pop" | "slide"; origin is the point it grows from).
- <Label x y anchor color ink size at until>text</Label> for ALL single labels: it sizes itself to its words (never draw a rect behind text; SVG <text> is rejected). anchor "start" | "middle" | "end"; color "none" for plain text (ink ${h.ink} on this background). ≤ 4 words, 36–52 px.
- <Row x y anchor items={["one", "two", ...]} gap at lag until emphasize={[{ index, at, until }]} /> a row of words or items as self-sizing pills laid out by the browser (they can never overlap or spill); items pop in one after another; emphasize lights one up while its words are spoken. <Column> is the same, stacked. Never place a list of pills by hand.
- <Move from to at over> or <Move path at over> moves its children (draw them at \`from\` / the path's start): .animate.shift / MoveAlongPath.
- <Transform from to at over fill stroke width /> one path becomes another from \`at\` (ReplacementTransform); show the first shape until then with <Shape d={from} until={at} exit="none" />.
- <Indicate at origin scale> a brief grow-and-back of its children; <Circumscribe x y w h at hold stroke /> a ring draws around a box, holds, undraws; <Flash x y at /> a burst; <Highlight x y w h at until /> dims everything but a box (spotlight).
- <Connect from to at over head bow /> a line or arrow draws on between two points; <Dots along count speed fill at until /> dots flowing along a path; <Bar x y w h value max fill at over />; <Counter from to at over x y suffix />.
- useT() the current second; prog(t, at, over, ease) 0→1 for anything custom; PALETTE.yellow/blue/red/green/ink.

HOW TO DIRECT IT (what makes a scene feel built, not shown)
- Clarity first: the scene must read as its "glance" line at first sight. At most ${14} drawn elements in the whole scene (a <Row> counts as one; more is rejected): one subject, a few supporting things, labels only for what the narration names. Draw things, not diagrams of things.
- Follow the shot list and the narration timeline: a thing enters within 0.3 s of its words; what is being talked about is the thing that moves.
- Show before you name: the shape enters (draw / grow), its Label pops about 0.4 s later.
- Build, don't cut: add to what is on screen; Transform one thing into the next; Move things instead of replacing them. Fade out (until) only what is no longer needed.
- Group related changes at the same \`at\`; unrelated ones in sequence. over 0.5–2 s. Use "pop" sparingly.
- The subject of each sentence reacts at its cue: Indicate / Circumscribe / Flash / a colour change, and the rest dims (Highlight).
- Camera: zoom to the detail when the narration goes into detail, back out for the whole; one or two moves per scene, never constant drifting.
- Comparisons side by side; quantities as Bars or Counters; sequences as 1-2-3 Labels lighting up in order; flow as Dots or a Move along a path.
- Something changes every 1–2 s. End on the key object alone, centred, camera back at zoom 1.

LOOK: flat shapes in the house palette (ink ${h.ink}, yellow #F2C14E, blue #8FB8E8, red #E4573D, green #5FA36B); rounded corners; strokes 6–10; generous space; the recurring cast drawn the same way every time (same colour for the same thing). Keep inside x ∈ [80, 1840], y ∈ [80, 1000]; nothing in the caption box (x > 1000 and y > 840); moving things stay inside the frame at every moment.${overlay}`;
}
