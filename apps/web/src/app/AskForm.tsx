"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ask } from "./actions";
import { version } from "@/lib/version";

type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string; fix?: string };
type Style = "illustrated" | "math";

/** Must match MANIM_CHECK in lib/preflight.ts (kept out of this client bundle). */
const MANIM_CHECK = "3Blue1Brown animator";

const EXAMPLES = ["Why is the sky blue?", "How do vaccines train the immune system?", "What is a Fourier transform?", "How does compound interest work?"];

const IllustratedThumb = () => (
  <svg width="44" height="32" viewBox="0 0 44 32" aria-hidden="true">
    <rect width="44" height="32" fill="#F4EFE4" />
    <circle cx="31" cy="11" r="5" fill="#E9B730" />
    <path d="M0 32 L0 22 Q11 13 22 21 T44 19 L44 32 Z" fill="#81B29A" />
  </svg>
);
const MathThumb = () => (
  <svg width="44" height="32" viewBox="0 0 44 32" aria-hidden="true">
    <rect width="44" height="32" fill="#0B0B0B" />
    <path d="M6 26 H40 M8 4 V28" stroke="#5A5A5A" strokeWidth="1" />
    <path d="M8 25 C16 25 18 8 25 8 S34 20 40 16" stroke="#58C4DD" strokeWidth="2.2" fill="none" />
  </svg>
);

/** The submit button, and the "starting" state while the server sets the run up (it can take a few seconds). */
function Submit({ blocked }: { blocked: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-accent" disabled={blocked || pending} aria-busy={pending} title={blocked ? "Not available right now" : undefined}>
      {pending ? (
        <>
          <span className="spin" aria-hidden="true" /> Starting…
        </>
      ) : (
        <>
          Explain it
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </>
      )}
    </button>
  );
}

/** Says what's happening while the run is being set up. */
function Starting() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div className="starting" role="status">
      <span className="spin" aria-hidden="true" /> Setting up your video. The progress page opens in a moment.
    </div>
  );
}

/**
 * The composer: one card holding everything about the request. The setup check
 * runs quietly in the background; visitors see an amber banner only when
 * something is actually broken. Whoever runs the site opens /?setup for the
 * row-by-row details.
 */
export function AskForm() {
  const [query, setQuery] = useState("");
  const [style, setStyle] = useState<Style>("illustrated");
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [details, setDetails] = useState(process.env.NODE_ENV !== "production");
  const box = useRef<HTMLTextAreaElement>(null);

  const load = useCallback((refresh = false) => {
    setChecking(true);
    setError(null);
    fetch(`/api/preflight${refresh ? "?refresh" : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`setup check returned ${r.status}`))))
      .then((data: { checks: Check[] }) => setChecks(data.checks))
      .catch((e: Error) => setError(e.message))
      .finally(() => setChecking(false));
  }, []);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("setup")) setDetails(true);
    load();
  }, [load]);

  const failing = (checks ?? []).filter((c) => c.status === "fail");
  const warnings = (checks ?? []).filter((c) => c.status === "warn");
  const blocked = failing.length > 0 || Boolean(error);
  // Mathematical needs its Manim sandbox; Illustrated needs nothing beyond the keys.
  const mathReady = checks === null || checks.find((c) => c.name === MANIM_CHECK)?.status === "ok";
  useEffect(() => {
    if (!mathReady && style === "math") setStyle("illustrated");
  }, [mathReady, style]);

  const reason = checking
    ? "Checking the setup (OpenAI, Exa, Hedra, storage, renderer, animators)…"
    : error
      ? `The setup check couldn't run (${error}). Everything below still plays.`
      : `The setup check failed on ${failing.map((c) => c.name.toLowerCase()).join(", ")}. Everything below still plays.`;

  const useExample = (text: string) => {
    setQuery(text);
    box.current?.focus();
  };

  return (
    <>
      {blocked && (
        <div className="setup-banner" role="status">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#F2B544" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3.5L2.5 20h19z" /><path d="M12 10v4.5M12 17.2h.01" /></svg>
          <div className="text">
            <strong>Can't start new videos right now</strong>
            <p>{reason}</p>
          </div>
          <button type="button" className="btn-outline" onClick={() => load(true)} disabled={checking}>{checking ? "Checking…" : "Check again"}</button>
        </div>
      )}

      <form action={ask}>
        <div className="composer">
          <label htmlFor="q" className="sr-only">Your question</label>
          <textarea
            id="q"
            ref={box}
            name="question"
            rows={2}
            placeholder="How do noise-cancelling headphones work?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter makes a new line.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                e.currentTarget.form?.requestSubmit();
              }
            }}
            required
            minLength={3}
            maxLength={500}
            autoFocus
          />
          <input type="hidden" name="style" value={style} />
          <div className="composer-row">
            <fieldset className="style-pick">
              <legend className="sr-only">Video style</legend>
              <button type="button" className="style-btn" aria-pressed={style === "illustrated"} onClick={() => setStyle("illustrated")}>
                <IllustratedThumb />
                <span><b>Illustrated</b><small>Flat art and motion graphics</small></span>
              </button>
              <button type="button" className="style-btn" aria-pressed={style === "math"} onClick={() => setStyle("math")} disabled={!mathReady} title={mathReady ? undefined : "Not available right now"}>
                <MathThumb />
                <span><b>Mathematical</b><small>{mathReady ? "Equations and graphs, in Manim" : "Not available right now"}</small></span>
              </button>
            </fieldset>
            <div className="composer-go">
              <span className="eta hide-sm">about 10 min</span>
              <Submit blocked={blocked} />
            </div>
          </div>
        </div>
        <Starting />
      </form>

      <div className="try">
        <span className="label">Try</span>
        {EXAMPLES.map((t) => (
          <button key={t} type="button" className="chip" onClick={() => useExample(t)}>{t}</button>
        ))}
      </div>

      {details && (
        <div className={`setup-details${blocked ? " failing" : ""}`}>
          {!checks && !error && <span className="small">Checking the setup (OpenAI, Exa, Hedra, storage, renderer, animators)…</span>}
          {error && <span className="small">Couldn't run the setup check: {error}</span>}
          {checks && (
            <>
              <strong>{blocked ? "Fix these before making a video" : warnings.length ? "Setup check passed, with notes" : "Setup check passed"}</strong>
              <ul>
                {checks.map((c) => (
                  <li key={c.name} className={c.status}>
                    <b>{c.status === "ok" ? "✓ " : c.status === "warn" ? "△ " : "✕ "}{c.name}</b>: {c.detail}
                    {c.fix && c.status !== "ok" && <div className="small">{c.fix}</div>}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="version" title="Which code this site is running: git commit, branch, build time">{version.label}</div>
          {(checks || error) && (
            <button type="button" className="btn-outline" onClick={() => load(true)} disabled={checking}>{checking ? "Checking…" : "Check again"}</button>
          )}
        </div>
      )}
    </>
  );
}
