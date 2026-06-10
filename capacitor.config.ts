import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sportsvyn.app',
  appName: 'Sportsvyn',
  webDir: 'www',
  server: {
    url: 'https://sportsvyn.com',
    cleartext: false,
  },
};

export default config;
