import type { Metadata } from "next";
import { Archivo, Geist, Geist_Mono, IBM_Plex_Mono } from "next/font/google";
import { ThemeProvider } from "@/providers/theme-provider";

import "./globals.css";
// The Workshop Due Book design system. Scoped to .duebook, so it is inert until
// a page opts in — but loaded here so the landing page, login and register can
// look like the product instead of like three different applications.
import "./due-book.css";
import { TanstackQueryProvider } from "@/providers/tanstack-query-provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Archivo carries the width axis the design leans on (font-variation-settings).
const archivo = Archivo({
  subsets: ["latin"],
  axes: ["wdth"],
  variable: "--font-archivo",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Workshop Due Book",
  description:
    "Vehicle service due predictor — daily call list, service register and 8-week workload for a car servicing workshop in Dhaka.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: next-themes' inline script stamps the theme on
    // <html> before React hydrates, so server and client markup differ by design
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${archivo.variable} ${plexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider attribute="class">
          <TanstackQueryProvider>{children}</TanstackQueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
