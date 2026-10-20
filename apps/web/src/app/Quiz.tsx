"use client";

import { useState, useTransition } from "react";
import { explainBack } from "./actions";

export type QuizItem = { statement: string; answer: "myth" | "fact"; explanation: string };

/** Myth or fact, as the Being-made page shows it: a statement, two buttons, then one verdict line with the explanation. */
export function MythOrFact({ items }: { items: QuizItem[] }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<"myth" | "fact" | null>(null);
  const q = items[i % items.length]!;
  const right = picked === q.answer;
  return (
    <div className="mof">
      <p className="eyebrow">Myth or fact?</p>
      <p className="mof-statement">“{q.statement}”</p>
      <div className="mof-actions">
        <button type="button" aria-pressed={picked === "myth"} onClick={() => !picked && setPicked("myth")}>Myth</button>
        <button type="button" aria-pressed={picked === "fact"} onClick={() => !picked && setPicked("fact")}>Fact</button>
      </div>
      {picked && (
        <>
          <p className="mof-verdict appear">
            <strong className={right ? "right" : "wrong"}>{right ? "Right, it's a " : "Not quite: it's a "}{q.answer}.</strong> {q.explanation}
          </p>
          {items.length > 1 && (
            <button type="button" className="btn-quiet mof-next" onClick={() => { setPicked(null); setI((x) => x + 1); }}>Next one</button>
          )}
        </>
      )}
    </div>
  );
}

type Graded = Awaited<ReturnType<typeof explainBack>>;

const VerdictIcon = ({ className }: { className: string }) => (
  <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.5 2.5L16 9.5" /></svg>
);

/**
 * Watching isn't learning. After the video: the quiz, then the real test,
 * explaining it back in your own words, read by a kind tutor who says what
 * landed and what to watch again.
 */
export function AfterVideo({ projectId, quiz, question }: { projectId: string; quiz: QuizItem[]; question: string }) {
  return (
    <section className="wt-land" aria-labelledby="land-h">
      <div className="wt-land-head">
        <h2 id="land-h">Did it land?</h2>
        <p>Watching isn't learning. Two minutes of this is.</p>
      </div>
      <div className="wt-cards">
        {quiz.length > 0 && <MythCard items={quiz} n={1} />}
        <ExplainCard projectId={projectId} question={question} n={quiz.length ? 2 : 1} />
      </div>
    </section>
  );
}

function MythCard({ items, n }: { items: QuizItem[]; n: number }) {
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<"myth" | "fact" | null>(null);
  const q = items[i % items.length]!;
  const right = picked === q.answer;
  return (
    <div className="wt-card">
      <div className="wt-card-label"><span className="mono num">{n}</span>Myth or fact?</div>
      <div className="wt-myth">
        <p className="statement">“{q.statement}”</p>
        <div className="picks">
          <button type="button" aria-pressed={picked === "myth"} onClick={() => !picked && setPicked("myth")}>Myth</button>
          <button type="button" aria-pressed={picked === "fact"} onClick={() => !picked && setPicked("fact")}>Fact</button>
        </div>
      </div>
      {picked && (
        <div className="wt-verdict appear">
          <VerdictIcon className={right ? "right" : "wrong"} />
          <p>
            <strong className={right ? "right" : "wrong"}>{right ? "Right, it's a " : "Not quite: it's a "}{q.answer}.</strong> {q.explanation}
            {items.length > 1 && <button type="button" className="wt-link" onClick={() => { setPicked(null); setI((x) => x + 1); }}>Next one</button>}
          </p>
        </div>
      )}
    </div>
  );
}

function ExplainCard({ projectId, question, n }: { projectId: string; question: string; n: number }) {
  const [text, setText] = useState("");
  const [graded, setGraded] = useState<Graded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ready = text.trim().length >= 15;
  const submit = () => {
    if (!ready || pending) return;
    setError(null);
    start(async () => {
      try {
        setGraded(await explainBack(projectId, text));
      } catch (e) {
        setError((e as Error).message || "Couldn't read that right now.");
      }
    });
  };
  const tone = graded?.verdict === "got it" ? "right" : graded?.verdict === "nearly" ? "wrong" : "off";
  return (
    <div className="wt-card">
      <div className="wt-card-label"><span className="mono num">{n}</span>In your own words</div>
      <label htmlFor="expl" className="wt-prompt">{question} Explain it as if to a friend.</label>
      {!graded ? (
        <>
          <textarea id="expl" value={text} onChange={(e) => setText(e.target.value)} maxLength={600} rows={4} placeholder="It works because…" disabled={pending} />
          <div className="wt-check">
            <span className="hint">{error ?? (ready ? "Ready when you are." : "Write a sentence or two, then check it.")}</span>
            <button type="button" className="wt-check-btn" onClick={submit} disabled={!ready || pending} aria-busy={pending}>
              {pending ? <><span className="spin" aria-hidden="true" /> Reading…</> : "Check my explanation"}
            </button>
          </div>
        </>
      ) : (
        <div className={`wt-verdict appear ${tone}`}>
          <VerdictIcon className={tone} />
          <div>
            <p>
              <strong className={tone}>{graded.verdict === "got it" ? "You've got it." : graded.verdict === "nearly" ? "Nearly." : "Not yet."}</strong> {graded.feedback}
            </p>
            {graded.missing.length > 0 && (
              <ul className="missing">
                {graded.missing.map((m) => <li key={m}>{m}</li>)}
              </ul>
            )}
            <button type="button" className="wt-link" onClick={() => setGraded(null)}>Try again</button>
          </div>
        </div>
      )}
    </div>
  );
}
