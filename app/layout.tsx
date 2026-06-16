import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { Providers } from "./providers";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Markup — visual screen review",
  description:
    "Read an application, render its screens on a canvas, annotate specific points, and export a review document for AI or devs.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-card px-5">
            <Link
              href="/"
              className="flex items-center gap-2 text-[15px] font-semibold tracking-tight"
            >
              <span className="inline-block h-5 w-5 rounded bg-accent" />
              Markup
            </Link>
            <span className="ml-1 text-xs text-muted">visual screen review</span>
          </header>
          <main className="min-h-0 flex-1">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
