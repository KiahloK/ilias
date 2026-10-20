#!/bin/bash
# Builds "ILIAS Sync.app" (menu bar app) into macos/build/ without needing Xcode.
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release 2>&1 | grep -v "ld: warning: search path"
APP="build/ILIAS Sync.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp .build/release/ILIASSync "$APP/Contents/MacOS/ILIASSync"

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>de.ilias-sync.app</string>
  <key>CFBundleName</key><string>ILIAS Sync</string>
  <key>CFBundleDisplayName</key><string>ILIAS Sync</string>
  <key>CFBundleExecutable</key><string>ILIASSync</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>15.0</string>
  <!-- Menu bar only: no Dock icon. -->
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

# Ad-hoc signature so macOS runs the locally built app.
codesign --force --sign - "$APP"
echo "Built $(pwd)/$APP"
