import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'PodMan',
        short_name: 'PodMan',
        description: 'Ambient AI teammate that prevents merge collisions before push',
        theme_color: '#0b0f17',
        background_color: '#0b0f17',
        display: 'standalone',
      },
    }),
  ],
  server: {
    port: 5173,
  },
});
