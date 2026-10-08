"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Ev = { stage: string; message: string; fraction: number; preview?: { hookLine?: string; stillUrl?: string } | null; at: string };

const STAGE_WEIGHT: Record<string, [number, number]> = {
  queued: [0, 0.02],
  intake: [0.02, 0.06],
  research: [0.06, 0.3],
  script: [0.3, 0.45],
  visuals: [0.45, 0.85],
  assemble: [0.85, 1],
  done: [1, 1],
  failed: [1, 1],
};

/** Plain-words progress. Shows the hook line and first still as soon as they exist. */
export function Progress({ projectId, initial }: { projectId: string; initial: Ev[] }) {
  const [events, setEvents] = useState<Ev[]>(initial);
  const router = useRouter();

  useEffect(() => {
    const es = new EventSource(`/api/projects/${projectId}/events`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as Ev;
      setEvents((prev) => [...prev, e]);
      if (e.stage === "done") {
        es.close();
        router.refresh();
      }
    };
    es.onerror = () => es.close();
    return () => es.close();
  }, [projectId, router]);

  const last = events.at(-1);
  const hook = [...events].reverse().find((e) => e.preview?.hookLine)?.preview?.hookLine;
  const still = [...events].reverse().find((e) => e.preview?.stillUrl)?.preview?.stillUrl;
  const [lo, hi] = STAGE_WEIGHT[last?.stage ?? "queued"] ?? [0, 1];
  const overall = lo + (hi - lo) * (last?.fraction ?? 0);

  return (
    <div className="progress">
      <div className="small">{last?.stage === "failed" ? "Something went wrong" : "Making your video"}</div>
      <div className="bar"><div style={{ width: `${Math.round(overall * 100)}%` }} /></div>
      <div className="msg">{last?.message ?? "starting"}</div>
      {hook && <div className="hook">“{hook}”</div>}
      {still && <img className="still" src={still} alt="" />}
      <p className="small" style={{ marginTop: 16 }}>You can close this tab; we'll keep going. Usually 8–12 minutes.</p>
    </div>
  );
}
