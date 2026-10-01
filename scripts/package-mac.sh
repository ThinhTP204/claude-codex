#!/usr/bin/env bash
# Build release/AgentDesk.app and release/AgentDesk-<version>-mac-<arch>.dmg
#   NODE_BIN=/path/to/node  pick the Node that gets bundled (default: the one on PATH, >= 23.6)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
VERSION="$(node -p "require('./package.json').version")"
ARCH="$(uname -m)"; [ "$ARCH" = "x86_64" ] && ARCH="x64"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
OUT="$ROOT/release"
APP="$OUT/AgentDesk.app"
RES="$APP/Contents/Resources"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "▸ AgentDesk $VERSION ($ARCH), Node $("$NODE_BIN" -v)"
rm -rf "$APP" && mkdir -p "$APP/Contents/MacOS" "$RES/app"

echo "▸ build giao diện"
npx vite build >/dev/null

echo "▸ cửa sổ native + icon"
swiftc -O native/AgentDeskWindow.swift -o "$APP/Contents/MacOS/AgentDesk"
# native/AgentDesk.png comes from docs/logo.svg via scripts/render-logo.mjs
mkdir -p "$TMP/AgentDesk.iconset"
for s in 16 32 128 256 512; do
  sips -z $s $s native/AgentDesk.png --out "$TMP/AgentDesk.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) native/AgentDesk.png --out "$TMP/AgentDesk.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/AgentDesk.iconset" -o "$RES/AgentDesk.icns"

echo "▸ Node + code app"
cp "$NODE_BIN" "$RES/node"
chmod +x "$RES/node"
cp -R bin server shared dist package.json LICENSE "$RES/app/"
mkdir -p "$RES/app/node_modules"
cp -R node_modules/ws "$RES/app/node_modules/"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>AgentDesk</string>
  <key>CFBundleDisplayName</key><string>AgentDesk</string>
  <key>CFBundleIdentifier</key><string>io.github.thinhtp204.agentdesk</string>
  <key>CFBundleVersion</key><string>$VERSION</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleExecutable</key><string>AgentDesk</string>
  <key>CFBundleIconFile</key><string>AgentDesk</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST

echo "▸ ký ad-hoc (chưa có chứng chỉ Apple Developer)"
codesign --force --deep --sign - "$APP" 2>/dev/null

echo "▸ tạo DMG"
DMG="$OUT/AgentDesk-$VERSION-mac-$ARCH.dmg"
mkdir -p "$TMP/dmg"
cp -R "$APP" "$TMP/dmg/"
ln -s /Applications "$TMP/dmg/Applications"
rm -f "$DMG"
hdiutil create -volname "AgentDesk" -srcfolder "$TMP/dmg" -ov -format UDZO "$DMG" >/dev/null
echo "✓ $DMG ($(du -h "$DMG" | cut -f1))"
