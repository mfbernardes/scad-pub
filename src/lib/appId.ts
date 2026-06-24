// appId.ts — the configurator's stable id, used to namespace this deployment's
// browser storage (localStorage / IndexedDB / Cache Storage) so two configs
// served from the same origin don't read or clobber each other's data. Injected
// at build by Vite (`define`, from the config's `id`); falls back to
// "scadpub" when undefined (e.g. under the Node test runner).
declare const __APP_ID__: string | undefined;

export const APP_ID = typeof __APP_ID__ !== "undefined" ? __APP_ID__ : "scadpub";

/** Namespace a storage key with the app id, e.g. ns("presets.v1"). */
export const ns = (key: string): string => `${APP_ID}.${key}`;
