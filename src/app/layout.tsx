import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  axes: ["opsz"],
});
const jbMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono" });

export const metadata: Metadata = {
  title: "Recovery Ledger",
  description:
    "One ledger for every unrecovered rupee: failed recurring debits and disputes.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${jbMono.variable}`}
    >
      <body className="flex min-h-screen flex-col bg-paper text-ink">
        <header className="border-b border-headerline bg-header">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3.5">
            <Link href="/" className="flex items-baseline gap-3">
              <span className="font-display text-[19px] font-medium tracking-tight text-white">
                Recovery&nbsp;Ledger
              </span>
              <span className="hidden font-mono text-[11px] tracking-wide text-paperdim sm:inline">
                every unrecovered rupee, one table
              </span>
            </Link>
            <nav className="flex items-center gap-6 text-[13px] font-medium">
              <Link href="/" className="text-paperdim transition-colors hover:text-white">
                Ledger
              </Link>
              <Link
                href="/replay"
                className="text-paperdim transition-colors hover:text-white"
              >
                Replay
              </Link>
              <Link
                href="/benchmark"
                className="text-paperdim transition-colors hover:text-white"
              >
                Benchmark
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
          {children}
        </main>
        <footer className="border-t border-line">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-2 px-6 py-4">
            <span className="font-mono text-[11px] text-faint">
              npm run bench · seeded end to end, byte-identical on any machine
            </span>
            <span className="font-mono text-[11px] text-faint">
              params frozen at 551c340
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
