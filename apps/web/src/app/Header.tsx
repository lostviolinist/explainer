import Link from "next/link";

/** The Unfold mark: a play button with its top-left corner folded down like a dog-eared page. */
export function Mark({ size = 28, onLight = false }: { size?: number; onLight?: boolean }) {
  const [body, flap] = onLight ? ["#766DB3", "#A99BFF"] : ["#A99BFF", "#DDD7FF"];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <path d="M12.9 8 L27 16 L6 28 L6 12 Z" fill={body} stroke={body} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M6 12 L12.9 8 L13 15.9 Z" fill={flap} stroke={flap} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** Logo left, a short nav right. `wide` matches the 1280px pages. */
export function Header({ wide = false, nav }: { wide?: boolean; nav?: React.ReactNode }) {
  return (
    <header className={`site-header${wide ? " wide" : ""}`}>
      <Link href="/" className="brand" aria-label="Unfold home">
        <Mark />
        Unfold
      </Link>
      <nav className="site-nav" aria-label="Main">
        {nav ?? <Link href="/#recent">Recent</Link>}
      </nav>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <span>Unfold</span>
      <span>Every video is researched, checked and cites its sources.</span>
    </footer>
  );
}
