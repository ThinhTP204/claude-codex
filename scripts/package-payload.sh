#!/usr/bin/env bash
# release/AgentDesk-app-<version>.tar.gz: the app code (UI build + server) without Node.
# Installed apps download it to update in place (see server/update.ts applyPayload).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="$(node -p "require('./package.json').version")"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
npx vite build >/dev/null
cp -R bin server shared dist package.json LICENSE "$STAGE/"
mkdir -p "$STAGE/node_modules" release
cp -R node_modules/ws "$STAGE/node_modules/"
OUT="release/AgentDesk-app-$VERSION.tar.gz"
tar -czf "$OUT" -C "$STAGE" .
echo "✓ $OUT ($(du -h "$OUT" | cut -f1))"
