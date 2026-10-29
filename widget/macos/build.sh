#!/usr/bin/env bash
# Builds AgentLoopWidget.app with swiftc (Command Line Tools are enough, no Xcode).
#   ./build.sh            build into widget/macos/build/
#   ./build.sh install    build, copy to ~/Applications, start now and at every login
set -euo pipefail
cd "$(dirname "$0")"

APP=build/AgentLoopWidget.app
LABEL=com.dzotyara.agentloop-widget
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
swiftc -O -parse-as-library AgentLoopWidget.swift -o "$APP/Contents/MacOS/AgentLoopWidget" \
  -framework AppKit -framework SwiftUI
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>${LABEL}</string>
  <key>CFBundleName</key><string>AgentLoop Widget</string>
  <key>CFBundleExecutable</key><string>AgentLoopWidget</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict></plist>
PLIST
codesign --force --sign - "$APP" >/dev/null
echo "built $APP"

[ "${1:-}" = "install" ] || exit 0

DEST="$HOME/Applications/AgentLoopWidget.app"
mkdir -p "$HOME/Applications"
pkill -x AgentLoopWidget 2>/dev/null || true
rm -rf "$DEST"
cp -R "$APP" "$DEST"

AGENT="$HOME/Library/LaunchAgents/${LABEL}.plist"
cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${DEST}/Contents/MacOS/AgentLoopWidget</string></array>
  <key>RunAtLoad</key><true/>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$AGENT"
echo "installed $DEST; starts at login ($AGENT)"
