// Types for helpShape.mjs, which is plain JS so gen-schema (plain Node, no
// TypeScript) and src/lib/schema.ts can share one contract.
export function checkHelpShape(help: unknown, fail: (msg: string) => never): void;
