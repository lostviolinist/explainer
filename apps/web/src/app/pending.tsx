"use client";

import { useFormStatus } from "react-dom";

/**
 * A submit button that shows it's working. Starting a run takes the server a
 * few seconds; without this, pressing the button looks like nothing happened.
 * In a form with several submit buttons (Simpler / Deeper), only the one that
 * was pressed changes, matched by its name and value.
 */
export function PendingButton({ children, pendingText = "Starting…", className = "btn", name, value }: { children: React.ReactNode; pendingText?: string; className?: string; name?: string; value?: string }) {
  const { pending, data } = useFormStatus();
  const mine = pending && (!name || data?.get(name) === value);
  return (
    <button type="submit" className={className} name={name} value={value} disabled={pending} aria-busy={mine}>
      {mine ? (
        <>
          <span className="spin" aria-hidden="true" /> {pendingText}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/** A line under a form while it's being sent. */
export function PendingNote({ children = "Setting up your video — the progress page opens in a moment." }: { children?: React.ReactNode }) {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div className="starting" role="status">
      <span className="spin" aria-hidden="true" /> {children}
    </div>
  );
}
