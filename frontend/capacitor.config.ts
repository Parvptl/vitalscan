import type { CapacitorConfig } from '@capacitor/cli';

/**
 * VitalScan Android shell.
 *
 * The APK bundles the built web assets from `dist/` and runs the rPPG pipeline
 * entirely on the device (`VITE_PROCESSING_MODE=local`), so the app needs no
 * network access at all. There is deliberately no `server.url` here - pointing
 * at a remote origin would reintroduce the internet dependency.
 */
const config: CapacitorConfig = {
  appId: 'com.vitalscan.app',
  appName: 'VitalScan',
  webDir: 'dist',
  android: {
    // Chromium WebView serves the app from https://localhost, which is a
    // secure context - required for getUserMedia and torch control.
    allowMixedContent: false,
  },
};

export default config;
