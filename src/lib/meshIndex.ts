// meshIndex.ts — collapse a loader's non-indexed geometry back to an indexed mesh.
//
// three's ThreeMFLoader builds *non-indexed* geometry for coloured meshes
// (buildVertexColorMesh dereferences every triangle corner into a flat
// position+colour buffer), so a solid's shared vertices are duplicated ~6×.
// Safari/WebKit's Metal-backed WebGL corrupts the tail of a large enough
// attribute buffer: the model renders correctly in Chrome, but the vertices
// past the threshold come out as garbage spikes in Safari. A finely-facetted
// coloured design inflates past that threshold — the geometry emitted last
// (at the tail of the buffer) is what breaks, while the rest renders fine —
// and a coarser variant of the same model that stays under it renders cleanly.
//
// Re-indexing deduplicates by position + colour (a hard colour edge keeps its
// split vertices), shrinking the attribute buffers ~6× so they stay well under
// the size Safari mishandles. Rendering is identical (flat shading derives
// normals per-fragment, indexed or not).
import type { BufferGeometry } from "three";
import { mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Return an indexed copy of `geometry`, deduplicating identical vertices across
 * all attributes. Already-indexed geometry is returned untouched. When a fresh
 * geometry is produced the original is disposed (it is loader-owned scratch).
 */
export function toIndexedGeometry(geometry: BufferGeometry): BufferGeometry {
  if (geometry.getIndex()) return geometry;
  const merged = mergeVertices(geometry);
  geometry.dispose();
  return merged;
}
