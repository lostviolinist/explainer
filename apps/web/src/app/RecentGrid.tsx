"use client";

import Link from "next/link";
import { useState } from "react";
import type { GalleryItem } from "@/lib/gallery";
import { clock, styleLabel } from "@/lib/titles";
import { Mark } from "./Header";

const FIRST = 5; // the featured card and four more fill the 4-column grid

/** The thumbnail: the poster still, else a frame from the middle of the video (never its empty first frame). */
function Thumb({ p, big }: { p: GalleryItem; big?: boolean }) {
  const math = p.style === "math";
  const mid = p.durationS ? Math.max(1, Math.round(p.durationS / 2)) : 1;
  return (
    <div className={`thumb${math ? " math" : ""}`}>
      {p.poster ? (
        <img src={p.poster} alt="" loading={big ? "eager" : "lazy"} />
      ) : p.videoUrl ? (
        <video src={`${p.videoUrl}#t=${mid}`} preload="metadata" muted playsInline aria-hidden />
      ) : (
        <span className="mark"><Mark size={big ? 64 : 40} onLight={!math} /></span>
      )}
      {p.durationS ? <span className="length">{clock(p.durationS)}</span> : null}
    </div>
  );
}

export function RecentGrid({ items }: { items: GalleryItem[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, FIRST);
  return (
    <>
      <div className="recent-grid">
        {shown.map((p, i) => (
          <Link key={p.id} href={`/p/${p.id}`} className={`vcard${i === 0 ? " feature" : ""}`}>
            <Thumb p={p} big={i === 0} />
            <div>
              <h3>{p.title}</h3>
              <p>{styleLabel(p.style)}{i === 0 && p.sourceCount ? ` · ${p.sourceCount} sources` : ""}</p>
            </div>
          </Link>
        ))}
      </div>
      {items.length > FIRST && !all && (
        <div className="show-all">
          <button type="button" className="chip" onClick={() => setAll(true)}>Show all {items.length}</button>
        </div>
      )}
    </>
  );
}
