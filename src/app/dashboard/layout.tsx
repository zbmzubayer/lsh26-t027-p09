import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./due-book.css";

// Archivo carries the width axis the design leans on (font-variation-settings:"wdth").
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

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${archivo.variable} ${plexMono.variable}`}>{children}</div>
  );
}
