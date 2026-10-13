import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "CheckAm: spot fake drugs",
  description: "Scan a medicine pack to check for signs of a fake, and warn others with tamper-proof reports.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0b7a4b" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="logo" aria-hidden>✓</span> CheckAm
          </Link>
          <nav>
            <Link href="/">Scan</Link>
            <Link href="/alerts">Alerts</Link>
            <Link href="/review">Review</Link>
            <Link href="/about">About</Link>
          </nav>
        </header>
        <main className="container">{children}</main>
        <footer className="footer">
          CheckAm flags warning signs. It can&apos;t prove a medicine is genuine. When in doubt, ask a licensed pharmacist.
        </footer>
      </body>
    </html>
  );
}
