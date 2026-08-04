import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sportsvyn.app',
  appName: 'Sportsvyn',
  webDir: 'www',
  server: {
    url: 'https://sportsvyn.com/app',
    cleartext: false,
    allowNavigation: ['sportsvyn.com'],
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
