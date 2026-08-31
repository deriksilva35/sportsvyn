import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sportsvyn.app',
  appName: 'Sportsvyn',
  webDir: 'www',
  server: {
    url: 'https://sportsvyn.com/app',
    cleartext: false,
    allowNavigation: ['sportsvyn.com'],
    // THE ONLY THING IN A REQUEST THAT SAYS "THIS IS THE APP".
    //
    // The binary loads /app with no query string, so the server has no way to
    // tell the container from a browser opening the same URL - and it must not
    // guess, because /app is a real web page. Shell mode on /app was therefore
    // decided CLIENT-side (components/shell/NativeShellCookie feature-detects
    // window.Capacitor, writes the cookie, reloads), which means the first
    // server render of every cold open happened in web mode.
    //
    // This token puts the answer in the request. proxy.js reads it and sets
    // sv_shell before anything renders, closing that gap for /app and for every
    // sportsvyn.com page reachable through allowNavigation above.
    //
    // IT TAKES EFFECT ONLY IN A NEW BINARY - same constraint as errorPath
    // below. Installed copies keep the client-side path, which still works, so
    // this is safe to land ahead of any build. Nothing here forces one.
    appendUserAgent: 'SportsvynApp/1',
    // Shown when a navigation to sportsvyn.com fails outright, including the
    // reload Capacitor issues after iOS terminates the web content process.
    // Without it, didFailProvisionalNavigation only logs and the reader is left
    // on WebKit's unbranded "couldn't load" page with no way back.
    //
    // Resolved against the LOCAL bundle (localURL + errorPath), never the remote
    // server - see www/error.html for why that is the only thing that could work
    // here, and note the consequence: this takes effect only in a NEW BINARY.
    errorPath: 'error.html',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: 'LIGHT',
      backgroundColor: '#0A0A0A',
    },
  },
};

export default config;
