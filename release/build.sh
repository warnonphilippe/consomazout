#!/usr/bin/env bash
# Construit l'application de bureau macOS (Apple Silicon) :
#   release/consomazout-<version>-mac-arm64.dmg
# Usage : ./release/build.sh   (depuis n'importe quel dossier)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "✗ Le .dmg ne se construit que sur macOS." >&2
  exit 1
fi

# Dépendances absentes ou plus anciennes que package-lock.json → npm ci.
if [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "→ npm ci"
  npm ci --no-audit --no-fund
fi

npm test

# Certificat « Apple Development » du trousseau (une équipe gratuite suffit) : signature stable. Sinon, signature ad hoc.
# (Les clés API sont dans le Trousseau par l'outil `security` : elles ne dépendent pas de la signature.)
IDENTITY="$(security find-identity -v -p codesigning | sed -n 's/.*"Apple Development: \([^"]*\)".*/\1/p' | head -1)"
if [ -n "$IDENTITY" ]; then
  echo "→ signature avec le certificat Apple Development du trousseau"
  npm run build
  npx electron-builder --mac --arm64 -c.mac.identity="$IDENTITY"
else
  echo "→ pas de certificat Apple Development : signature ad hoc"
  npm run dist:mac
fi

VERSION="$(node -p "require('./package.json').version")"
DMG="release/consomazout-${VERSION}-mac-arm64.dmg"
echo
echo "✓ $(ls -lh "$DMG" | awk '{print $5, $NF}')"
echo "  Installer : ouvrir le .dmg et glisser ConsoMazout dans Applications."
