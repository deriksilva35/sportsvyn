import { Saira, Saira_Condensed, Source_Serif_4, JetBrains_Mono, Archivo } from "next/font/google";
import "./globals.css";

const saira = Saira({
  variable: "--font-saira",
  weight: "900",
  style: ["normal", "italic"],
  subsets: ["latin"],
  display: "swap",
});

const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  weight: "400",
  style: "italic",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
  display: "swap",
});

// Added for the gridiron surfaces (design tokens v1.1). Additive: new CSS
// variables on <html>; existing pages do not reference them, so they render
// identically.
const sairaCondensed = Saira_Condensed({
  variable: "--font-saira-condensed",
  weight: ["500", "600", "700"],
  style: "normal",
  subsets: ["latin"],
  display: "swap",
});

const archivo = Archivo({
  variable: "--font-archivo",
  weight: ["400", "500"],
  subsets: ["latin"],
  display: "swap",
});

export const metadata = {
  title: "Sportsvyn",
  description: "Sports editorial. Read the Game.",
};

// Next.js App Router requires viewport to be exported separately from
// metadata (it was deprecated as a metadata field in Next 14). Without
// this, real mobile browsers fall back to a ~980px layout viewport and
// scale the desktop layout down — everything looks tiny + cramped.
// device-width + initialScale:1 makes the page render at the device's
// actual CSS pixel width, the way every site has been doing since 2010.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${saira.variable} ${sairaCondensed.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} ${archivo.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
