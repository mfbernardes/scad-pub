// Hand-written types for read-schema.mjs, so vite.config.ts can import from it
// typed. Same role as config-spec.d.mts and src/lib/securityHeaders.d.mts.
//
// Deliberately partial, like its siblings: these are the designs.json fields the
// BUILD side reads (page chrome, storage namespace, compile-time defines), not
// the whole schema — src/openscad/types.ts owns that for the app.
export interface BuildSchema {
  title?: string;
  shortName?: string;
  id?: string;
  lang?: string;
  dir?: "ltr" | "rtl" | "auto";
  format?: "3mf" | "stl";
  viewer?: { style?: "plain" | "studio"; restOnGrid?: boolean };
  description?: string;
  themeColor?: string;
  themeColorLight?: string;
  colors?: {
    light?: Record<string, string>;
    dark?: Record<string, string>;
  } | null;
  extraCss?: string | null;
  appleSplash?: { href: string; media: string }[];
}

export function readGeneratedSchema(absPath: string, strict?: boolean): Promise<BuildSchema>;
