// Flat ESLint config (ESM — package.json has "type": "module").
// Kept intentionally lean: typescript-eslint's non-type-checked "recommended"
// set (fast, no tsconfig project wiring) plus react-hooks, which is the
// highest-value rule set for this codebase's heavy use of custom hooks
// (useRenderPipeline, useFileImports, ...).
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const unusedVarsOptions = {
  argsIgnorePattern: '^_',
  varsIgnorePattern: '^_',
  // `const { abs, ...d } = design` to drop a field while keeping the rest is
  // a deliberate pattern in gen-schema.mjs — the discarded sibling isn't a bug.
  ignoreRestSiblings: true,
};

export default tseslint.config(
  {
    ignores: [
      'node_modules/',
      'dist/',
      // gen-schema.mjs output — never edited by hand, see CLAUDE.md
      'public/scad/',
      'public/wasm/',
      'src/generated/',
      'public/manifest.webmanifest',
      'public/icon.svg',
      'public/icon-*.png',
      'public/apple-splash-*.png',
      'public/precache-manifest.json',
      'public/fonts/fonts.conf',
      // shadcn-scaffolded primitives — vendored, not hand-authored
      'src/components/ui/',
      'tests/screenshots/',
      'screenshots/',
    ],
  },

  // Plain-JS baseline for every linted file (kept off the TS-only rules below).
  js.configs.recommended,

  // TypeScript app source: typescript-eslint's "recommended" (non-type-checked,
  // so `npm run lint` stays fast and needs no tsconfig project wiring) plus
  // react-hooks — the highest-value rule set for this codebase's heavy use of
  // custom hooks (useRenderPipeline, useFileImports, ...).
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // react-hooks v7 added `refs` to its recommended set. It flags the
      // deliberate ref-mirror / lazy-ref-init architecture this codebase is
      // built on — `latest.current = props` to forward the freshest callbacks
      // through identity-stable wrappers (appActions.ts, useRafBatchedWrite,
      // useRenderPipeline, …) and `if (!ref.current) ref.current = …` lazy
      // init. Both are React-endorsed patterns, documented in CLAUDE.md as the
      // stable-context-value design. Off, like no-explicit-any below, because
      // it fires on intentional code rather than bugs.
      'react-hooks/refs': 'off',
      // Also new in v7. setState inside an effect is used here to sync derived
      // UI state; keep it visible as advice without failing the lint.
      'react-hooks/set-state-in-effect': 'warn',
      // Style-only rules that don't indicate real bugs — keep the signal
      // focused on correctness/react-hooks rather than drowning in noise
      // from a first-time lint pass over an existing codebase.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', unusedVarsOptions],
      'no-empty': 'warn',
      'no-case-declarations': 'warn',
    },
  },

  // Web Worker source runs in a worker global scope, not window/document.
  {
    files: ['src/openscad/worker.ts'],
    languageOptions: {
      globals: {
        ...globals.worker,
      },
    },
  },

  // Root-level tooling config (vite.config.ts and this file). Without a block
  // whose `files` matches them, flat config silently skips them and `eslint .`
  // gives a false "all clear". Node ESM; vite.config.ts needs the TS parser.
  {
    files: ['*.{ts,js,mjs}'],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', unusedVarsOptions],
    },
  },

  // Hand-written service worker (public/sw.js is tracked, not generated —
  // see CLAUDE.md). Runs in the ServiceWorker global scope.
  {
    files: ['public/sw.js'],
    languageOptions: {
      globals: {
        ...globals.serviceworker,
      },
    },
  },

  // Build/dev scripts and the node:test suite run under plain Node, but
  // several (the Playwright-driven ones) also embed inline callbacks
  // (page.evaluate/waitForFunction) that execute in the browser — so both
  // global sets apply to the same file.
  {
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      'no-unused-vars': ['warn', unusedVarsOptions],
      // Fake event-emitter test doubles use `this.onX && this.onX(...)` to
      // conditionally invoke a handler — a deliberate short-circuit call,
      // not a stray expression.
      'no-unused-expressions': ['error', { allowShortCircuit: true }],
    },
  },
);
