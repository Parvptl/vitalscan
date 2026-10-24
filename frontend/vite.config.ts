/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered manually in src/main.tsx so a blocked service worker (private
      // browsing, embedded webviews, corporate policy) degrades quietly instead
      // of throwing an uncaught rejection. The app works fine without it.
      injectRegister: null,
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'VitalScan',
        short_name: 'VitalScan',
        description:
          'Measure your pulse and related signals with your phone camera. Research prototype - not a medical device.',
        theme_color: '#0f7a6b',
        background_color: '#f6f7f6',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Cache the app shell only. Measurement data and API responses are
        // never cached - health readings must not outlive the session.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
      },
    }),
  ],
  server: {
    // Allow testing from a phone on the same network during development.
    host: true,
  },
  test: {
    // The algorithm parity fixtures are large; the default `forks` pool times
    // out transferring them to the worker on Windows. Threads are stable here
    // and measurably faster.
    pool: 'threads',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
