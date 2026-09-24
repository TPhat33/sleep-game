import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.fireflypond.dev',
  appName: 'Firefly Pond',
  webDir: 'dist',
  backgroundColor: '#0B0806',
  ios: {
    contentInset: 'never',
  },
};

export default config;
