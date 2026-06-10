import './app-shell.css';

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
  return <div className="sv-app">{children}</div>;
}
