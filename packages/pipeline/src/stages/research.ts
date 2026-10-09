/**
 * Stage 2 — Research. Search → open pages → extract claims with quotes →
 * corroborate → misconceptions → analogies. Sets the brief's length from the
 * needed-claim count.
 *
 * Guardrails: numbers must come from an opened page; pages that fail to open
 * are dropped; contested claims are excluded or scripted as disagreement;
 * a claim supported only by low-reputation pages is treated as single-sourced.
 */
import { z } from "zod";
import { ResearchBrief, Claim, lengthFromClaims, sceneBudget, type Brief } from "@explainer/schemas";
import type { Ctx } from "../context.js";
import { makeProgress, maxVideoSeconds } from "../context.js";
import { domainReputation } from "../providers/search.js";

export const Queries = z.object({ queries: z.array(z.string()).min(3).max(6) });

export const Extracted = z.object({
  claims: z.array(
    z.object({
      text: z.string(),
      type: Claim.shape.type,
      fit: Claim.shape.fit,
      quote: z.string(),
    }),
  ),
});

export const Merged = z.object({
  claims: z.array(
    z.object({
      id: Claim.shape.id,
      text: z.string(),
      type: Claim.shape.type,
      fit: Claim.shape.fit,
      /** indexes into the per-page evidence list */
      evidence: z.array(z.number().int()),
      contested: z.boolean(),
    }),
  ),
  misconceptions: z.array(z.object({ belief: z.string(), correctsWith: z.array(z.string()) })),
  analogies: z.array(z.object({ text: z.string(), breaksDown: z.string(), explains: z.array(z.string()) })),
});

export async function research(ctx: Ctx, brief: Brief): Promise<{ research: ResearchBrief; brief: Brief }> {
  const progress = makeProgress(ctx, brief.projectId, "research");
  await progress("working out what to look up", 0.05);

  const { queries } = await ctx.llm.json({
    system: "Write 3–6 web search queries that together would let a careful explainer answer the learning goal, including one query aimed at common misconceptions about the topic.",
    user: `Topic: ${brief.topic}\nLearning goal: ${brief.learningGoal}\nLevel: ${brief.level}`,
    schema: Queries,
    maxTokens: 600,
  });

  const hits = (await Promise.all(queries.map((q) => ctx.search.search(q, 6)))).flat();
  const seen = new Set<string>();
  const unique = hits.filter((h) => (seen.has(h.url) ? false : (seen.add(h.url), true)));
  // Rank by reputation, keep the top 14 to open.
  const ranked = unique.sort((a, b) => domainReputation(b.url) - domainReputation(a.url)).slice(0, 14);

  await progress(`reading ${ranked.length} sources`, 0.2);
  const pages = (await Promise.all(ranked.map((h) => ctx.search.open(h.url)))).filter(
    (p): p is NonNullable<typeof p> => p !== null && p.text.length > 500,
  );

  if (pages.length === 0) throw new Error(`no sources could be opened for "${brief.topic}" (${ranked.length} search results)`);

  // Extract claims per page, with a verbatim quote each. A few pages at a time;
  // a page the model can't extract from is skipped rather than failing research.
  type Evidence = { url: string; quote: string; reputation: number; pageIdx: number };
  const evidence: Evidence[] = [];
  const perPage: { url: string; claims: z.infer<typeof Extracted>["claims"] }[] = [];
  let done = 0;
  const extract = async (p: (typeof pages)[number]) => {
    try {
      const ex = await ctx.llm.json({
        system: `Extract the claims from this page that matter for the learning goal. Each claim must be supported by a verbatim quote from the page (≤ 240 chars). Mark fit: "needed" if the goal can't be met without it, "nice" if it helps, "advanced" if it goes beyond the stated level. Numbers only if they appear on the page.`,
        user: `Learning goal: ${brief.learningGoal}\nLevel: ${brief.level}\n\nPAGE (${p.url}):\n${p.text.slice(0, 24_000)}`,
        schema: Extracted,
        maxTokens: 3000,
      });
      perPage.push({ url: p.url, claims: ex.claims });
      const n = ++done;
      // Shown live on the progress page: the source being read and a fact from it.
      const fact = ex.claims.find((c) => c.fit === "needed")?.text ?? ex.claims[0]?.text;
      const source = { url: p.url, title: p.title, domain: new URL(p.url).hostname.replace(/^www\./, "") };
      await progress(`reading ${n} of ${pages.length} sources`, 0.2 + 0.4 * (n / pages.length), { source, ...(fact ? { fact } : {}) });
    } catch (e) {
      // Only a bad answer about this page is skippable; API errors (quota, auth, outage) fail the step.
      if (!(e instanceof z.ZodError || e instanceof SyntaxError || /^LLM response incomplete/.test((e as Error).message))) throw e;
      console.warn(`[research] skipped ${p.url}: ${(e as Error).message.slice(0, 200)}`);
      done++;
    }
  };
  for (let i = 0; i < pages.length; i += 4) await Promise.all(pages.slice(i, i + 4).map(extract));
  if (perPage.every((pp) => pp.claims.length === 0)) throw new Error(`no claims could be extracted from ${pages.length} sources`);
  perPage.forEach((pp, pageIdx) =>
    pp.claims.forEach((c) => evidence.push({ url: pp.url, quote: c.quote, reputation: domainReputation(pp.url), pageIdx })),
  );

  await progress("checking which claims agree", 0.65);
  const merged = await ctx.llm.json({
    system: `Merge overlapping claims from several pages into one claim list. For each merged claim list the evidence indexes that support it. Mark "contested": true when sources disagree. Then list 1–3 common misconceptions a learner at this level holds, each with the claim ids that correct it, and 1–3 analogies with the claim ids each explains and one sentence on where the analogy breaks down. Claim ids are c1, c2, …`,
    user: evidence.map((e, i) => `[${i}] (${e.url}) ${e.quote}`).join("\n") + `\n\nCandidate claims:\n` +
      perPage.flatMap((pp) => pp.claims.map((c) => `- (${c.type}/${c.fit}) ${c.text}`)).join("\n"),
    schema: Merged,
    maxTokens: 6000,
  });

  const claims = merged.claims.map((c) => {
    const ev = c.evidence.map((i) => evidence[i]).filter((e): e is Evidence => Boolean(e));
    const strong = ev.filter((e) => e.reputation >= 0.6);
    const distinctPages = new Set(strong.map((e) => e.pageIdx)).size;
    const confidence: Claim["confidence"] = c.contested ? "contested" : distinctPages >= 2 ? "corroborated" : "single";
    return Claim.parse({
      id: c.id,
      text: c.text,
      type: c.type,
      confidence,
      fit: c.fit,
      sources: ev.map((e) => ({ url: e.url, quote: e.quote })),
    });
  });

  const neededClaimCount = claims.filter((c) => c.fit === "needed" && c.confidence !== "contested").length;
  // Deep topics would run longer; the cap condenses them (the script stage drops the extras).
  const fullS = lengthFromClaims(neededClaimCount);
  const lengthS = Math.min(fullS, maxVideoSeconds());
  const budget = sceneBudget(lengthS, ctx.style.voice.wordsPerMinute);

  const researchBrief = ResearchBrief.parse({
    projectId: brief.projectId,
    claims,
    misconceptions: merged.misconceptions,
    analogies: merged.analogies,
    sources: pages.map((p) => ({
      url: p.url,
      title: p.title,
      domain: new URL(p.url).hostname.replace(/^www\./, ""),
      reputation: domainReputation(p.url),
      openedAt: ctx.now(),
    })),
    neededClaimCount,
  });

  const updatedBrief: Brief = { ...brief, lengthS, wordBudget: budget.wordBudget, sceneRange: budget.sceneRange };
  await ctx.store.saveResearch(researchBrief);
  await ctx.store.saveBrief(updatedBrief);
  const minutes = `${+(lengthS / 60).toFixed(1)}-minute`;
  await progress(fullS > lengthS ? `found ${claims.length} claims, condensing them into a ${minutes} video` : `found ${claims.length} claims, planning a ${minutes} video`, 1);
  return { research: researchBrief, brief: updatedBrief };
}
