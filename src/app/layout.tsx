import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import "./globals.css";

const sans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-sans",
});
const serif = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-serif",
});
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

const description = "A person-to-person exchange for BCH and CashTokens. Both lock. One preimage pays both.";

export const metadata: Metadata = {
  metadataBase: new URL("https://atomcash.vercel.app"),
  title: "AtomCash",
  description,
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "AtomCash",
    description,
    url: "/",
    siteName: "AtomCash",
    type: "website",
    images: [{ url: "/banner.png", width: 1200, height: 630, alt: "AtomCash" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "AtomCash",
    description,
    images: ["/banner.png"],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${serif.variable} ${mono.variable}`}>{children}</body>
    </html>
  );
}
