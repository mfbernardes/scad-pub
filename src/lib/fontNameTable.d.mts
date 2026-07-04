// Hand-written types for fontNameTable.mjs (plain-ESM shared parser), so
// src/lib/fonts.ts can import it under moduleResolution: "bundler".
export function fontFamilyNames(bytes: Uint8Array): string[];
export function fontFaces(bytes: Uint8Array): { family: string; style: string }[];
