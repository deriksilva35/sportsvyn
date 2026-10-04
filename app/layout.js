import localFont from "next/font/local";
import "./globals.css";
import "./fonts/latin-ext.css";
import AppTabBar from '@/components/shell/AppTabBar';
import AppHeader from '@/components/shell/AppHeader';
import ResumeManager from '@/components/shell/ResumeManager';
import SplashReady from '@/components/shell/SplashReady';
import { Analytics } from '@vercel/analytics/next';
import '@/components/shell/apptab.css';
import { firstPaintColor, dataTheme, shellThemeScript } from '@/lib/brand/theme';
import { SHELL_COOKIE, SHELL_VALUE } from '@/lib/shell/constants';

// THE FACES ARE SELF-HOSTED (sun-12 item 4). They were next/font/google, which
// fetches from Google DURING THE BUILD; that fetch failed a production build on
// 1 Oct and two previews on 3-4 Oct ("Can't resolve ...font/google/font"). The
// files in app/fonts/ are the exact Latin woff2 Google served for these weights
// (OFL - the licences sit beside them), so a build never touches the network.
// Each family keeps its CSS variable, display: swap, preload and the same
// metric-adjusted fallback (Arial, or Times New Roman for the serif - what
// next/font/google picked). JetBrains Mono, Archivo and Rubik are variable
// fonts: Google served one file for every weight, so each weight is its own
// @font-face on that one file, as before. The options are literals: next/font
// rejects anything computed. lib/brand/fontsLocal.test.mjs keeps
// next/font/google out.
//
// THE SUBSETS (sun-13). Each loader is Google's "latin" file with Google's
// latin unicode-range; ./fonts/latin-ext.css adds the "latin-ext" file of every
// face under the same family names, so names like Dončić and Szczęsny render in
// the brand face. The browser fetches an -ext file only when a glyph needs it.
//
// THE FAMILY NAME. next/font/local names a face after the const ("saira",
// "sairaCondensed"), and Turbopack builds the --font-* variable from that name
// even when a font-family declaration renames the face - so the variable fonts
// below carry NO declaration, or the variable would point at a face that does
// not exist. Single-word names still match the stylesheets that write 'Saira',
// 'Archivo' or 'Rubik' (family names match case-insensitively). The four
// MULTI-WORD names are written literally in ~90 places ('Saira Condensed',
// 'JetBrains Mono', 'Source Serif 4', 'Rubik Mono One'); the *Face loaders at
// the end of this block declare those names over the SAME files with the same
// options, so the emitted URL is the same and nothing downloads twice.
const saira = localFont({
  variable: "--font-saira",
  src: [
    { path: "./fonts/Saira-900.woff2", weight: "900", style: "normal" },
    { path: "./fonts/Saira-900Italic.woff2", weight: "900", style: "italic" },
  ],
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
  display: "swap",
});

const sourceSerif = localFont({
  variable: "--font-source-serif",
  src: [{ path: "./fonts/SourceSerif4-400Italic.woff2", weight: "400", style: "italic" }],
  adjustFontFallback: "Times New Roman",
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
  display: "swap",
});

const jetbrainsMono = localFont({
  variable: "--font-jetbrains-mono",
  src: [
    { path: "./fonts/JetBrainsMono-wght.woff2", weight: "400", style: "normal" },
    { path: "./fonts/JetBrainsMono-wght.woff2", weight: "500", style: "normal" },
    { path: "./fonts/JetBrainsMono-wght.woff2", weight: "700", style: "normal" },
  ],
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
  display: "swap",
});

// Added for the gridiron surfaces (design tokens v1.1). Additive: new CSS
// variables on <html>; existing pages do not reference them, so they render
// identically.
const sairaCondensed = localFont({
  variable: "--font-saira-condensed",
  src: [
    { path: "./fonts/SairaCondensed-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/SairaCondensed-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/SairaCondensed-700.woff2", weight: "700", style: "normal" },
  ],
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
  display: "swap",
});

const archivo = localFont({
  variable: "--font-archivo",
  src: [
    { path: "./fonts/Archivo-wght.woff2", weight: "400", style: "normal" },
    { path: "./fonts/Archivo-wght.woff2", weight: "500", style: "normal" },
  ],
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
  display: "swap",
});

// THE ARCADE FACES (rebrand R0, 28 Sep). Rubik carries display (800/900) and
// body (500/700); Rubik Mono One the numerals. LOADED, NOT USED: nothing reads
// --font-rubik or --font-rubik-mono until R1 points the --tok-font-* roles at
// them (app/globals.css), and preload is off until then so R0 adds no request
// to a page that does not need the file.
const rubik = localFont({
  variable: "--font-rubik",
  src: [
    { path: "./fonts/Rubik-wght.woff2", weight: "500", style: "normal" },
    { path: "./fonts/Rubik-wght.woff2", weight: "700", style: "normal" },
    { path: "./fonts/Rubik-wght.woff2", weight: "800", style: "normal" },
    { path: "./fonts/Rubik-wght.woff2", weight: "900", style: "normal" },
  ],
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
  display: "swap",
  preload: false,
});

const rubikMono = localFont({
  variable: "--font-rubik-mono",
  src: [{ path: "./fonts/RubikMonoOne-400.woff2", weight: "400", style: "normal" }],
  declarations: [{ prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" }],
  display: "swap",
  preload: false,
});

// THE GOOGLE NAMES, for the stylesheets that write them literally (see above).
// Same files and options as the loaders they shadow; the variables are unused.
const sairaCondensedFace = localFont({
  variable: "--font-face-saira-condensed",
  src: [
    { path: "./fonts/SairaCondensed-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/SairaCondensed-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/SairaCondensed-700.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "'Saira Condensed'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
  display: "swap",
});

const sourceSerifFace = localFont({
  variable: "--font-face-source-serif",
  src: [{ path: "./fonts/SourceSerif4-400Italic.woff2", weight: "400", style: "italic" }],
  declarations: [
    { prop: "font-family", value: "'Source Serif 4'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
  adjustFontFallback: "Times New Roman",
  display: "swap",
});

const jetbrainsMonoFace = localFont({
  variable: "--font-face-jetbrains-mono",
  src: [
    { path: "./fonts/JetBrainsMono-wght.woff2", weight: "400", style: "normal" },
    { path: "./fonts/JetBrainsMono-wght.woff2", weight: "500", style: "normal" },
    { path: "./fonts/JetBrainsMono-wght.woff2", weight: "700", style: "normal" },
  ],
  declarations: [
    { prop: "font-family", value: "'JetBrains Mono'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
  display: "swap",
});

const rubikMonoFace = localFont({
  variable: "--font-face-rubik-mono",
  src: [{ path: "./fonts/RubikMonoOne-400.woff2", weight: "400", style: "normal" }],
  declarations: [
    { prop: "font-family", value: "'Rubik Mono One'" },
    { prop: "unicode-range", value: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD" },
  ],
  display: "swap",
  preload: false,
});

export const metadata = {
  title: "Sportsvyn",
  description: "Sports editorial. Read the Game.",
  // R3 ICONS (mock-app brand/web @ 84ae53d, README "Markup"): the SVG first,
  // the two PNGs for browsers that do not take an SVG icon, the 180 for iOS
  // (square and opaque - iOS applies its own mask). The manifest is
  // app/manifest.js. /favicon.ico (public/) is the same 16 and 32 PNGs packed
  // as an ICO, for the request browsers make without reading any of this.
  icons: {
    icon: [
      { url: '/brand/favicon.svg', type: 'image/svg+xml' },
      { url: '/brand/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/brand/favicon-16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: [{ url: '/brand/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
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

/**
 * THE APP TAB BAR GATES ITSELF, ON THE CLIENT, and that is a deliberate
 * second choice. The obvious version reads resolveShellMode() here and renders
 * nothing on the web - but resolveShellMode reads cookies(), and cookies() in
 * the ROOT layout makes every page in the app dynamic. It did: /privacy,
 * /terms and /signin/check-email all went from prerendered to server-rendered
 * on the build that tried it, to gate one bar that only the container ever
 * sees. So the gate moved into the component, which reads the same cookie in
 * an effect and renders null without it. Web output is unchanged; the static
 * pages stay static.
 */
export default function RootLayout({ children }) {
  // THE APP FLIP (tue-0): with ARCADE_SHELL on, this script - first in <head>,
  // run before any frame - gives shell requests data-theme="arcade" and the
  // white ground in one tick. Null (no tag at all) when the flag is off.
  const shellScript = shellThemeScript(process.env, { cookie: SHELL_COOKIE, value: SHELL_VALUE });
  return (
    <html
      lang="en"
      // The shell script above may set data-theme and the ground before
      // hydration; React must not warn about (or undo) that on <html> alone.
      suppressHydrationWarning
      data-theme={dataTheme()}
      // THE FIRST-PAINT GROUND: the page colour before any stylesheet has
      // loaded - lib/brand/theme.js firstPaintColor.
      style={{ backgroundColor: firstPaintColor() }}
      className={`${saira.variable} ${sairaCondensed.variable} ${sourceSerif.variable} ${jetbrainsMono.variable} ${archivo.variable} ${rubik.variable} ${rubikMono.variable} ${sairaCondensedFace.variable} ${sourceSerifFace.variable} ${jetbrainsMonoFace.variable} ${rubikMonoFace.variable} h-full antialiased`}
    >
      {shellScript ? (
        <head>
          {/* A fixed, build-time string from lib/brand/theme.js - no user input. */}
          <script id="sv-shell-theme" dangerouslySetInnerHTML={{ __html: shellScript }} />
        </head>
      ) : null}
      <body className="min-h-full flex flex-col">
        {/* HEADER ABOVE, TAB BAR BELOW, one gate on both. Mounted here rather
            than inside GlobalHeader because the /sim routes never render that
            component - see components/shell/AppHeader. */}
        <AppHeader />
        {/* Shell-only, self-gating like the header and bar: owns where an app
            ACTIVATION lands (the opens that never load a document). */}
        <ResumeManager />
        {/* The native splash goes after the first paint - components/shell/SplashReady. */}
        <SplashReady />
        {children}
        <AppTabBar />
        {/* WEB ANALYTICS. The project-level feature was already provisioned;
            what was missing was the client script, so nine days of App Store
            launch traffic went unmeasured - join-link arrivals, /pickem
            interest and lobby engagement all invisible. Aggregate and
            cookieless by design: pageview, route, referrer, country, device.
            No user id, no handle, no session id rides this - see the
            analytics pin. */}
        <Analytics />
      </body>
    </html>
  );
}
