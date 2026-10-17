interface ImportMetaEnv {
  // P1b: the office server on its own origin (e.g. https://api.example.com). Unset in dev: same origin via Vite.
  readonly VITE_SERVER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
