#!/usr/bin/env bash
# ============================================================================
#  bootstrap_infra.sh — The Zombie Escape
#
#  Clona de forma SELECTIVA la subcarpeta /doom/ de
#  joeheyming/joeheyming.github.com (git sparse-checkout + filtro blob:none),
#  descarta los PK3 de franquicias de terceros y deja el runtime de UZDoom-WASM
#  en public/engine/ con su PROVENANCE.json.
#
#  Equivalente bash de scripts/bootstrap_infra.ps1 (Windows/PowerShell).
#
#  Uso:
#      make bootstrap
#      bash scripts/bootstrap_infra.sh
# ============================================================================
set -euo pipefail

REPO_URL="https://github.com/joeheyming/joeheyming.github.com.git"
TMP_DIR=".tmp_joeheyming_clone"
TARGET_DIR="public/engine"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# --- 1. Clon superficial, sin blobs, sin checkout ---------------------------
echo "[1/5] Clonando de forma selectiva /doom/ desde joeheyming/joeheyming.github.com..."
rm -rf "$TMP_DIR"
if ! git clone --depth 1 --filter=blob:none --no-checkout "$REPO_URL" "$TMP_DIR"; then
  echo "  (reintentando con http.sslBackend=openssl)"
  rm -rf "$TMP_DIR"
  git -c http.sslBackend=openssl clone --depth 1 --filter=blob:none --no-checkout "$REPO_URL" "$TMP_DIR"
fi

# --- 2. Sparse-checkout en modo --no-cone ----------------------------------
# Se incluye /doom/ entero y se EXCLUYEN los mods de franquicias ajenas
# (Mario, Metroid, Castlevania, Sonic, Zelda) para que git no descargue sus
# ~155 MB de blobs.
echo "[2/5] Aplicando sparse-checkout (solo /doom/, sin franquicias de terceros)..."
git -C "$TMP_DIR" sparse-checkout set --no-cone \
  '/doom/**' \
  '/coi-serviceworker.js' \
  '!/doom/*mario*' \
  '!/doom/met2*' \
  '!/doom/*Castlevania*' \
  '!/doom/*sonic*' \
  '!/doom/*LegendOfDoom*'
git -C "$TMP_DIR" checkout

COMMIT_HASH="$(git -C "$TMP_DIR" rev-parse HEAD)"
COMMIT_SHORT="$(git -C "$TMP_DIR" rev-parse --short HEAD)"
echo "  commit: $COMMIT_HASH"

# --- 3. Copiar el runtime --------------------------------------------------
echo "[3/5] Copiando runtime WASM, Service Worker y recursos base a $TARGET_DIR ..."
rm -rf "$TARGET_DIR"
mkdir -p "$TARGET_DIR"
cp -R "$TMP_DIR"/doom/. "$TARGET_DIR"/

# Limpieza defensiva (idempotente si el sparse-checkout ya los excluyó).
for pattern in '*mario*' 'met2*' '*Castlevania*' '*sonic*' '*LegendOfDoom*'; do
  for f in "$TARGET_DIR"/$pattern; do
    [ -e "$f" ] || continue
    echo "  eliminando asset de franquicia ajeno: $(basename "$f")"
    rm -rf "$f"
  done
done

if [ -f "$TMP_DIR/coi-serviceworker.js" ]; then
  cp "$TMP_DIR/coi-serviceworker.js" public/coi-serviceworker.js
  echo "  coi-serviceworker.js (COOP/COEP) copiado a public/"
else
  echo "  AVISO: no se encontró coi-serviceworker.js en el upstream; se conserva el local."
fi

# --- 4. Procedencia --------------------------------------------------------
echo "[4/5] Registrando metadatos de procedencia..."
cat > "$TARGET_DIR/PROVENANCE.json" <<EOF
{
  "upstream_repo": "https://github.com/joeheyming/joeheyming.github.com",
  "upstream_path": "doom/",
  "upstream_url": "https://joeheyming.github.io/doom/",
  "upstream_commit": "$COMMIT_HASH",
  "upstream_short": "$COMMIT_SHORT",
  "fetched_at_utc": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "author": "Joe Heyming",
  "engine": "uzdoom-wasm (GPL v3)",
  "iwad": "Freedoom Phase 1 (BSD 3-Clause)",
  "pruned": ["mariodoom.pk3", "met2.pk3", "Castlevania.ipk3", "sonicdoom-legacy.pk3", "LegendOfDoom-1.1.0.pk3"],
  "entry_points": {
    "engine_glue": "engine/uzdoom.js",
    "engine_wasm": "engine/uzdoom.wasm",
    "engine_data": "engine/uzdoom.data",
    "preload_set": "engine/uzdoom.pk3, game_support.pk3, brightmaps.pk3, lights.pk3, game_widescreen_gfx.pk3"
  }
}
EOF

# --- 5. Limpieza -----------------------------------------------------------
echo "[5/5] Limpiando directorio temporal..."
rm -rf "$TMP_DIR"

SIZE="$(du -sh "$TARGET_DIR" | cut -f1)"
echo "Infraestructura base lista en $TARGET_DIR ($SIZE, commit $COMMIT_SHORT)"
