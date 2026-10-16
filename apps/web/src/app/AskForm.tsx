"use client";

import { useCallback, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { ask } from "./actions";

type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string; fix?: string };
type Style = "illustrated" | "math";

/** Must match MANIM_CHECK in lib/preflight.ts (kept out of this client bundle). */
const MANIM_CHECK = "3Blue1Brown animator";

const STYLES: { id: Style; name: string; blurb: string; icon: React.ReactNode }[] = [
  {
    id: "illustrated",
    name: "Illustrated",
    blurb: "Flat illustrations and motion graphics, built on screen as it's explained",
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

/** The submit button, and the "starting" state while the server sets the run up (it can take a few seconds). */
function Submit({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={blocked || pending} title={blocked ? "Not available right now" : undefined} aria-busy={pending}>
      {pending ? (
        <>
          <span className="spin" aria-hidden="true" /> Starting…
        </>
      ) : (
        "Explain it"
      )}
    </button>
  );
}

/** Dims the form and says what's happening while the run is being set up. */
function Starting() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div className="starting" role="status">
      <span className="spin" aria-hidden="true" /> Setting up your video — the progress page opens in a moment.
    </div>
  );
}

/**
 * The question box. The setup check runs quietly in the background: visitors
 * never see it unless something is actually broken (then the form is held
 * with a plain message). Details for whoever runs the site: open /?setup, or
 * run in development. The server action checks again before starting a run.
 */
export function AskForm() {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState(process.env.NODE_ENV !== "production");

  const load = useCallback((refresh: boolean) => {
    setChecks(null);
    setError(null);
    fetch(`/api/preflight${refresh ? "?refresh" : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`setup check returned ${r.status}`))))
      .then((d: { checks: Check[] }) => setChecks(d.checks))
      .catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("setup")) setDetails(true);
    load(false);
  }, [load]);

  const [style, setStyle] = useState<Style>("illustrated");
  const failing = checks?.filter((c) => c.status === "fail") ?? [];
  const warnings = checks?.filter((c) => c.status === "warn") ?? [];
  // The 3Blue1Brown style needs its Manim sandbox; the Illustrated style needs nothing beyond the keys.
  const mathReady = checks === null || checks.find((c) => c.name === MANIM_CHECK)?.status === "ok";
  const blocked = failing.length > 0;
  useEffect(() => {
    if (!mathReady && style === "math") setStyle("illustrated");
  }, [mathReady, style]);

  return (
    <>
      <form action={ask}>
        <div className="ask">
          <input name="question" placeholder="why do leaves change colour in autumn?" autoFocus required minLength={3} maxLength={500} />
          <Submit blocked={blocked} />
        </div>
        <Starting />
        <input type="hidden" name="style" value={style} />
        <div className="styles" role="radiogroup" aria-label="Video style">
          {STYLES.map((s) => {
            const unavailable = s.id === "math" && !mathReady;
            return (
              <button
                key={s.id}
                type="button"
                role="radio"
                aria-checked={style === s.id}
                className={`style-card${style === s.id ? " selected" : ""}`}
                disabled={unavailable}
                title={unavailable ? "Not available right now" : undefined}
                onClick={() => setStyle(s.id)}
              >
                {s.icon}
                <span>
                  <b>{s.name}</b>
                  <span className="small">{unavailable ? "Not available right now" : s.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </form>
      {(blocked || details || (checks && !mathReady)) && (
        <div className="setup">
          {blocked && !details && (
            <div className="setup-problems">
              <strong>We can't make videos right now</strong>
              <div className="small">A service we rely on is unavailable. Please try again in a few minutes.</div>
            </div>
          )}
          {!blocked && !details && checks && !mathReady && <div className="small">The 3Blue1Brown style is unavailable right now; Illustrated still works.</div>}
          {details && !checks && !error && <span className="small">Checking the setup (OpenAI, Exa, Hedra, storage, renderer, animators)…</span>}
          {details && error && <span className="small">Couldn't run the setup check: {error}</span>}
          {details && checks && (
            <div className={`setup-problems${blocked ? "" : " setup-ok"}`}>
              <strong>{blocked ? "Fix these before generating a video" : warnings.length ? "Setup check passed, with notes" : "Setup check passed"}</strong>
              <ul>
                {checks.map((c) => (
                  <li key={c.name} className={c.status}>
                    <b>{c.status === "ok" ? "✓ " : c.status === "warn" ? "△ " : "✕ "}{c.name}</b>: {c.detail}
                    {c.fix && c.status !== "ok" && <div className="small">{c.fix}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {details && (checks || error) && (
            <button type="button" className="btn ghost small-btn" onClick={() => load(true)}>Check again</button>
          )}
        </div>
      )}
    </>
  );
}
