import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Self-destroying during active development: unregisters any previously
    // installed service worker and clears its caches so deploys are always
    // fresh (no stale UI). Re-enable a precaching PWA before the demo.
    VitePWA({ selfDestroying: true }),
  ],
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
