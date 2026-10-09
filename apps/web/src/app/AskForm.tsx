"use client";

import { useCallback, useEffect, useState } from "react";
import { ask } from "./actions";

type Check = { name: string; status: "ok" | "warn" | "fail"; detail: string; fix?: string };

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

  const problems = checks?.filter((c) => c.status !== "ok") ?? [];
  const blocked = !checks || checks.some((c) => c.status === "fail");

  return (
    <>
      <form action={ask} className="ask">
        <input name="question" placeholder="why do leaves change colour in autumn?" autoFocus required minLength={3} maxLength={500} />
        <button type="submit" disabled={blocked} title={blocked ? "Waiting for the setup check" : undefined}>Explain it</button>
      </form>
      <div className="setup">
        {!checks && !error && <span className="small">Checking your setup (OpenAI, Exa, Hedra, storage, renderer)…</span>}
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
