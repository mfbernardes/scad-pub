// check.mjs: the pass/fail counter every checking script hand-rolled —
// identically, apart from which of them remembered to RETURN the boolean.
// (check-dist.mjs did not, which silently skipped a whole nested block of
// assertions until it was noticed.)
//
// Its own module rather than living in browser.mjs, because browser.mjs
// top-level-imports playwright and counting assertions has nothing to do with
// driving a browser: check-dist.mjs is a pure-filesystem check and should not
// pull a browser in to count to three.

export function makeCheck() {
  const state = { failures: 0 };
  const check = (ok, msg) => {
    console.log(`  ${ok ? "✅" : "❌"} ${msg}`);
    if (!ok) state.failures += 1;
    return ok;
  };
  return { check, state };
}
