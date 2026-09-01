/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COMBAT2_DELIVERY_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
