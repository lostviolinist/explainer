"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { LiveScene, LiveState } from "@/lib/live";
import { ask, retryProject } from "@/app/actions";
import { PendingButton } from "@/app/pending";
import { MythOrFact } from "@/app/Quiz";
import { cleanSourceTitle, clock } from "@/lib/titles";

type Preview = {
  hookLine?: string;
  sceneId?: string;
  stillUrl?: string;
  clipUrl?: string;
  audioUrl?: string;
  source?: { url: string; title: string; domain: string };
  fact?: string;
};
export type Ev = { stage: string; message: string; fraction: number; preview?: Preview | null; at: string };

const STAGES = [
  { key: "intake", label: "Understanding", pending: "What you want to know", active: "Reading your question" },
  { key: "research", label: "Researching", pending: "Find and read sources", active: "Finding sources" },
  { key: "script", label: "Writing", pending: "Script, then a learner test", active: "Planning the story" },
  { key: "visuals", label: "Illustrating", pending: "Voice and pictures", active: "Voice and pictures" },
  { key: "assemble", label: "Editing", pending: "Music and final cut", active: "Music and final cut" },
] as const;
type StageKey = (typeof STAGES)[number]["key"];

/** Share of the whole run each stage takes, from typical timings. */
const SPAN: Record<string, [number, number]> = {
  queued: [0, 0.02],
  intake: [0.02, 0.05],
  research: [0.05, 0.3],
  script: [0.3, 0.42],
  visuals: [0.42, 0.88],
  assemble: [0.88, 1],
  done: [1, 1],
};
const TYPICAL_MIN = 10;

const BEAT: Record<string, { label: string; tag: string }> = {
  hook: { label: "Hook", tag: "hook" },
  ground: { label: "Grounding", tag: "grounding" },
  misconception: { label: "Myth-buster", tag: "myth-buster" },
  "build-up": { label: "Build-up", tag: "build-up" },
  core: { label: "Core idea", tag: "core-idea" },
  payoff: { label: "Payoff", tag: "payoff" },
  recap: { label: "Recap", tag: "recap" },
};
const LEVEL_LABEL: Record<string, string> = { nothing: "Beginner", basics: "Some background", deep: "Deep dive" };
/** Scenes the composition draws from a template (nothing generated): built in the edit. */
const PROGRAMMATIC = new Set(["chart", "text", "motion"]);
/** Scenes whose animation is written as code (Manim / three.js, the Mathematical style). */
const CODED = new Set(["manim", "three"]);
/** Scenes whose still gets a clip afterwards. */
const MOVING = new Set(["still-animated", "clip", "reference-seq"]);

// The Remotion player is browser-only.
const RoughCutPlayer = dynamic(() => import("./RoughCutPlayer").then((m) => m.RoughCutPlayer), { ssr: false });
const SceneThumb = dynamic(() => import("./RoughCutPlayer").then((m) => m.SceneThumb), { ssr: false });

type Props = { projectId: string; question: string; title: string; style: string; initial: Ev[]; initialLive: LiveState };

/** Watch the video get made: five stages, the rough cut, a storyboard, and something to read while you wait. */
export function Progress({ projectId, question, title, style, initial, initialLive }: Props) {
  const router = useRouter();
  const [events, setEvents] = useState<Ev[]>(initial);
  const [live, setLive] = useState<LiveState>(initialLive);
  const [now, setNow] = useState(0); // set after mount, so server and client render alike
  const [gen, setGen] = useState(0); // bumped to reopen the event stream after a retry
  const refetch = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadLive = useCallback(() => {
    if (refetch.current) return;
    refetch.current = setTimeout(() => {
      refetch.current = null;
      fetch(`/api/projects/${projectId}/live`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((l: LiveState | null) => l && setLive(l))
        .catch(() => undefined);
    }, 1200);
  }, [projectId]);

  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let finished = false;
    const connect = () => {
      es = new EventSource(`/api/projects/${projectId}/events`);
      es.onmessage = (m) => {
        const e = JSON.parse(m.data) as Ev;
        setEvents((prev) => (prev.some((p) => p.at === e.at && p.message === e.message) ? prev : [...prev, e]));
        loadLive();
        if (e.stage === "done") {
          finished = true;
          es?.close();
          notifyDone(title);
          router.refresh();
        }
        if (e.stage === "failed") finished = true;
      };
      // Reconnect if the stream drops (laptop sleep, server restart).
      es.onerror = () => {
        es?.close();
        if (!finished) retry = setTimeout(connect, 3000);
      };
    };
    connect();
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      es?.close();
      if (retry) clearTimeout(retry);
      clearInterval(tick);
    };
  }, [projectId, title, router, loadLive, gen]);

  const last = events.at(-1);
  const failed = last?.stage === "failed";
  const done = last?.stage === "done";
  // Where it is, or where it stopped: the last event that names a stage.
  const stage: StageKey = (() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const s = events[i]!.stage;
      if (STAGES.some((x) => x.key === s)) return s as StageKey;
    }
    return "intake";
  })();
  const stageIdx = STAGES.findIndex((s) => s.key === stage);
  const startedAt = events[0] ? new Date(events[0].at).getTime() : now;

  // Merge live previews from events into the stored state, so each piece shows the moment it exists.
  const view = useMemo(() => {
    const sources = new Map(live.sources.map((s) => [s.url, s]));
    // Research's merged claims replace the per-page facts once they exist (pages repeat each other).
    const pageFacts: LiveState["facts"] = [];
    const media = new Map<string, Preview>();
    let hookLine: string | undefined;
    for (const e of events) {
      const p = e.preview;
      if (!p) continue;
      if (p.source && !sources.has(p.source.url)) sources.set(p.source.url, p.source);
      if (p.fact) pageFacts.push({ text: p.fact, domain: p.source?.domain });
      if (p.hookLine) hookLine = p.hookLine;
      if (p.sceneId) media.set(p.sceneId, { ...media.get(p.sceneId), ...p });
    }
    const scenes: LiveScene[] = live.scenes.map((s) => {
      const m = media.get(s.id) ?? {};
      return { ...s, stillUrl: s.stillUrl ?? m.stillUrl, clipUrl: s.clipUrl ?? m.clipUrl, audioUrl: s.audioUrl ?? m.audioUrl };
    });
    const facts = distinctFacts(live.facts.length ? live.facts : pageFacts);
    return { sources: [...sources.values()], facts, scenes, hookLine: hookLine ?? scenes[0]?.narration.split(/(?<=[.?!])\s/)[0] };
  }, [events, live]);

  // Retries, read off the progress messages: a second "drawing scene 7" before "drew scene 7" is a retry.
  const retries = useMemo(() => retriesFrom(events), [events]);
  const sceneRows = useMemo(() => view.scenes.map((s, i) => sceneRow(s, i + 1, retries.get(i + 1), failed, stage, done)), [view.scenes, retries, failed, stage, done]);
  const ready = sceneRows.filter((r) => r.ready).length;
  const retrying = sceneRows.filter((r) => r.state === "retry").length;
  const missing = failed ? sceneRows.filter((r) => !r.ready) : [];

  // Overall progress: stage spans, refined by finished scene work, and eased while rendering. Never goes backwards.
  const maxPct = useRef(0);
  const pct = useMemo(() => {
    if (failed) return maxPct.current;
    const [lo, hi] = SPAN[last?.stage ?? "queued"] ?? [0, 1];
    let within = last?.fraction ?? 0;
    if (stage === "visuals" && view.scenes.length) {
      const per = view.scenes.map((s) => (s.done ? 1 : CODED.has(s.visualType) ? (s.audioUrl ? 0.15 : 0) + (s.clipUrl ? 0.85 : 0) : (s.audioUrl ? 0.15 : 0) + (s.stillUrl || PROGRAMMATIC.has(s.visualType) ? 0.45 : 0) + (s.clipUrl ? 0.4 : 0)));
      within = per.reduce((a, b) => a + b, 0) / per.length;
    }
    if (stage === "assemble" && last?.message === "rendering" && now) {
      const since = (now - new Date(last.at).getTime()) / 1000;
      within = 0.5 + 0.48 * (1 - Math.exp(-since / 120));
    }
    const v = done ? 1 : lo + (hi - lo) * Math.min(1, within);
    maxPct.current = Math.max(maxPct.current, v);
    return maxPct.current;
  }, [last, stage, view.scenes, now, failed, done]);

  const elapsedMin = (now - startedAt) / 60000;
  const etaMin = pct > 0.12 && elapsedMin > 0.5 ? (elapsedMin * (1 - pct)) / pct : TYPICAL_MIN * (1 - pct);
  const eta = !now
    ? ""
    : done
      ? `Took ${Math.max(1, Math.round((new Date(last!.at).getTime() - startedAt) / 60000))} min`
      : pct >= 0.97
        ? "Almost done"
        : etaMin < 1.5
          ? "About a minute left"
          : `About ${Math.max(1, Math.round(etaMin * 0.8))}–${Math.max(Math.max(1, Math.round(etaMin * 0.8)) + 1, Math.round(etaMin * 1.25))} min left`;

  useEffect(() => {
    document.title = failed ? `Stopped · ${title}` : done ? `Ready · ${title}` : `${Math.min(99, Math.round(pct * 100))}% · ${title}`;
  }, [pct, failed, done, title]);

  // Accepted but never picked up: the background worker isn't running or hasn't synced this app.
  const stuck = !failed && now > 0 && (!last || last.stage === "queued") && now - startedAt > 75_000;

  // The status line, and whether it is a retry (amber).
  const activity = useMemo((): { text: string; warn: boolean } => {
    if (done) return { text: "Ready to watch", warn: false };
    if (!last || last.stage === "queued" || last.stage === "intake") return { text: "Working out what you want to know…", warn: false };
    const m = last.message;
    const r = retryLine(m, retries);
    if (r) return { text: r, warn: true };
    return { text: sentence(m), warn: false };
  }, [last, retries, done]);

  const brief = live.brief;
  const segments = STAGES.map((s, i) => {
    const status: "done" | "active" | "pending" | "error" = done || i < stageIdx ? "done" : i === stageIdx ? (failed ? "error" : "active") : "pending";
    const [lo, hi] = SPAN[s.key]!;
    const fill = status === "done" ? 100 : status === "error" ? 55 : status === "active" ? Math.round(100 * Math.min(0.96, Math.max(0.06, (pct - lo) / (hi - lo)))) : 0;
    let note: string = status === "done" ? "" : status === "active" ? s.active : s.pending;
    const n = view.scenes.length;
    if (s.key === "intake" && status === "done") note = brief ? `${LEVEL_LABEL[brief.level] ?? brief.level}${brief.lengthS ? `, about ${Math.max(1, Math.round(brief.lengthS / 60))} min` : ""}` : "Done";
    if (s.key === "research") {
      const k = view.sources.length;
      if (status === "done") note = `${k} source${k === 1 ? "" : "s"}`;
      else if (status === "active" && k) note = `${k} source${k === 1 ? "" : "s"} so far`;
    }
    if (s.key === "script") {
      if (status === "done") note = `${n} scenes, tested on a learner`;
      else if (status === "active" && /learner|expert|rewriting|shortening/.test(last?.message ?? "")) note = "Testing it on a learner";
    }
    if (s.key === "visuals") {
      if (status === "done") note = `All ${n} scenes drawn`;
      else if (status === "active" && n) note = `${ready} of ${n} scenes ready${retrying ? ` · ${retrying} retrying` : ""}`;
      else if (status === "error") note = missing.length ? `Stopped: ${missing.length} scene${missing.length === 1 ? "" : "s"} didn't draw` : "Stopped here";
    }
    if (s.key === "assemble") {
      if (status === "done") note = "Music and final cut";
      else if (status === "active" && last?.message === "rendering") note = "Rendering the final cut";
    }
    if (status === "error" && s.key !== "visuals") note = "Stopped here";
    return { ...s, status, fill, note };
  });
  const stepLine = done ? "All 5 steps done" : `Step ${stageIdx + 1} of 5 · ${STAGES[stageIdx]!.label}${failed ? " (stopped)" : ""}`;
  const showWait = !failed && !done;

  const [pending, start] = useTransition();
  const retry = () =>
    start(async () => {
      await retryProject(projectId);
      maxPct.current = 0;
      setGen((g) => g + 1);
      router.refresh();
    });

  return (
    <div className="mk">
      <section className="mk-progress" aria-label="Progress">
        <ol className="mk-segments">
          {segments.map((s) => (
            <li key={s.key} className={`seg ${s.status}`} aria-current={s.status === "active" || s.status === "error" ? "step" : undefined}>
              <div className="seg-track"><div className="seg-fill" style={{ width: `${s.fill}%` }} /></div>
              <div className="seg-name">
                <StatusIcon status={s.status} />
                <span className="hide-sm">{s.label}</span>
              </div>
              <span className="seg-note hide-sm">{s.note}</span>
            </li>
          ))}
        </ol>
        <p className="mk-step show-sm">{stepLine}</p>

        {!failed ? (
          <div className="mk-status" aria-live="polite">
            <span className={activity.warn ? "activity warn" : "activity"}>{activity.text}</span>
            <span className="mk-eta">
              <span>{eta}</span>
              <span className="mono pct">{Math.min(done ? 100 : 99, Math.round(pct * 100))}%</span>
            </span>
          </div>
        ) : (
          <div className="mk-stopped" role="alert">
            <div className="mk-stopped-body">
              <WarnIcon size={22} />
              <div>
                <p className="mk-stopped-title">This one stopped at {STAGES[stageIdx]!.label}</p>
                <p className="mk-stopped-text">{stoppedText(stage, last?.message ?? "", missing.map((m) => m.n), view.scenes.length)}</p>
              </div>
            </div>
            <div className="mk-stopped-actions">
              <button type="button" className="btn-accent" onClick={retry} disabled={pending} aria-busy={pending}>
                {pending ? <><span className="spin" aria-hidden="true" /> Starting…</> : missing.length && stage === "visuals" ? `Try ${missing.length === 1 ? "that scene" : `those ${missing.length} scenes`} again` : "Try again"}
              </button>
              <form action={ask} className="mk-inline-form">
                <input type="hidden" name="question" value={question} />
                <input type="hidden" name="style" value={style} />
                <PendingButton className="btn-outline">Start over</PendingButton>
              </form>
              <ReportProblem projectId={projectId} stage={stage} error={last?.message ?? ""} />
            </div>
          </div>
        )}
      </section>

      {stuck && (
        <div className="setup-banner mk-stuck" role="status">
          <WarnIcon size={20} />
          <div className="text">
            <strong>Nothing has picked this up yet</strong>
            <p>
              The background worker (Inngest) isn't running, or hasn't found the app. Check the <a href="/?setup">setup page</a>, or on the machine running it, <code>docker compose logs inngest web</code>. The run continues on its own once the worker is back.
            </p>
          </div>
        </div>
      )}

      {showWait && (
        <div className="mk-wait-sm show-sm">
          <p><strong>No need to wait here.</strong> It keeps going if you close this tab.</p>
          <CopyLink />
        </div>
      )}

      <div className="mk-columns">
        <div className="mk-main">
          <RoughCut projectId={projectId} live={live} rows={sceneRows} title={title} hookLine={view.hookLine} done={done} failed={failed} stage={stage} math={style === "math"} />
          <Storyboard rows={sceneRows} props={live.roughCut} stage={stage} failed={failed} />
        </div>

        <aside className="mk-side">
          {showWait && <WaitCard />}
          {brief && <GoalCard brief={brief} />}
          {(view.facts.length > 0 || live.quiz.length > 0) && <WhileYouWait facts={view.facts} quiz={live.quiz} />}
          {view.sources.length > 0 && <Sources sources={view.sources} />}
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reading the run

/** "drawing scene 2" → "Drawing scene 2…"; "drew scene 2" → "Drew scene 2". */
function sentence(s: string) {
  const t = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?…]$/.test(t) || !/^\w+ing\b/.test(t) ? t : `${t}…`;
}

type Retry = { draw: number; anim: number; fix: number };

/** Per scene number: how many times its picture, clip or animation code has been attempted since the last one that worked. */
function retriesFrom(events: Ev[]): Map<number, Retry> {
  const m = new Map<number, Retry>();
  const at = (n: number) => m.get(n) ?? (m.set(n, { draw: 0, anim: 0, fix: 0 }), m.get(n)!);
  for (const e of events) {
    let r: RegExpMatchArray | null;
    if ((r = e.message.match(/^drawing scene (\d+)$/))) at(+r[1]!).draw++;
    else if ((r = e.message.match(/^drew scene (\d+)$/))) at(+r[1]!).draw = 0;
    else if ((r = e.message.match(/^animating scene (\d+)$/))) at(+r[1]!).anim++;
    else if ((r = e.message.match(/^fixing the .* for scene (\d+)$/))) at(+r[1]!).fix++;
    else if ((r = e.message.match(/^(?:animated|built) scene (\d+)/))) m.set(+r[1]!, { draw: 0, anim: 0, fix: 0 });
  }
  return m;
}

/** "Retrying, 2 of 2" for a scene whose last attempt didn't pass; null when it is on its first try. */
function retryLabel(r: Retry | undefined): string | null {
  if (!r) return null;
  if (r.fix >= 1) return `Retrying, ${Math.min(3, r.fix + 1)} of 3`;
  if (r.anim >= 2) return `Retrying, ${Math.min(2, r.anim)} of 2`;
  if (r.draw >= 3) return "Retrying, simpler picture";
  if (r.draw >= 2) return "Retrying, 2 of 2";
  return null;
}

/** The amber status line when the latest event is a retry. */
function retryLine(message: string, retries: Map<number, Retry>): string | null {
  let r: RegExpMatchArray | null;
  if ((r = message.match(/^drawing scene (\d+)$/))) {
    const c = retries.get(+r[1]!)?.draw ?? 0;
    if (c >= 3) return `Scene ${r[1]} didn't draw cleanly. Trying again with a simpler picture…`;
    if (c >= 2) return `Scene ${r[1]} didn't draw cleanly. Trying again…`;
  }
  if ((r = message.match(/^animating scene (\d+)$/)) && (retries.get(+r[1]!)?.anim ?? 0) >= 2) return `Scene ${r[1]} didn't animate cleanly. Trying again…`;
  if ((r = message.match(/^fixing the (.*) for scene (\d+)$/))) return `Scene ${r[2]}'s ${r[1]} didn't pass the check. Fixing it…`;
  return null;
}

type SceneState = "done" | "busy" | "wait" | "retry" | "fail";
type Row = {
  n: number;
  scene: LiveScene;
  ready: boolean;
  /** Drawn by the composition from a template, not a generated picture. */
  inEdit: boolean;
  state: SceneState;
  picture: string;
  voice: "done" | "busy" | "wait";
  short: string;
  strip: "cut" | "anim" | "edit" | "draw" | "retry" | "fail" | "idle";
};

/** One storyboard row: what is done, what is being made, and how to colour it. */
function sceneRow(s: LiveScene, n: number, retry: Retry | undefined, failed: boolean, stage: StageKey, done: boolean): Row {
  const inEdit = PROGRAMMATIC.has(s.visualType) && !s.clipUrl;
  if (s.done || done) {
    const label = inEdit ? "In the edit" : "Picture";
    return { n, scene: s, ready: true, inEdit, state: "done", picture: label, voice: "done", short: "Ready", strip: inEdit ? "edit" : "cut" };
  }
  const voice: Row["voice"] = s.audioUrl ? "done" : stage === "visuals" || stage === "assemble" ? "busy" : "wait";
  if (failed) return { n, scene: s, ready: false, inEdit, state: "fail", picture: "Didn't draw", voice, short: "Didn't draw", strip: "fail" };
  if (stage !== "visuals" && stage !== "assemble") return { n, scene: s, ready: false, inEdit, state: "wait", picture: "Picture", voice, short: "Recording voice", strip: "idle" };
  const rl = retryLabel(retry);
  if (rl) return { n, scene: s, ready: false, inEdit, state: "retry", picture: rl, voice, short: "Retrying", strip: "retry" };
  if (!s.audioUrl) return { n, scene: s, ready: false, inEdit, state: "wait", picture: inEdit ? "In the edit" : "Picture", voice, short: "Recording voice", strip: inEdit ? "edit" : "draw" };
  if (inEdit) return { n, scene: s, ready: false, inEdit, state: "busy", picture: "In the edit", voice, short: "In the edit", strip: "edit" };
  if (CODED.has(s.visualType) || PROGRAMMATIC.has(s.visualType)) return { n, scene: s, ready: false, inEdit, state: "busy", picture: "Animating", voice, short: "Animating", strip: "anim" };
  if (!s.stillUrl) return { n, scene: s, ready: false, inEdit, state: "busy", picture: "Drawing", voice, short: "Drawing", strip: "draw" };
  if (MOVING.has(s.visualType) && !s.clipUrl) return { n, scene: s, ready: false, inEdit, state: "busy", picture: "Animating", voice, short: "Animating", strip: "anim" };
  return { n, scene: s, ready: false, inEdit, state: "busy", picture: s.visualType === "diagram" ? "Placing labels" : "Checking", voice, short: "Checking", strip: "draw" };
}

/** Drop facts that say the same thing in other words: most of their key words overlap. */
function distinctFacts(facts: LiveState["facts"]): LiveState["facts"] {
  const keyWords = (t: string) => new Set(t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 3));
  const kept: { fact: LiveState["facts"][number]; words: Set<string> }[] = [];
  for (const fact of facts) {
    const words = keyWords(fact.text);
    const same = kept.some((k) => {
      const shared = [...words].filter((w) => k.words.has(w)).length;
      return shared / Math.max(1, Math.min(words.size, k.words.size)) >= 0.6;
    });
    if (!same) kept.push({ fact, words });
  }
  return kept.map((k) => k.fact);
}

function notifyDone(title: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Your video is ready", { body: title });
  } catch {}
}

/** "5, 7 and 10" */
function list(nums: number[]): string {
  if (nums.length <= 1) return nums.join("");
  return `${nums.slice(0, -1).join(", ")} and ${nums.at(-1)}`;
}

function stoppedText(stage: StageKey, message: string, missing: number[], total: number): string {
  const err = message.replace(/^something went wrong:\s*/i, "").trim().slice(0, 160);
  const why = err ? ` (${err})` : "";
  const s = missing.length === 1 ? "" : "s";
  if (stage === "visuals" && missing.length) {
    const kept = total - missing.length;
    return `Scene${s} ${list(missing)} didn't get made${why}. Your research, script, voice${kept ? ` and the other ${kept} scene${kept === 1 ? "" : "s"}` : ""} are saved, so trying again only redoes ${missing.length === 1 ? "that one" : `those ${missing.length}`}.`;
  }
  if (stage === "visuals" || stage === "assemble") return `The final cut didn't finish${why}. All ${total} scenes are saved, so trying again only redoes the edit.`;
  if (stage === "script") return `The script didn't finish${why}. The research is saved, so trying again starts from there.`;
  if (stage === "research") return `The research didn't finish${why}. Trying again picks it up from the question.`;
  return `It stopped before anything was made${why}. Trying again starts from the question.`;
}

// ---------------------------------------------------------------------------
// Pieces

function StatusIcon({ status, size = 16 }: { status: "done" | "active" | "pending" | "error"; size?: number }) {
  if (status === "done")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor" /><path d="M7.5 12.5l3 3 6-6.5" fill="none" stroke="#0D0D10" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    );
  if (status === "error")
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor" /><path d="M8.5 8.5l7 7M15.5 8.5l-7 7" stroke="#0D0D10" strokeWidth="2.6" strokeLinecap="round" /></svg>
    );
  if (status === "active") return <Spinner size={size} />;
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="#3A3A45" strokeWidth="2" /></svg>;
}

function Spinner({ size = 16, width = 3 }: { size?: number; width?: number }) {
  return (
    <svg className="mk-spin" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="#2A2A33" strokeWidth={width} /><path d="M12 3a9 9 0 0 1 9 9" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" /></svg>
  );
}

function Check({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>;
}

function Cross({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" /></svg>;
}

function Circle({ size = 14 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="#3A3A45" strokeWidth="2.5" /></svg>;
}

function WarnIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mk-warn-icon"><path d="M12 3.5L2.5 20h19z" /><path d="M12 10v4.5M12 17.2h.01" /></svg>
  );
}

function EditIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 17c3-6 6-6 8-2s5 4 8-2" /><path d="M4 9h3M17 6h3" /></svg>
  );
}

const PlayIcon = ({ size = 16 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" /></svg>;
const PauseIcon = ({ size = 16 }: { size?: number }) => <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" /></svg>;

/** The rough cut: the real composition with the scenes finished so far, or the opening line as a title card until there is one. */
function RoughCut({ projectId, live, rows, title, hookLine, done, failed, stage, math }: { projectId: string; live: LiveState; rows: Row[]; title: string; hookLine?: string; done: boolean; failed: boolean; stage: StageKey; math: boolean }) {
  const props = live.roughCut;
  const total = rows.length;
  const inCut = rows.filter((r) => r.ready).length;
  const playable = Boolean(props?.scenes.length) && !done;
  const cutS = props ? props.scenes.reduce((a, s) => a + s.durationS, 0) : 0;
  const note = done ? "Final cut, with music" : !total ? "Nothing in the cut yet" : `${inCut} of ${total} scenes · ${failed ? "no music" : "no music yet"}`;
  const caption = done ? "" : failed ? "Paused until you try again" : stage === "assemble" ? "Adding music and the final cut" : inCut ? "The rest joins the cut as it finishes" : "Scenes join the cut as they finish";
  const poster = rows.map((r) => r.scene.stillUrl).find(Boolean);
  const hasProblems = rows.some((r) => r.state === "fail" || r.state === "retry");
  return (
    <section className="mk-card mk-cut" aria-labelledby="cut-h">
      <div className="mk-card-head">
        <h2 id="cut-h">Rough cut</h2>
        <span className="mk-note">{note}</span>
      </div>
      <div className={`mk-frame${math ? " math" : ""}`}>
        {playable ? (
          <div className="mk-player"><RoughCutPlayer props={props as never} /></div>
        ) : done ? (
          <>
            {poster ? <img src={poster} alt="" /> : <div className="mk-poster"><p className="mk-poster-quote">“{hookLine ?? title}”</p></div>}
            <Link href={`/p/${projectId}`} className="mk-watch">
              <PlayIcon size={18} />Watch it
            </Link>
          </>
        ) : (
          <>
            <div className="mk-poster">
              <p className="mk-poster-eyebrow hide-sm">{hookLine ? "Your video opens with" : "Being made"}</p>
              <p className="mk-poster-quote">“{hookLine ?? title}”</p>
            </div>
            <div className="mk-controls">
              <button type="button" aria-label="Play the rough cut" disabled><PlayIcon size={20} /></button>
              <span className="mono">0:00</span>
              <span className="grow" />
              <span className="hide-sm">{caption}</span>
            </div>
          </>
        )}
      </div>
      {playable && caption && <p className="mk-cut-caption">{caption}{cutS ? ` · ${clock(cutS)} so far` : ""}</p>}
      <div className="mk-strip" aria-hidden="true">
        {(total ? rows.map((r) => r.strip) : Array.from({ length: 8 }, () => "idle" as const)).map((c, i) => <span key={i} className={`sg ${c}`} />)}
      </div>
      <div className="mk-legend">
        <span><i className="sw cut" />In the cut</span>
        <span><i className="sw anim" />Being animated</span>
        <span><i className="sw edit" />Built in the edit</span>
        <span><i className="sw draw" />Still drawing</span>
        {hasProblems && rows.some((r) => r.state === "retry") && <span><i className="sw retry" />Retrying</span>}
        {hasProblems && rows.some((r) => r.state === "fail") && <span><i className="sw fail" />Didn't draw</span>}
      </div>
    </section>
  );
}

function Storyboard({ rows, props, stage, failed }: { rows: Row[]; props: LiveState["roughCut"]; stage: StageKey; failed: boolean }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const toggle = (s: LiveScene) => {
    if (!s.audioUrl) return;
    if (playing === s.id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    audio.current?.pause();
    audio.current = new Audio(s.audioUrl);
    audio.current.onended = () => setPlaying(null);
    audio.current.play().then(() => setPlaying(s.id), () => setPlaying(null));
  };
  useEffect(() => () => audio.current?.pause(), []);

  const ready = rows.filter((r) => r.ready && !r.inEdit).length;
  const edit = rows.filter((r) => r.ready && r.inEdit).length;
  const retrying = rows.filter((r) => r.state === "retry").length;
  const failedN = rows.filter((r) => r.state === "fail").length;
  const note = !rows.length
    ? ""
    : failed
      ? [`${ready} ready`, edit ? `${edit} for the edit` : "", failedN ? `${failedN} didn't draw` : ""].filter(Boolean).join(" · ")
      : stage === "script"
        ? "Script ready · recording the voice"
        : `${ready + edit} of ${rows.length} scenes ready${retrying ? ` · ${retrying} retrying` : ""}${edit && stage === "assemble" ? ` · ${edit} built in the edit` : ""}`;

  return (
    <section className="mk-card mk-storyboard" aria-labelledby="sb-h">
      <div className="mk-card-head">
        <h2 id="sb-h">Storyboard</h2>
        <span className="mk-note">{note}</span>
      </div>
      {rows.length ? (
        <ol className="mk-rows">
          {rows.map((r) => {
            const s = r.scene;
            const beat = BEAT[s.beat] ?? { label: s.beat, tag: "grounding" };
            const line = s.narration.split(/(?<=[.?!])\s/)[0] ?? s.narration;
            const marks: { label: string; state: SceneState; wide?: boolean }[] = [
              { label: "Script", state: "done" },
              { label: "Voice", state: r.voice },
              { label: r.picture, state: r.state === "done" ? "done" : r.state === "wait" ? "wait" : r.state, wide: true },
            ];
            const tone = r.state === "fail" ? "fail" : r.state === "retry" ? "retry" : "";
            return (
              <li key={s.id} className={`mk-row ${tone}`}>
                <span className="mono num">{r.n}</span>
                <span className={`thumb hide-sm ${r.ready ? (r.inEdit ? "edit" : "ready") : r.state === "fail" ? "fail" : r.inEdit ? "edit" : ""}`}>
                  {r.ready && s.stillUrl ? (
                    <img src={s.stillUrl} alt="" />
                  ) : r.ready && s.clipUrl ? (
                    <video src={`${s.clipUrl}#t=1`} muted playsInline preload="metadata" />
                  ) : r.ready && props?.scenes.some((p) => p.id === s.id) ? (
                    <SceneThumb props={props as never} sceneId={s.id} />
                  ) : r.state === "fail" ? (
                    <WarnIcon size={18} />
                  ) : r.inEdit && r.state !== "busy" ? (
                    <EditIcon />
                  ) : (
                    <Spinner size={16} />
                  )}
                </span>
                <span className="body">
                  <span className={`tag tag-${beat.tag}`}>{beat.label}</span>
                  <span className="line">{line}</span>
                  <span className={`short show-sm ${tone}`}>{r.short}</span>
                </span>
                <span className="marks hide-sm">
                  {marks.map((m) => (
                    <span key={m.label} className={`mark ${m.state}${m.wide ? " wide" : ""}`}>
                      {m.state === "done" ? <Check /> : m.state === "busy" || m.state === "retry" ? <Spinner size={14} width={3.5} /> : m.state === "fail" ? <Cross /> : <Circle />}
                      {m.label}
                    </span>
                  ))}
                </span>
                <button type="button" className="voice" onClick={() => toggle(s)} disabled={!s.audioUrl} aria-label={playing === s.id ? `Pause the narration for scene ${r.n}` : `Play the narration for scene ${r.n}`} aria-pressed={playing === s.id}>
                  {playing === s.id ? <PauseIcon /> : <PlayIcon />}
                </button>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mk-empty">The storyboard shows up here once the script is written.</p>
      )}
    </section>
  );
}

function WaitCard() {
  const [perm, setPerm] = useState<string>("unknown");
  useEffect(() => {
    setPerm(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  }, []);
  const on = perm === "granted";
  return (
    <section className="mk-card mk-wait hide-sm" aria-labelledby="wait-h">
      <h2 id="wait-h">No need to wait here</h2>
      <p>It keeps going if you close this tab. Come back to this link any time. The tab title shows how far along it is.</p>
      <div className="mk-actions">
        {perm !== "unsupported" && perm !== "denied" && (
          <button type="button" className={`btn-outline${on ? " pressed" : ""}`} aria-pressed={on} onClick={() => !on && Notification.requestPermission().then(setPerm)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></svg>
            {on ? "We'll notify you" : "Notify me when it's ready"}
          </button>
        )}
        <CopyLink />
      </div>
      {on && <p className="mk-fine">You'll get a browser notification, as long as one Unfold tab stays open.</p>}
    </section>
  );
}

function CopyLink() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn-outline"
      onClick={() => navigator.clipboard?.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); })}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
      {copied ? "Link copied" : "Copy link"}
    </button>
  );
}

/** Copies what whoever runs the site needs to look into it. */
function ReportProblem({ projectId, stage, error }: { projectId: string; stage: string; error: string }) {
  const [copied, setCopied] = useState(false);
  const report = () => {
    const text = `Unfold: a video stopped\nProject: ${projectId}\nPage: ${location.href}\nStopped at: ${stage}\nError: ${error}\nWhen: ${new Date().toISOString()}`;
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 3000); });
  };
  return (
    <button type="button" className="btn-quiet" onClick={report}>{copied ? "Details copied, paste them to whoever runs this site" : "Report a problem"}</button>
  );
}

function GoalCard({ brief }: { brief: NonNullable<LiveState["brief"]> }) {
  const goal = brief.learningGoal.replace(/^After watching,?\s*(the viewer|you)\s+can\s*/i, "");
  const tone = brief.tone.charAt(0).toUpperCase() + brief.tone.slice(1);
  return (
    <section className="mk-card" aria-labelledby="goal-h">
      <h2 id="goal-h" className="eyebrow">By the end you'll be able to</h2>
      <p className="mk-goal">{goal.charAt(0).toUpperCase() + goal.slice(1)}</p>
      <div className="mk-chips">
        {brief.style === "math" && <span className="mk-chip">Mathematical</span>}
        <span className="mk-chip">{LEVEL_LABEL[brief.level] ?? brief.level}</span>
        <span className="mk-chip">{tone} tone</span>
        {brief.lengthS && <span className="mk-chip">About {Math.max(1, Math.round(brief.lengthS / 60))} min</span>}
      </div>
    </section>
  );
}

function WhileYouWait({ facts, quiz }: { facts: LiveState["facts"]; quiz: LiveState["quiz"] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || facts.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % facts.length), 9000);
    return () => clearInterval(t);
  }, [paused, facts.length]);
  const f = facts.length ? facts[i % facts.length] : null;
  return (
    <section className="mk-card mk-while" aria-labelledby="ww-h" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="mk-while-head">
        <h2 id="ww-h" className="eyebrow">While you wait</h2>
        {facts.length > 1 && (
          <div className="mk-pager">
            <button type="button" aria-label="Previous fact" onClick={() => setI((x) => (x - 1 + facts.length) % facts.length)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
            </button>
            <span className="mono">{(i % facts.length) + 1}/{facts.length}</span>
            <button type="button" aria-label="Next fact" onClick={() => setI((x) => (x + 1) % facts.length)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
            </button>
          </div>
        )}
      </div>
      {f && (
        <>
          <p key={f.text} className="mk-fact appear">{f.text}</p>
          {f.domain && <p className="mk-fact-source">— {f.domain}</p>}
        </>
      )}
      {quiz.length > 0 && (
        <div className={f ? "mk-quiz divided" : "mk-quiz"}>
          <MythOrFact items={quiz} />
        </div>
      )}
    </section>
  );
}

const AVATARS = ["#B5E36B", "#E07A5F", "#A8D46F", "#B98CF2", "#E58AD6", "#8E9BF2", "#F2CC5B", "#6FD3C1", "#FFB37A", "#8EC5FF"];
function avatar(domain: string) {
  let h = 0;
  for (const c of domain) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATARS[h % AVATARS.length];
}

function Sources({ sources }: { sources: LiveState["sources"] }) {
  const [all, setAll] = useState(false);
  const shown = all ? sources : sources.slice(0, 6);
  return (
    <section className="mk-card mk-sources" aria-labelledby="src-h">
      <div className="mk-sources-head">
        <h2 id="src-h" className="eyebrow">Sources</h2>
        <span className="mk-count mono">{sources.length}</span>
      </div>
      <ul>
        {shown.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer">
              <span className="av" style={{ background: avatar(s.domain) }}>{s.domain.charAt(0).toUpperCase()}</span>
              <span className="txt">
                <span className="t">{s.title && s.title !== s.url ? cleanSourceTitle(s.title) : s.domain}</span>
                <span className="d">{s.domain}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>
      {sources.length > 6 && (
        <button type="button" className="btn-quiet" onClick={() => setAll((a) => !a)}>{all ? "Show fewer" : `Show all ${sources.length}`}</button>
      )}
    </section>
  );
}
