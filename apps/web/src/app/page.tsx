import Link from "next/link";
import { AskForm } from "./AskForm";
import { Footer, Header, Mark } from "./Header";
import { RecentGrid } from "./RecentGrid";
import { inProgress, recentVideos } from "@/lib/gallery";
import { preflight } from "@/lib/preflight";

export const dynamic = "force-dynamic";

export default async function Home() {
  // Warm the setup check while the visitor types, so submitting doesn't wait for it.
  void preflight().catch(() => undefined);
  const [recent, making] = await Promise.all([recentVideos(24), inProgress(4)]);
  return (
    <>
      <Header />
      <main className="home">
        <section className="home-section hero" aria-labelledby="hero-h">
          <h1 id="hero-h">What do you want to <span className="accent">understand</span>?</h1>
          <p className="lede">Type a topic or a question. In about ten minutes you get a short animated explainer, researched and sourced, and you can watch it being made.</p>
          <AskForm />
        </section>

        {making.length > 0 && (
          <section className="home-section making" aria-labelledby="wip-h">
            <h2 id="wip-h">Still being made</h2>
            {making.map((m) => (
              <Link key={m.id} href={`/p/${m.id}`} className="making-card">
                <span className="thumb">{m.poster ? <img src={m.poster} alt="" /> : <Mark size={36} onLight={m.style !== "math"} />}</span>
                <span className="body">
                  <span className="title">{m.title}</span>
                  <span className="bar">
                    <span className="track"><span className="fill" style={{ width: `${Math.round(m.pct * 100)}%` }} /></span>
                    <span className="pct">{Math.round(m.pct * 100)}%</span>
                  </span>
                  <span className="meta">
                    {m.stageLabel}
                    {m.scenesTotal ? ` · ${m.scenesReady} of ${m.scenesTotal} scenes ready` : ""} · {m.timeLeft}
                  </span>
                </span>
                <span className="go">
                  Watch it being made
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </span>
              </Link>
            ))}
          </section>
        )}

        <section id="recent" className="home-section recent-section" aria-labelledby="recent-h">
          <div className="recent-head">
            <h2 id="recent-h">Made here recently</h2>
            <p>Open one to watch it, quiz yourself and check the sources</p>
          </div>
          {recent.length ? <RecentGrid items={recent} /> : <div className="empty-recent">Nothing yet. The first video made here will show up in this spot.</div>}
        </section>
      </main>
      <Footer />
    </>
  );
}
