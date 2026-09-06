/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COMBAT2_CLIENT_ENABLED?: string;
  readonly VITE_COMBAT2_TEST_CHARACTER_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
