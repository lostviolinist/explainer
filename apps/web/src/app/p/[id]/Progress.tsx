"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LiveScene, LiveState } from "@/lib/live";
import { ask } from "@/app/actions";
import { PendingButton, PendingNote } from "@/app/pending";

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
  { key: "intake", label: "Understanding" },
  { key: "research", label: "Researching" },
  { key: "script", label: "Writing" },
  { key: "visuals", label: "Illustrating" },
  { key: "assemble", label: "Editing" },
] as const;

/** Share of the whole run each stage takes, from typical timings. */
const SPAN: Record<string, [number, number]> = {
  queued: [0, 0.02],
  intake: [0.02, 0.05],
  research: [0.05, 0.3],
  script: [0.3, 0.42],
  visuals: [0.42, 0.88],
  assemble: [0.88, 1],
  done: [1, 1],
  failed: [1, 1],
};
const TYPICAL_MIN = 10;

const BEAT_LABEL: Record<string, string> = {
  hook: "Hook",
  ground: "Grounding",
  misconception: "Myth-buster",
  "build-up": "Build-up",
  core: "Core idea",
  payoff: "Payoff",
  recap: "Recap",
};
const LEVEL_LABEL: Record<string, string> = { nothing: "Beginner", basics: "Some background", deep: "Deep dive" };
const PROGRAMMATIC = new Set(["chart", "text"]);
/** Scenes whose animation is written as code (Manim / three.js / flat motion graphics): no still, just the render. */
const CODED = new Set(["manim", "three", "motion"]);
/** Scenes whose still gets motion afterwards (a Hedra clip, or callouts animated over a diagram). */
const MOVING = new Set(["still-animated", "clip", "reference-seq", "diagram"]);

/** Watch the video get made: stages, live storyboard, sources, facts and a quiz while you wait. */
export function Progress({ projectId, question, initial, initialLive }: { projectId: string; question: string; initial: Ev[]; initialLive: LiveState }) {
  const router = useRouter();
  const [events, setEvents] = useState<Ev[]>(initial);
  const [live, setLive] = useState<LiveState>(initialLive);
  const [now, setNow] = useState(0); // set after mount, so server and client render alike
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
          notifyDone(question);
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
  }, [projectId, question, router, loadLive]);

  const last = events.at(-1);
  const stage = last?.stage === "queued" || !last ? "intake" : last.stage;
  const failed = last?.stage === "failed";
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

  // Overall progress: stage spans, refined by finished scene work, and eased while rendering. Never goes backwards.
  const maxPct = useRef(0);
  const pct = useMemo(() => {
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
    const v = last?.stage === "done" ? 1 : lo + (hi - lo) * Math.min(1, within);
    maxPct.current = Math.max(maxPct.current, v);
    return maxPct.current;
  }, [last, stage, view.scenes, now]);

  const elapsedMin = (now - startedAt) / 60000;
  const etaMin = pct > 0.12 ? (elapsedMin * (1 - pct)) / pct : TYPICAL_MIN * (1 - pct);
  const eta = failed || !now ? "" : pct >= 0.97 ? "almost done" : etaMin < 1.5 ? "about a minute left" : `about ${Math.round(etaMin)} min left`;

  useEffect(() => {
    document.title = failed ? `Failed · ${question}` : `${Math.round(pct * 100)}% · ${question}`;
  }, [pct, failed, question]);

  const stageIdx = STAGES.findIndex((s) => s.key === stage);

  return (
    <div className="studio">
      <section className="studio-head card">
        <ol className="stepper">
          {STAGES.map((s, i) => (
            <li key={s.key} className={failed && i === stageIdx ? "failed" : i < stageIdx || last?.stage === "done" ? "done" : i === stageIdx ? "active" : ""}>
              <span className="dot" />
              {s.label}
            </li>
          ))}
        </ol>
        <div className="meter"><div style={{ width: `${Math.round(pct * 100)}%` }} /></div>
        <div className="status">
          <span className={failed ? "msg error" : "msg"}>{failed ? last?.message : sentence(last?.message ?? "starting")}</span>
          <span className="eta">{eta}</span>
        </div>
        {failed && (
          <form action={ask} className="retry">
            <input type="hidden" name="question" value={question} />
            <PendingButton className="btn primary">Try again</PendingButton>
            <PendingNote />
          </form>
        )}
      </section>

      <div className="studio-grid">
        <div className="studio-main">
          {view.hookLine && (
            <section className="hook card">
              <div className="eyebrow">Your video opens with</div>
              <blockquote>“{view.hookLine}”</blockquote>
            </section>
          )}
          {view.scenes.length > 0 ? (
            <>
              <RoughCut scenes={view.scenes} finished={last?.stage === "done"} />
              <Storyboard scenes={view.scenes} />
            </>
          ) : (
            <>
              <SourceFeed sources={view.sources} active={stage === "research"} />
              <GhostStoryboard />
            </>
          )}
        </div>

        <aside className="studio-side">
          {live.brief && <GoalCard brief={live.brief} />}
          {view.facts.length > 0 && <FactCarousel facts={view.facts} />}
          {live.quiz.length > 0 && <MythQuiz items={live.quiz} />}
          {view.scenes.length > 0 && view.sources.length > 0 && <SourceFeed sources={view.sources} compact />}
          <LeaveAndReturn />
        </aside>
      </div>
    </div>
  );
}

/** "drawing scene 2" → "Drawing scene 2…"; "drew scene 2" → "Drew scene 2". */
function sentence(s: string) {
  const t = s.charAt(0).toUpperCase() + s.slice(1);
  return /[.!?…]$/.test(t) || !/^\w+ing\b/.test(t) ? t : `${t}…`;
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

function notifyDone(question: string) {
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Your explainer is ready", { body: question });
  } catch {}
}

// ---------------------------------------------------------------------------

function GoalCard({ brief }: { brief: NonNullable<LiveState["brief"]> }) {
  const goal = brief.learningGoal.replace(/^After watching,?\s*(the viewer|you)\s+can\s*/i, "");
  return (
    <section className="card goal">
      <div className="eyebrow">By the end you'll be able to</div>
      <p>{goal.charAt(0).toUpperCase() + goal.slice(1)}</p>
      <div className="chips">
        {brief.style === "math" && <span className="chip">3Blue1Brown style</span>}
        <span className="chip">{LEVEL_LABEL[brief.level] ?? brief.level}</span>
        <span className="chip">{brief.tone.charAt(0).toUpperCase() + brief.tone.slice(1)}</span>
        {brief.lengthS && <span className="chip">~{Math.round(brief.lengthS / 60)} min video</span>}
      </div>
    </section>
  );
}

function SourceFeed({ sources, active, compact }: { sources: LiveState["sources"]; active?: boolean; compact?: boolean }) {
  const list = [...sources].reverse();
  return (
    <section className={`card sources-feed${compact ? " compact" : ""}`}>
      <div className="eyebrow">
        {active ? "Reading sources" : "Sources"} {sources.length > 0 && <span className="count">{sources.length}</span>}
      </div>
      {list.length === 0 ? (
        <div className="searching">
          <span className="pulse" /> Searching the web for trustworthy pages…
        </div>
      ) : (
        <ul>
          {(compact ? list.slice(0, 6) : list).map((s) => (
            <li key={s.url} className="appear">
              <span className="favicon" style={{ background: hue(s.domain) }}>{s.domain.charAt(0).toUpperCase()}</span>
              <a href={s.url} target="_blank" rel="noreferrer">
                <span className="title">{s.title && s.title !== s.url ? s.title : s.domain}</span>
                <span className="domain">{s.domain}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function FactCarousel({ facts }: { facts: LiveState["facts"] }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || facts.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % facts.length), 9000);
    return () => clearInterval(t);
  }, [paused, facts.length]);
  const f = facts[i % facts.length]!;
  return (
    <section className="card facts" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="eyebrow">Did you know?</div>
      <p key={f.text} className="fact appear">{f.text}</p>
      <div className="facts-foot">
        <span className="domain">{f.domain ? `— ${f.domain}` : ""}</span>
        {facts.length > 1 && (
          <span className="pager">
            <button type="button" aria-label="Previous fact" onClick={() => setI((x) => (x - 1 + facts.length) % facts.length)}>‹</button>
            {(i % facts.length) + 1}/{facts.length}
            <button type="button" aria-label="Next fact" onClick={() => setI((x) => (x + 1) % facts.length)}>›</button>
          </span>
        )}
      </div>
    </section>
  );
}

function MythQuiz({ items }: { items: LiveState["quiz"] }) {
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

/**
 * The rough cut: the finished scenes, played back to back with their narration
 * and captions, while the final video (music, transitions, sound) still renders.
 * Nothing is rendered for this; it plays the scene assets straight from the bucket.
 */
function RoughCut({ scenes, finished }: { scenes: LiveScene[]; finished: boolean }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const audio = useRef<HTMLAudioElement | null>(null);
  const ready = scenes.filter((s) => s.done && s.audioUrl).length;
  // The contiguous run of finished scenes from the start: that's what can be played in order.
  let playable = 0;
  while (playable < scenes.length && scenes[playable]!.done && scenes[playable]!.audioUrl) playable++;
  const scene = scenes[index];

  useEffect(() => {
    const a = audio.current;
    if (!a || !scene?.audioUrl) return;
    if (playing) a.play().catch(() => setPlaying(false));
    else a.pause();
  }, [playing, index, scene?.audioUrl]);

  if (finished || !playable) return null;

  const next = () => {
    if (index + 1 < playable) {
      setIndex(index + 1);
      setT(0);
    } else setPlaying(false);
  };
  const words = scene?.words ?? [];
  // Caption: the sentence being spoken, with the current word marked.
  const tokens = scene?.narration.split(/\s+/).filter(Boolean) ?? [];
  let current = -1;
  words.forEach((w, i) => {
    if (w.start <= t) current = i;
  });
  let from = 0;
  let to = tokens.length - 1;
  for (let i = current; i >= 0; i--) if (i < current && /[.!?]["')\]]?$/.test(tokens[i]!)) { from = i + 1; break; }
  for (let i = Math.max(current, 0); i < tokens.length; i++) if (/[.!?]["')\]]?$/.test(tokens[i]!)) { to = i; break; }

  return (
    <section className="card roughcut">
      <div className="section-head">
        <h2>Rough cut</h2>
        <span className="small">{playable} of {scenes.length} scenes · no music or transitions yet</span>
      </div>
      <div className="roughcut-frame">
        {scene?.clipUrl ? <video key={scene.id} src={scene.clipUrl} muted loop autoPlay playsInline /> : scene?.stillUrl ? <img key={scene.id} src={scene.stillUrl} alt="" /> : <div className="shimmer" />}
        {current >= 0 && (
          <div className="roughcut-caption">
            {tokens.slice(from, to + 1).map((w, k) => (
              <span key={k} className={from + k === current ? "now" : from + k < current ? "said" : ""}>{w} </span>
            ))}
          </div>
        )}
        <audio ref={audio} src={scene?.audioUrl} onTimeUpdate={(e) => setT(e.currentTarget.currentTime)} onEnded={next} />
      </div>
      <div className="roughcut-controls">
        <button type="button" className="btn" onClick={() => setPlaying(!playing)}>{playing ? "❚❚ Pause" : index === 0 && t === 0 ? "▶ Watch the rough cut" : "▶ Resume"}</button>
        <span className="small">Scene {index + 1} of {scenes.length}{ready < scenes.length ? " · the rest is still being made" : ""}</span>
        <span className="roughcut-dots">
          {scenes.map((s, i) => (
            <button key={s.id} type="button" className={i === index ? "on" : i < playable ? "" : "off"} disabled={i >= playable} onClick={() => { setIndex(i); setT(0); }} aria-label={`Scene ${i + 1}`} />
          ))}
        </span>
      </div>
    </section>
  );
}

function sceneStatus(s: LiveScene): { label: string; tone: "wait" | "work" | "ready" } {
  if (s.done) return { label: "Ready", tone: "ready" };
  if (PROGRAMMATIC.has(s.visualType)) return s.audioUrl ? { label: "Built in the edit", tone: "ready" } : { label: "Recording voice", tone: "work" };
  if (CODED.has(s.visualType)) return s.clipUrl ? { label: "Ready", tone: "ready" } : { label: s.audioUrl ? (s.visualType === "three" ? "Building 3D scene" : "Writing animation") : "Recording voice", tone: "work" };
  if (!s.stillUrl) return { label: s.audioUrl ? "Drawing" : "Recording voice", tone: "work" };
  if (MOVING.has(s.visualType) && !s.clipUrl) return { label: "Animating", tone: "work" };
  return { label: "Checking", tone: "work" };
}

function Storyboard({ scenes }: { scenes: LiveScene[] }) {
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
  const ready = scenes.filter((s) => s.done).length;

  return (
    <section className="storyboard">
      <div className="section-head">
        <h2>Storyboard</h2>
        <span className="small">{ready}/{scenes.length} scenes ready</span>
      </div>
      <div className="scenes">
        {scenes.map((s, n) => {
          const st = sceneStatus(s);
          return (
            <article key={s.id} className="scene">
              <div className="thumb">
                {s.clipUrl ? (
                  <video src={s.clipUrl} muted loop autoPlay playsInline className="appear" />
                ) : s.stillUrl ? (
                  <img src={s.stillUrl} alt="" className="appear" />
                ) : PROGRAMMATIC.has(s.visualType) ? (
                  <div className="programmatic">{s.visualType === "chart" ? "Chart" : "Title card"}<span>animated in the edit</span></div>
                ) : (
                  <div className="shimmer" />
                )}
                <span className="num">{n + 1}</span>
                <span className={`badge ${st.tone}`}>{st.tone === "work" && <span className="spin" />}{st.label}</span>
              </div>
              <div className="scene-body">
                <div className="scene-top">
                  <span className={`beat beat-${s.beat}`}>{BEAT_LABEL[s.beat] ?? s.beat}</span>
                  {s.audioUrl && (
                    <button type="button" className="play" onClick={() => toggle(s)} aria-label={playing === s.id ? "Pause narration" : "Play narration"}>
                      {playing === s.id ? "❚❚" : "▶"} <span>voice</span>
                    </button>
                  )}
                </div>
                <p>{s.narration}</p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function GhostStoryboard() {
  return (
    <section className="storyboard ghost">
      <div className="section-head">
        <h2>Storyboard</h2>
        <span className="small">appears once the script is written</span>
      </div>
      <div className="scenes">
        {Array.from({ length: 6 }, (_, i) => (
          <article key={i} className="scene">
            <div className="thumb"><div className="shimmer" /></div>
            <div className="scene-body"><div className="line" /><div className="line short" /></div>
          </article>
        ))}
      </div>
    </section>
  );
}

function LeaveAndReturn() {
  const [perm, setPerm] = useState<string>("unknown");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setPerm(typeof Notification !== "undefined" ? Notification.permission : "unsupported");
  }, []);
  return (
    <section className="card leave">
      <div className="eyebrow">No need to wait here</div>
      <p className="small">It keeps going if you close this tab. Come back to this link any time.</p>
      <div className="leave-actions">
        {perm === "default" && (
          <button type="button" className="btn ghost small-btn" onClick={() => Notification.requestPermission().then(setPerm)}>Notify me when ready</button>
        )}
        {perm === "granted" && <span className="small">✓ We'll notify you (keep the tab open)</span>}
        <button
          type="button"
          className="btn ghost small-btn"
          onClick={() => navigator.clipboard?.writeText(location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); })}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </section>
  );
}

/** A stable, pleasant colour per domain for the source avatars. */
function hue(domain: string) {
  let h = 0;
  for (const c of domain) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 60%), hsl(${(h + 40) % 360} 70% 50%))`;
}
