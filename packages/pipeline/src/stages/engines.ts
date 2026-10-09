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

LAYOUT
- Frame: x from -7.1 to 7.1, y from -4 to 4, origin at the centre. Keep everything within x ∈ [-6.6, 6.6], y ∈ [-2.2, 3.6]; the bottom strip is reserved for captions.
- Position with to_edge / to_corner / next_to(..., buff=0.3) / arrange(..., buff=0.4) / move_to. Never overlap text. Prefer font_size 32–48 for Text and ≤ 72 for MathTex; scale down rather than overflow.

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

/**
 * Flat-style motion graphics: the illustrated look, built on screen as it's
 * explained. With `parts`, the code animates callouts over the scene's still.
 */
export function motionRules(background: "dark" | "light", parts?: StillPart[]): string {
  const h = HOUSE[background];
  const overlay = parts
    ? `
OVERLAY MODE: the scene's illustration already fills the frame underneath your code (and zooms slowly with it). Animate ON TOP of it so the picture comes alive as it's explained. Its parts, as pixel boxes [x0, y0, x1, y1]:
${parts.map((p) => `- ${p.name}: [${p.box.join(", ")}]`).join("\n")}
Point at the right part when its words are spoken: a ring or rounded highlight that draws itself around it, an arrow that draws on from a label pill to it, a spotlight that dims everything else (a full-frame rgba(27,34,53,0.45) path with the part cut out, fillRule="evenodd"), motion lines or small particles showing flow between parts, numbered tags 1-2-3 for a sequence. Never cover the illustration with opaque shapes; use strokes and translucent fills. Put label pills in empty areas, not on top of parts.`
    : `
The ${h.bg} background is already painted. Use the whole frame: the main subject large and clear, supporting details around it.`;
  return `You write a 2D motion-graphics scene (React + SVG) for one scene of a flat-illustration explainer video. It is rendered frame by frame with Remotion at 1920×1080, 30 fps.

OUTPUT: a TSX module \`export default function Scene()\` returning JSX. Return only the code: no explanations, no markdown fences.

IMPORTS: only from "react", "remotion" (useCurrentFrame, useVideoConfig, interpolate, spring, Easing, random, AbsoluteFill, Sequence), "@remotion/shapes" (components Rect, Circle, Ellipse, Triangle, Star, Pie, Polygon, Arrow, Callout, and make* functions returning SVG paths) and "@remotion/paths" (evolvePath(progress, d) → { strokeDasharray, strokeDashoffset } to draw a path on; getLength, getPointAtLength, interpolatePath). No images, fonts, network, fetch or Math.random (use random("seed")).

ANIMATION: build it on screen like 3Blue1Brown, in sync with the narration.
- const frame = useCurrentFrame(); const { fps } = useVideoConfig(); timeline times are seconds; frame = seconds × 30. The scene lasts {DURATION} s ({FRAMES} frames).
- Things appear when they are mentioned: pop in with spring({ frame: frame - start, fps, config: { damping: 14 } }) on scale and opacity; lines, arrows and outlines draw themselves with evolvePath; objects travel along paths (getPointAtLength); values count up with interpolate; shapes morph (interpolatePath); the thing being talked about is highlighted (pulse, ring, colour change, spotlight).
- Keep something moving in every second; no long static holds. Clamp interpolations (extrapolateLeft/Right: "clamp").
- Draw in one <svg viewBox="0 0 1920 1080" width="100%" height="100%">; stroke widths 6–10 with round caps and joins.

LOOK (flat house style): flat shapes, no gradients except a soft glow; palette ink ${h.ink}, accents #F2C14E (yellow), #8FB8E8 (blue), #E4573D (red), #5FA36B (green); rounded corners; generous negative space; simple iconic objects built from primitives, recognisable at a glance.
- Labels: ≤ 4 words, 36–52 px, fontWeight 600–700, in ink or on an accent pill. Never write sentences or the narration (captions are added separately).
- Keep inside x ∈ [80, 1840], y ∈ [80, 1000], and keep the caption area clear: nothing important at x > 1000 and y > 780.${overlay}`;
}
