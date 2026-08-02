// Hand-written types for config-spec.mjs, so vite.config.ts can import from it
// typed. Same role as src/lib/securityHeaders.d.mts.
//
// DELIBERATELY PARTIAL: it declares only what a TypeScript consumer actually
// imports. The build scripts are plain ESM and don't consult this file, so
// typing CONFIG_SPEC's whole recursive shape here would be a second declaration
// of the config surface to keep in step — exactly what CONFIG_SPEC exists to
// avoid. Add an entry when a TS file needs one.
export const PWA_THEME_COLOR_DEFAULTS: { light: string; dark: string };
