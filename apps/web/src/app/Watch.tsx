"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { react } from "@/app/actions";
import { PendingButton, PendingNote } from "@/app/pending";
import { AfterVideo } from "@/app/Quiz";
import type { WatchData } from "@/lib/watch";
import { clock, styleLabel } from "@/lib/titles";

/**
 * The finished video: a player with a floating control bar, the title and one
 * meta line, the actions, a follow-up box, the two "Did it land?" cards, and a
 * sidebar with the transcript (click to seek) and the sources.
 */
export function Watch({ data, shared = false }: { data: WatchData; shared?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [current, setCurrent] = useState(0);
  const [tab, setTab] = useState<"transcript" | "sources">("transcript");
  const [copied, setCopied] = useState(false);
  const paras = data.paragraphs;
  let active = 0;
  for (let i = 0; i < paras.length; i++) if (paras[i]!.at <= current + 0.05) active = i;

  const seek = (t: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = t;
    v.play().catch(() => undefined);
  };

  const share = async () => {
    const url = new URL(data.sharePath, location.href).href;
    if (typeof navigator.share === "function" && /Mobi|Android/i.test(navigator.userAgent)) {
      try {
        await navigator.share({ title: data.title, url });
        return;
      } catch {}
    }
    await navigator.clipboard?.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const math = data.style === "math";
  return (
    <div className="wt">
      <div className="wt-main">
        <Player videoRef={video} src={data.videoUrl} poster={data.poster} math={math} durationS={data.durationS} ticks={paras.slice(1).map((p) => p.at)} current={current} onTime={setCurrent} />

        <h1 className="wt-title">{data.title}</h1>
        <div className="wt-meta">
          <span className="wt-chip">{styleLabel(data.style)}</span>
          <span className="mono">{clock(data.durationS)}</span>
          <span>{data.sources.length} source{data.sources.length === 1 ? "" : "s"}</span>
          {data.costUsd > 0 && (
            <span className="wt-cost" title={math ? "Search, writing, voice and the checks" : "Search, writing, voice, pictures and the checks"}>
              ${data.costUsd.toFixed(2)} to make
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>
            </span>
          )}
        </div>
        {data.estimatedCaptions && (
          <p className="wt-fine">
            Caption timing in {data.estimatedCaptions.n} of {data.estimatedCaptions.of} scenes was estimated from the words, not heard: the transcription failed ({data.estimatedCaptions.note}). Whoever runs this site can check the Word timing row at /?setup.
          </p>
        )}

        <div className="wt-actions">
          {shared ? (
            <Link href="/" className="btn-accent">Ask your own question</Link>
          ) : (
            <form action={react} className="wt-another">
              <input type="hidden" name="projectId" value={data.projectId} />
              <span className="wt-another-label">Make another version</span>
              <PendingButton className="wt-tint" name="reaction" value="simpler">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></svg>Simpler
              </PendingButton>
              <PendingButton className="wt-tint" name="reaction" value="deeper">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></svg>Deeper
              </PendingButton>
              <PendingNote>Setting up a new video, the progress page opens in a moment.</PendingNote>
            </form>
          )}
          <div className="wt-tools">
            <button type="button" className="wt-ghost" onClick={share}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 13v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6M12 3v12M7 8l5-5 5 5" /></svg>
              {copied ? "Link copied" : "Share"}
            </button>
            <a className="wt-ghost" href={data.srtUrl} download>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M4 20h16" /></svg>
              Captions (.srt)
            </a>
          </div>
        </div>

        {!shared && (
          <section className="wt-curious" aria-labelledby="fu-h">
            <h2 id="fu-h">Still curious?</h2>
            <form action={react} className="wt-composer">
              <input type="hidden" name="projectId" value={data.projectId} />
              <input type="hidden" name="reaction" value="follow-up" />
              <label htmlFor="fu" className="sr-only">Ask a follow-up question</label>
              <input id="fu" name="followUp" type="text" placeholder="Wait, why does…?" maxLength={300} required autoComplete="off" />
              <PendingButton className="btn-accent wt-ask" pendingText="Starting…">Ask</PendingButton>
            </form>
          </section>
        )}

        <AfterVideo projectId={data.projectId} quiz={data.quiz} question={data.title} />
      </div>

      <aside className="wt-side" aria-label="Transcript and sources">
        <div className="wt-tabs">
          <button type="button" aria-pressed={tab === "transcript"} onClick={() => setTab("transcript")}>Transcript</button>
          <button type="button" aria-pressed={tab === "sources"} onClick={() => setTab("sources")}>
            Sources<span className="mono">{data.sources.length}</span>
          </button>
        </div>
        {tab === "transcript" ? (
          <Transcript paras={paras} active={active} playing={current > 0} onSeek={seek} />
        ) : (
          <ol className="wt-sources">
            {data.sources.map((s, i) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer">
                  <span className="mono n">{i + 1}</span>
                  <span className="txt">
                    <span className={s.title === "Untitled page" ? "t untitled" : "t"}>{s.title}</span>
                    <span className="d">{s.domain}</span>
                  </span>
                </a>
              </li>
            ))}
          </ol>
        )}
      </aside>
    </div>
  );
}

function Transcript({ paras, active, playing, onSeek }: { paras: WatchData["paragraphs"]; active: number; playing: boolean; onSeek: (t: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  // Keep the paragraph being read in view while the video plays.
  useEffect(() => {
    if (!playing) return;
    const el = box.current?.querySelector<HTMLElement>("[aria-current='true']");
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, playing]);
  return (
    <div className="wt-transcript" ref={box}>
      {paras.map((p, i) => (
        <button type="button" key={p.id} className="wt-para" aria-current={i === active && playing ? "true" : undefined} onClick={() => onSeek(p.at)}>
          <span className="mono t">{clock(p.at)}</span>
          <span>{p.text}</span>
        </button>
      ))}
    </div>
  );
}

/** The video with its own control bar: play, time, mute and full screen, and a bar with a tick at every paragraph. */
function Player({ videoRef, src, poster, math, durationS, ticks, current, onTime }: { videoRef: React.RefObject<HTMLVideoElement>; src: string; poster: string | null; math: boolean; durationS: number; ticks: number[]; current: number; onTime: (t: number) => void }) {
  const frame = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [length, setLength] = useState(durationS);
  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
  };
  const seekAt = (e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v) return;
    const r = e.currentTarget.getBoundingClientRect();
    v.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * length;
    v.play().catch(() => undefined);
  };
  const full = () => {
    const el = frame.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else el.requestFullscreen?.().catch(() => undefined);
  };
  const pct = length ? Math.min(100, (current / length) * 100) : 0;
  return (
    <div className={`wt-frame${math ? " math" : ""}`} ref={frame}>
      {/* Captions are part of the picture, so there is nothing to toggle. */}
      <video
        ref={videoRef}
        src={src}
        poster={poster ?? undefined}
        playsInline
        preload="metadata"
        onClick={toggle}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => onTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && setLength(e.currentTarget.duration)}
        onVolumeChange={(e) => setMuted(e.currentTarget.muted)}
      />
      <div className="wt-bar">
        <div className="wt-track" onClick={seekAt} role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(length)} aria-valuenow={Math.round(current)} tabIndex={0}
          onKeyDown={(e) => { const v = videoRef.current; if (!v) return; if (e.key === "ArrowRight") v.currentTime = Math.min(length, v.currentTime + 5); if (e.key === "ArrowLeft") v.currentTime = Math.max(0, v.currentTime - 5); }}>
          <div className="fill" style={{ width: `${pct}%` }} />
          {ticks.map((t) => <span key={t} className="tick" style={{ left: `${(t / length) * 100}%` }} />)}
          <span className="knob" style={{ left: `${pct}%` }} />
        </div>
        <div className="wt-controls">
          <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={toggle}>
            {playing ? <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor" /></svg> : <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor" /></svg>}
          </button>
          <span className="mono time">{clock(current)} / {clock(length)}</span>
          <span className="grow" />
          <button type="button" aria-label={muted ? "Unmute" : "Mute"} aria-pressed={muted} onClick={() => { const v = videoRef.current; if (v) v.muted = !v.muted; }}>
            {muted ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M16 9l5 6M21 9l-5 6" /></svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11" /></svg>
            )}
          </button>
          <button type="button" aria-label="Full screen" onClick={full}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
