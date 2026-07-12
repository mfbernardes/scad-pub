// Tests for scripts/lib/worker-deps.mjs — the H3 static import-closure
// resolver that derives the render worker's dependency list for renderHash
// instead of a hand-maintained file list.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkerDependencyClosure } from "../scripts/lib/worker-deps.mjs";

function withFixture(files, fn) {
  const dir = mkdtempSync(join(tmpdir(), "worker-deps-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, rel);
      mkdirSync(join(abs, ".."), { recursive: true });
      writeFileSync(abs, content);
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const rel = (dir, files) => files.map((f) => f.slice(dir.length + 1)).sort();

test("follows a single-line named import to its .ts file", () => {
  withFixture(
    {
      "entry.ts": `import { helper } from "./helper";\nhelper();\n`,
      "helper.ts": `export function helper() {}\n`,
    },
    (dir) => {
      const closure = resolveWorkerDependencyClosure(join(dir, "entry.ts"));
      assert.deepEqual(rel(dir, closure), ["entry.ts", "helper.ts"]);
    }
  );
});

test("follows a multi-line named-import list and a re-export", () => {
  withFixture(
    {
      "entry.ts": `import {\n  a,\n  b,\n} from "./multi";\n`,
      "multi.ts": `export * from "./tail";\nexport const a = 1, b = 2;\n`,
      "tail.ts": `export const c = 3;\n`,
    },
    (dir) => {
      const closure = resolveWorkerDependencyClosure(join(dir, "entry.ts"));
      assert.deepEqual(rel(dir, closure), ["entry.ts", "multi.ts", "tail.ts"]);
    }
  );
});

test("follows a bare side-effect import and single-quoted specifiers", () => {
  withFixture(
    {
      "entry.ts": `import './side';\nimport { x } from './up/x';\n`,
      "side.ts": `export {};\n`,
    },
    (dir) => {
      mkdirSync(join(dir, "up"), { recursive: true });
      writeFileSync(join(dir, "up", "x.ts"), `export const x = 1;\n`);
      const closure = resolveWorkerDependencyClosure(join(dir, "entry.ts"));
      assert.deepEqual(rel(dir, closure), ["entry.ts", "side.ts", "up/x.ts"]);
    }
  );
});

test("does not follow a bare/package specifier", () => {
  withFixture(
    {
      "entry.ts": `import { useState } from "react";\nimport { helper } from "./helper";\n`,
      "helper.ts": `export function helper() {}\n`,
    },
    (dir) => {
      const closure = resolveWorkerDependencyClosure(join(dir, "entry.ts"));
      assert.deepEqual(rel(dir, closure), ["entry.ts", "helper.ts"]);
    }
  );
});

test("does not follow a non-.ts resolution (e.g. a JSON data import)", () => {
  withFixture(
    {
      "entry.ts": `import schema from "./data.json";\n`,
      "data.json": `{}`,
    },
    (dir) => {
      const closure = resolveWorkerDependencyClosure(join(dir, "entry.ts"));
      assert.deepEqual(rel(dir, closure), ["entry.ts"]);
    }
  );
});

test("does not follow a dynamic, non-literal import (e.g. the openscad.js glue loader)", () => {
  withFixture(
    {
      "entry.ts": `async function load() {\n  return import(/* @vite-ignore */ someUrl());\n}\n`,
    },
    (dir) => {
      const closure = resolveWorkerDependencyClosure(join(dir, "entry.ts"));
      assert.deepEqual(rel(dir, closure), ["entry.ts"]);
    }
  );
});

test("guard: a new local import worker.ts starts pulling in is automatically covered", () => {
  // This is the H3 guard: the closure must grow when a new local dependency
  // is introduced, with no manual list to remember to update.
  withFixture(
    {
      "entry.ts": `import { buildOpenscadArgs } from "./renderArgs";\n`,
      "renderArgs.ts": `export function buildOpenscadArgs() { return []; }\n`,
    },
    (dir) => {
      const before = resolveWorkerDependencyClosure(join(dir, "entry.ts"));
      assert.deepEqual(rel(dir, before), ["entry.ts", "renderArgs.ts"]);

      // Simulate a future edit: worker.ts starts importing a brand-new helper.
      writeFileSync(
        join(dir, "entry.ts"),
        `import { buildOpenscadArgs } from "./renderArgs";\nimport { newHelper } from "./newHelper";\n`
      );
      writeFileSync(join(dir, "newHelper.ts"), `export function newHelper() {}\n`);
      const after = resolveWorkerDependencyClosure(join(dir, "entry.ts"));
      assert.deepEqual(rel(dir, after), ["entry.ts", "newHelper.ts", "renderArgs.ts"]);
    }
  );
});

test("the real render worker's closure includes renderArgs.ts and scad.ts (geometry-affecting helpers)", () => {
  const entry = join(process.cwd(), "src", "openscad", "worker.ts");
  const closure = resolveWorkerDependencyClosure(entry);
  const names = closure.map((f) => f.replace(process.cwd() + "/", ""));
  assert.ok(names.includes("src/openscad/worker.ts"));
  assert.ok(names.includes("src/openscad/renderArgs.ts"));
  assert.ok(names.includes("src/lib/scad.ts"));
  // The generated schema JSON is a data import, not a further source file —
  // it must not appear as a "dependency" to parse for more imports.
  assert.ok(!names.some((n) => n.endsWith(".json")));
});
