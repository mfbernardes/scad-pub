#!/usr/bin/env bash
# fetch-wasm.sh — download the OpenSCAD WebAssembly "web" snapshot into
# public/wasm/. Pinned to the SAME OpenSCAD version as the test suite
# (tests/setup_openscad.sh), so in-browser renders match the committed
# reference geometry. This snapshot ships Manifold and the textmetrics feature.
# The .wasm binary (~10 MB) is intentionally not committed; run this first.
set -euo pipefail

VERSION="${OPENSCAD_VERSION:-2026.06.12}"
URL="https://files.openscad.org/snapshots/OpenSCAD-${VERSION}-WebAssembly-web.zip"
SHA256="509879dd6813f2c4e5cf2ce1da6420928ce9bb212cd08491ca5ec9d5bffc700b"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WASM_DIR="${HERE}/../public/wasm"
mkdir -p "${WASM_DIR}"

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

echo "Downloading OpenSCAD ${VERSION} WebAssembly (web) ..." >&2
curl -fsSL -o "${TMP}/openscad-web.zip" "${URL}"

# Print a file's SHA-256 hex digest using whatever tool is available. Prefers
# `shasum` (always on macOS, where GNU `sha256sum --check` is absent), then GNU
# `sha256sum`, then `openssl`; works regardless of each tool's output format.
sha256_of() {
  local f="$1" out=""
  if command -v shasum >/dev/null 2>&1; then
    out="$(shasum -a 256 "$f" 2>/dev/null || true)"
  elif command -v sha256sum >/dev/null 2>&1; then
    out="$(sha256sum "$f" 2>/dev/null || true)"
  elif command -v openssl >/dev/null 2>&1; then
    out="$(openssl dgst -sha256 "$f" 2>/dev/null || true)"
  fi
  printf '%s' "$out" | grep -oiE '[0-9a-f]{64}' | head -1 || true
}

# Verify integrity when the version matches the pin.
if [ "${VERSION}" = "2026.06.12" ]; then
  ACTUAL="$(sha256_of "${TMP}/openscad-web.zip")"
  if [ -z "${ACTUAL}" ]; then
    echo "WARNING: no SHA-256 tool found; skipping checksum verification" >&2
  elif [ "${ACTUAL}" != "${SHA256}" ]; then
    echo "ERROR: checksum mismatch for ${URL}" >&2
    echo "  expected ${SHA256}" >&2
    echo "  actual   ${ACTUAL}" >&2
    exit 1
  fi
fi

( cd "${TMP}" && unzip -o -q openscad-web.zip )
cp "${TMP}/openscad.js" "${TMP}/openscad.wasm" "${WASM_DIR}/"
echo "Installed openscad.js + openscad.wasm (v${VERSION}) into public/wasm/" >&2
