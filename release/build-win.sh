#!/usr/bin/env bash
# Construit l'installeur Windows x64 depuis macOS (ou Linux), sans Wine :
#   release/consomazout-<version>-win-x64.exe
# Usage : ./release/build-win.sh   (depuis n'importe quel dossier)
# Sur un PC Windows, lancer directement : npm ci && npm run dist:win
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# makensis (qui produit l'installeur) n'existe qu'en x86_64 sur macOS : Rosetta 2 est nécessaire.
if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then
  if ! arch -x86_64 /usr/bin/true 2>/dev/null; then
    echo "✗ Sur un Mac Apple Silicon, la création de l'installeur Windows nécessite Rosetta 2." >&2
    echo "  Installez-le une fois avec :  softwareupdate --install-rosetta --agree-to-license" >&2
    exit 1
  fi
fi

# Dépendances absentes ou plus anciennes que package-lock.json → npm ci.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "→ npm ci"
  npm ci --no-audit --no-fund
fi

npm test

# Moteur des modèles open source : npm n'installe que les binaires llama.cpp de la machine qui construit.
# Depuis macOS ou Linux, on ajoute ceux de Windows x64 (CPU et Vulkan), sans toucher au reste de node_modules.
LLAMA_VERSION="$(node -p "require('./node_modules/node-llama-cpp/package.json').version")"
for PKG in win-x64 win-x64-vulkan; do
  DEST="node_modules/@node-llama-cpp/${PKG}"
  if [ ! -f "${DEST}/package.json" ] || [ "$(node -p "require('./${DEST}/package.json').version")" != "${LLAMA_VERSION}" ]; then
    echo "→ binaires llama.cpp ${PKG} ${LLAMA_VERSION}"
    TMP="$(mktemp -d)"
    (cd "$TMP" && npm pack --silent "@node-llama-cpp/${PKG}@${LLAMA_VERSION}" >/dev/null)
    rm -rf "$DEST" && mkdir -p "$DEST"
    tar -xzf "$TMP"/*.tgz -C "$DEST" --strip-components=1
    rm -rf "$TMP"
  fi
done

npm run dist:win

VERSION="$(node -p "require('./package.json').version")"
EXE="release/consomazout-${VERSION}-win-x64.exe"
echo
echo "✓ $(ls -lh "$EXE" | awk '{print $5, $NF}')"
echo "  Installeur non signé : SmartScreen demandera « Informations complémentaires » → « Exécuter quand même »."
