// Registers the extensionless-.ts resolver hook (see ts-resolve.mjs). Used via
// `node --import ./tests/register-ts.mjs` so the unit tests can import the app's
// TypeScript source directly.
import { register } from "node:module";
register("./ts-resolve.mjs", import.meta.url);
