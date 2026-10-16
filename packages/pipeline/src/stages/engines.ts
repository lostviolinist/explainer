/**
 * Instructions for AI-written scene code (the 3Blue1Brown style). The Manim
 * rules distil the ManimCE best practices from github.com/adithya-s-k/manim_skill
 * (MIT) to what makes generated code fail or look wrong; the three.js rules keep
 * scenes renderable in the sandbox (Remotion's frame clock, no network, allowed
 * imports only). The Illustrated style writes no code: see templates.ts.
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
