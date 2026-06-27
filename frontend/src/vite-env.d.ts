/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL: string;
  readonly VITE_LIVEKIT_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
