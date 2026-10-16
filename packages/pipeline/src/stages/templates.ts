/**
 * What the planner is told when it fills a motion template for the Illustrated
 * style. A designer built the templates (packages/render/src/motion); the
 * model only chooses one and fills in words, icons, numbers and cues.
 */
import { ICON_NAMES } from "@explainer/schemas";

const ICONS = ICON_NAMES.join(", ");

const CUES = `cue: the exact word (or two adjacent words) from the narration on which the thing appears; copy it from the narration, so each thing lands as it is said, in order. Labels are short and plain, never sentences. Use only what the narration says: no numbers, names or steps it does not contain.`;

export const MOTION_PLAN_RULES = `You plan one scene of a flat-illustration explainer as motion graphics, by choosing a template and filling it in. The templates are designed already; you choose the words, icons, numbers and when each thing appears. Pick the template that fits what the narration is doing:
- steps: things that happen in order (a process, a chain of cause and effect), or a cycle (cycle: true when it loops). 2–5 steps; each a label of at most 3 words, an icon, and optionally a sub-line (a date, a qualifier).
- compare: two or three things side by side. Give each a value and unit when the narration compares quantities (the bars then show the difference); otherwise a short note. A verdict line (at most 7 words) lands at the end on its cue, or null.
- count: one number that matters: value, unit (%, km, times, years…), and a label (at most 6 words) saying what it is. outOf when it is a share of something (71 out of 100, 1 out of 8), else null. A comparison (at most 9 words, with an icon) that makes the number mean something, or null.
- split: two sides, left and right: a myth and the fact, before and after, what people think and what happens. Each side has a heading (at most 2 words, like Myth and Fact), a line (at most 12 words) and an optional icon. winner is the side that is true (neither for before/after).
Icons, by name only: ${ICONS}.
${CUES}
One template, one idea: what the narration spends its words on.
hedraPrompt: the illustration shown beside the template, of the scene's subject (the thing the narration is about, drawn as a real thing: a person, a place, an object, a creature; never a diagram, chart or icons). Start with "Flat vector illustration, detailed." Describe one subject, large, centred, with two supporting details, in a portrait composition. End with "No text, no labels."`;

export const CHART_PLAN_RULES = `You turn one scene of an explainer into a bar chart. series: 2–5 bars from the numbers the narration states, in the same unit, labels of at most 3 words, each with the narration word it appears on. title: at most 6 words, or null. unit: short (%, km, ×), or null. claimId: the claim the numbers come from. ${CUES}`;

export const POINTS_PLAN_RULES = `You turn one scene of an explainer into key points on screen: 1–5 lines of at most 8 words, in the narration's order, each with the narration word it appears on and an optional icon (names: ${ICONS}). title: at most 6 words, or null. ${CUES}`;

/** Prompt rules for a Hedra picture, shared by every scene that has one. */
export function pictureRules(styleText: string, backgroundHex: string): string {
  return `You write generation prompts for an explainer in a fixed house style.
House style: ${styleText}
Background colour: ${backgroundHex}.
Rules for hedraPrompt:
- Start with "Flat vector illustration, detailed." Then the scene's metaphor and its supporting details from the visual direction. End with "No text, no labels. Leave the bottom-right quarter clear."
- Describe one action for a clip; still-animated prompts describe the still only.
- Never ask for legible text; labels are composited.
- Real things in a real scene, never a diagram: no flowcharts, empty boxes, nodes, arrows or mind maps. If the direction is abstract (a model, a process, data), draw the concrete metaphor it names.
- Recurring things (when listed) are described the same way in every prompt, so they're recognisable from scene to scene.`;
}

export const DIAGRAM_CALLOUT_RULES = `callouts: the 1–6 parts of the picture the narration names, in the order they are named: each a label of at most 3 words (use the on-screen terms where they fit) and its cue word. Only parts that will actually be visible in the picture you asked for; they are located in the picture afterwards and pointed at as they are mentioned. ${CUES}`;
