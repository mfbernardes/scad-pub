// Tests the loader-geometry re-indexing helper (src/lib/meshIndex.ts) that fixes
// the Safari 3MF corruption: three's ThreeMFLoader emits non-indexed geometry
// (one vertex per triangle corner), which Safari's WebGL corrupts past a size
// threshold. toIndexedGeometry deduplicates the vertices back down, shrinking
// the attribute buffer under the threshold while keeping colour edges split.
import { test } from "node:test";
import assert from "node:assert/strict";
import { BufferGeometry, Float32BufferAttribute } from "three";
import { toIndexedGeometry } from "../src/lib/meshIndex.ts";

// Two triangles sharing an edge, expressed non-indexed (6 corners), like the
// 3MF loader emits. The shared edge's two vertices are byte-identical, so
// re-indexing must collapse 6 corners -> 4 unique vertices.
function sharedEdgeQuad() {
  const g = new BufferGeometry();
  // quad (0,0)-(1,0)-(1,1)-(0,1) as tris [0,1,2] and [0,2,3], written out flat
  const p = [
    0, 0, 0, 1, 0, 0, 1, 1, 0, // tri A
    0, 0, 0, 1, 1, 0, 0, 1, 0, // tri B (shares 2 corners with A)
  ];
  g.setAttribute("position", new Float32BufferAttribute(p, 3));
  return g;
}

test("toIndexedGeometry deduplicates shared vertices into an index", () => {
  const g = sharedEdgeQuad();
  assert.equal(g.getIndex(), null, "loader geometry starts non-indexed");
  assert.equal(g.getAttribute("position").count, 6);

  const out = toIndexedGeometry(g);
  assert.ok(out.getIndex(), "result is indexed");
  assert.equal(out.getAttribute("position").count, 4, "6 corners -> 4 unique");
  assert.equal(out.getIndex().count, 6, "still two triangles (6 index entries)");
});

test("toIndexedGeometry keeps a hard colour edge split", () => {
  // Same two coincident corners as above, but the two triangles carry different
  // per-vertex colours (a base/relief colour boundary in the 3MF). Vertices that
  // share a position but not a colour must NOT be merged.
  const g = sharedEdgeQuad();
  const c = [
    1, 1, 1, 1, 1, 1, 1, 1, 1, // tri A: white
    0, 0, 0, 0, 0, 0, 0, 0, 0, // tri B: black
  ];
  g.setAttribute("color", new Float32BufferAttribute(c, 3));

  const out = toIndexedGeometry(g);
  // The two coincident corners now differ by colour, so only the truly identical
  // ones merge: 6 corners -> 6 unique (nothing merges across the colour edge).
  assert.equal(out.getAttribute("position").count, 6, "colour edge stays split");
  const colors = out.getAttribute("color");
  const distinct = new Set();
  for (let i = 0; i < colors.count; i++)
    distinct.add(`${colors.getX(i)},${colors.getY(i)},${colors.getZ(i)}`);
  assert.deepEqual([...distinct].sort(), ["0,0,0", "1,1,1"], "both colours kept");
});

test("toIndexedGeometry leaves already-indexed geometry untouched", () => {
  const g = sharedEdgeQuad();
  const indexed = toIndexedGeometry(g);
  const again = toIndexedGeometry(indexed);
  assert.equal(again, indexed, "already-indexed geometry is returned as-is");
});
