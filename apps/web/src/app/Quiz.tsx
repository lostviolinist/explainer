"use client";

import { useState, useTransition } from "react";
import { explainBack } from "./actions";

export type QuizItem = { statement: string; answer: "myth" | "fact"; explanation: string };

/** Myth or fact, built from the research: the misconceptions it found and its best-corroborated claims. */
export function MythQuiz({ items }: { items: QuizItem[] }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<"myth" | "fact" | null>(null);
  const [score, setScore] = useState({ right: 0, seen: 0 });
  const q = items[i % items.length]!;
  const pick = (a: "myth" | "fact") => {
    if (picked) return;
    setPicked(a);
    setScore((s) => ({ right: s.right + (a === q.answer ? 1 : 0), seen: s.seen + 1 }));
  };
  return (
    <section className="card quiz">
      <div className="eyebrow">
        Myth or fact? {score.seen > 0 && <span className="count">{score.right}/{score.seen}</span>}
      </div>
      <p className="statement">“{q.statement}”</p>
      {!picked ? (
        <div className="quiz-actions">
          <button type="button" className="btn ghost" onClick={() => pick("myth")}>Myth</button>
          <button type="button" className="btn ghost" onClick={() => pick("fact")}>Fact</button>
        </div>
      ) : (
        <div className={`verdict appear ${picked === q.answer ? "right" : "wrong"}`}>
          <strong>{picked === q.answer ? "Correct — " : "Not quite — "}it's a {q.answer}.</strong> {q.explanation}
          {items.length > 1 && (
            <button type="button" className="btn ghost small-btn" onClick={() => { setPicked(null); setI((x) => x + 1); }}>Next</button>
          )}
        </div>
      )}
    </section>
  );
}

type Graded = Awaited<ReturnType<typeof explainBack>>;

/**
 * Watching isn't learning. After the video: the quiz, then the real test,
 * explaining it back in your own words, read by a kind tutor who says what
 * landed and what to watch again.
 */
export function AfterVideo({ projectId, quiz, goal }: { projectId: string; quiz: QuizItem[]; goal: string }) {
  const [text, setText] = useState("");
  const [graded, setGraded] = useState<Graded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () => {
    setError(null);
    start(async () => {
      try {
        setGraded(await explainBack(projectId, text));
      } catch (e) {
        setError((e as Error).message || "Couldn't read that right now.");
      }
    });
  };
  return (
    <section className="after">
      <div className="section-head">
        <h2>Did it land?</h2>
        <span className="small">Watching isn't learning. Two minutes of this is.</span>
      </div>
      <div className="after-grid">
        {quiz.length > 0 && <MythQuiz items={quiz} />}
        <section className="card explain">
          <div className="eyebrow">In your own words</div>
          <p className="statement">{goal.replace(/^After watching,\s*the viewer can\s*/i, "Can you ")}{goal.endsWith("?") ? "" : "?"} Explain it as if to a friend.</p>
          {!graded ? (
            <>
              <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={600} rows={4} placeholder="It works because…" disabled={pending} />
              <div className="quiz-actions">
                <button type="button" className="btn primary small-btn" onClick={submit} disabled={pending || text.trim().length < 15} aria-busy={pending}>
                  {pending ? <><span className="spin" aria-hidden="true" /> Reading…</> : "Check my explanation"}
                </button>
              </div>
              {error && <p className="small">{error}</p>}
            </>
          ) : (
            <div className={`verdict appear ${graded.verdict === "got it" ? "right" : graded.verdict === "nearly" ? "nearly" : "wrong"}`}>
              <strong>{graded.verdict === "got it" ? "You've got it. " : graded.verdict === "nearly" ? "Nearly. " : "Not yet. "}</strong>
              {graded.feedback}
              {graded.missing.length > 0 && (
                <ul className="missing">
                  {graded.missing.map((m) => <li key={m}>{m}</li>)}
                </ul>
              )}
              <button type="button" className="btn ghost small-btn" onClick={() => setGraded(null)}>Try again</button>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
