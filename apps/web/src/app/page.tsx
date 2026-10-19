import Link from "next/link";
import { AskForm } from "./AskForm";
import { recentVideos } from "@/lib/gallery";
import { preflight } from "@/lib/preflight";
import { version } from "@/lib/version";

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

export const dynamic = "force-dynamic";

export default async function Home() {
  // Warm the setup check while the visitor types, so submitting doesn't wait for it.
  void preflight().catch(() => undefined);
  const recent = await recentVideos(8);
  return (
    <main>
      <h1>What do you want to <span className="grad">understand</span>?</h1>
      <p className="sub">Type a topic or a question. In about ten minutes you get a short animated explainer, researched and sourced, and you can watch it being made.</p>
      <AskForm />
      {recent.length > 0 && (
        <div className="recent">
          <div className="eyebrow">Made here, recently</div>
          <div className="gallery">
            {recent.map((p) => (
              <Link key={p.id} href={`/p/${p.id}`} className="gallery-card">
                <div className={`thumb ${p.style === "math" ? "math" : ""}`}>
                  {p.poster ? <img src={p.poster} alt="" /> : <span className="thumb-mark">{p.style === "math" ? "∑" : "▶"}</span>}
                  {p.durationS && <span className="length">{clock(p.durationS)}</span>}
                </div>
                <span className="q">{p.question}</span>
              </Link>
            ))}
          </div>
        </div>
      )}
      <footer className="version" title="Which code this site is running: git commit, branch, build time">
        {version.label}
      </footer>
    </main>
  );
}
