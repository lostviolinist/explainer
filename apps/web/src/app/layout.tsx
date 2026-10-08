import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Explainer",
  description: "Ask a question. Get a short animated explainer, with sources.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
