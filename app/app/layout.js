import './app-shell.css';
import NativeShellCookie from '@/components/shell/NativeShellCookie';

export const metadata = {
  title: 'Sportsvyn — App',
  description: 'Sportsvyn mobile app shell.',
  robots: { index: false, follow: false },
};

// /app runs inside the Capacitor native shell, so override the root
// viewport to viewport-fit:cover. Without this, env(safe-area-inset-*)
// returns 0 in iOS and the bottom nav lands under the home indicator.
export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0A0A0A',
};

export default function AppLayout({ children }) {
  return (
    <div className="sv-app">
      {/* 3.1.1: marks the native container so server components across the whole
          site suppress purchase paths. See the component for why /app needs this
          (capacitor allowNavigation makes every sportsvyn.com page in-app). */}
      <NativeShellCookie />
      {children}
    </div>
  );
}
