"use client";

import { useCallback, useEffect, useState } from "react";
import { ask } from "./actions";

type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string; fix?: string };
type Style = "illustrated" | "math";

/** Must match MANIM_CHECK in lib/preflight.ts (kept out of this client bundle). */
const MANIM_CHECK = "3Blue1Brown animator";

const STYLES: { id: Style; name: string; blurb: string; icon: React.ReactNode }[] = [
  {
    id: "illustrated",
    name: "Illustrated",
    blurb: "Flat illustrations brought to life, with 3D where it helps",
    icon: (
      <svg viewBox="0 0 48 32" aria-hidden="true">
        <rect width="48" height="32" rx="6" fill="#F6F3EC" />
        <circle cx="34" cy="11" r="5" fill="#F2C14E" />
        <path d="M0 26 L14 14 L24 22 L32 16 L48 27 V32 H0 Z" fill="#5FA36B" />
        <path d="M0 29 L16 21 L30 30 Z" fill="#8FB8E8" />
      </svg>
    ),
  },
  {
    id: "math",
    name: "3Blue1Brown",
    blurb: "Equations, graphs and geometry, animated with Manim",
    icon: (
      <svg viewBox="0 0 48 32" aria-hidden="true">
        <rect width="48" height="32" rx="6" fill="#000" />
        <path d="M8 26 H42 M8 26 V5" stroke="#bbb" strokeWidth="1" />
        <path d="M9 7 C 16 20, 26 24, 41 25" stroke="#58C4DD" strokeWidth="2" fill="none" />
        <circle cx="20" cy="18.5" r="1.8" fill="#FFFF66" />
      </svg>
    ),
  },
];

/** The question box, gated on the setup check so a run can't fail on a missing key or credits. */
export function AskForm() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((refresh: boolean) => {
    setChecks(null);
    setError(null);
    fetch(`/api/preflight${refresh ? "?refresh" : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`setup check returned ${r.status}`))))
      .then((d: { checks: Check[] }) => setChecks(d.checks))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => load(false), [load]);

  const [style, setStyle] = useState<Style>("illustrated");
  const problems = checks?.filter((c) => c.status !== "ok") ?? [];
  const blocked = !checks || checks.some((c) => c.status === "fail");
  const mathReady = checks?.find((c) => c.name === MANIM_CHECK)?.status === "ok";
  useEffect(() => {
    if (checks && !mathReady && style === "math") setStyle("illustrated");
  }, [checks, mathReady, style]);

  return (
    <>
      <form action={ask}>
        <div className="ask">
          <input name="question" placeholder="why do leaves change colour in autumn?" autoFocus required minLength={3} maxLength={500} />
          <button type="submit" disabled={blocked} title={blocked ? "Waiting for the setup check" : undefined}>Explain it</button>
        </div>
        <input type="hidden" name="style" value={style} />
        <div className="styles" role="radiogroup" aria-label="Video style">
          {STYLES.map((s) => {
            const unavailable = s.id === "math" && checks !== null && !mathReady;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={style === s.id}
                className={`style-card${style === s.id ? " selected" : ""}`}
                disabled={unavailable}
                title={unavailable ? "The Manim animator isn't running (see the setup check)" : undefined}
                onClick={() => setStyle(s.id)}
              >
                {s.icon}
                <span>
                  <b>{s.name}</b>
                  <span className="small">{unavailable ? "Unavailable: the Manim animator isn't running" : s.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </form>
      <div className="setup">
        {!checks && !error && <span className="small">Checking your setup (OpenAI, Exa, Hedra, storage, renderer, animators)…</span>}
        {error && <span className="small">Couldn't run the setup check: {error}</span>}
        {checks && problems.length === 0 && <span className="small"><span className="ok">✓</span> Setup check passed: {checks.map((c) => c.name).join(", ")}</span>}
        {problems.length > 0 && (
          <div className="setup-problems">
            <strong>{blocked ? "Fix these before generating a video" : "Heads up"}</strong>
            <ul>
              {problems.map((c) => (
                <li key={c.name} className={c.status}>
                  <b>{c.name}</b>: {c.detail}
                  {c.fix && <div className="small">{c.fix}</div>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {(checks || error) && (
          <button type="button" className="btn ghost small-btn" onClick={() => load(true)}>Check again</button>
        )}
      </div>
    </>
  );
}
