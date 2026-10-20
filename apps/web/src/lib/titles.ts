/** Titles and labels shared by the pages. */

const QUESTION = /^(what|why|how|who|whom|whose|when|where|which|is|are|was|were|do|does|did|can|could|should|would|will)\b/i;

/**
 * The title to show for a project: the one the intake stage wrote, or the raw
 * question tidied up (first letter up, whitespace collapsed, a question mark on
 * a question). Older projects have no written title.
 */
export function cleanTitle(question: string, title?: string | null): string {
  if (title?.trim()) return title.trim();
  let q = question.trim().replace(/\s+/g, " ").replace(/^["'\u201c\u201d\u2018\u2019]+|["'\u201c\u201d\u2018\u2019]+$/g, "").trim();
  if (!q) return "Untitled";
  q = q.charAt(0).toUpperCase() + q.slice(1);
  q = q.replace(/[.\s]+$/, "");
  if (QUESTION.test(q) && !/[?!]$/.test(q)) q += "?";
  return q;
}

/** The style's name for people. "math" is Manim on black; no creator's name. */
export const styleLabel = (style: string | null | undefined): string => (style === "math" ? "Mathematical" : "Illustrated");

/** m:ss */
export const clock = (s: number): string => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** Source titles as scraped often start with a chapter number ("14  Backpropagation – …"). */
export function cleanSourceTitle(title: string | null | undefined): string {
  const t = (title ?? "").replace(/^\s*\d+(\.\d+)*\s+/, "").replace(/\s+/g, " ").trim();
  return t || "Untitled page";
}
