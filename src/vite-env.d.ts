/// <reference types="vite/client" />

// Web App Launch Handler API (https://wicg.github.io/web-app-launch/) — not
// yet in lib.dom.d.ts. Used by App.tsx (see docs/architecture-review.md M4)
// to consume an installed-app shortcut/launch navigation queued for an
// already-open client instead of reloading the document.
interface LaunchParams {
  readonly targetURL: string;
  readonly files: ReadonlyArray<unknown>;
}

interface LaunchQueue {
  setConsumer(consumer: (params: LaunchParams) => void): void;
}
