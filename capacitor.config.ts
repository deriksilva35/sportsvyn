import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sportsvyn.app',
  appName: 'Sportsvyn',
  webDir: 'www',
  server: {
    url: 'https://sportsvyn.com',
    cleartext: false,
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
