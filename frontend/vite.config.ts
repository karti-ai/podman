import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  // No service worker in production. We deploy continuously during the event and
  // any SW (even vite-plugin-pwa's self-destroying one) forces open tabs to
  // reload, which breaks the live demo. Existing SWs are torn down by the
  // cleanup snippet in index.html. Re-add a precaching PWA only post-event.
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
