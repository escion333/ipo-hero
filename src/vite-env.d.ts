/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** When "true"/"1", the app reads mock fixtures instead of generated artifacts. */
  readonly VITE_USE_MOCK?: string;
  /** Selects which mock dataset to render: success (default), empty, or error. */
  readonly VITE_MOCK_STATE?: "success" | "empty" | "error";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
