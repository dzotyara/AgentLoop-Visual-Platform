#!/usr/bin/env bash
# Installs the AgentLoop shortcut: ~/Applications/AgentLoop.app, a link to it on the Desktop, and the launchd job it
# starts. The job does not run at login: AgentLoop runs when you click the shortcut (the desktop widget does start at
# login, see ../build.sh).
set -euo pipefail
cd "$(dirname "$0")"

LABEL=com.dzotyara.agentloop
REPO="$(cd ../../.. && pwd)"
APP="$HOME/Applications/AgentLoop.app"
AGENT="$HOME/Library/LaunchAgents/${LABEL}.plist"
LOGS="$HOME/.pr-loop/logs"
# launchd starts jobs with a bare PATH; agents need claude and gh, the servers need node and pnpm.
JOB_PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

PNPM="$(PATH="$JOB_PATH" command -v pnpm)" || { echo "pnpm not found in $JOB_PATH" >&2; exit 1; }
for tool in node gh claude; do
  PATH="$JOB_PATH" command -v "$tool" >/dev/null || { echo "$tool not found in $JOB_PATH" >&2; exit 1; }
done

mkdir -p "$LOGS" "$HOME/Applications" "$APP/Contents/MacOS" "$APP/Contents/Resources"
API_PORT="$(sed -n 's/^PORT=//p' "$REPO/.env" | tr -d '"' | head -1)"
sed "s/@API_PORT@/${API_PORT:-8790}/" AgentLoop.command.sh > "$APP/Contents/MacOS/AgentLoop"
chmod +x "$APP/Contents/MacOS/AgentLoop"
cp AgentLoop.icns "$APP/Contents/Resources/AgentLoop.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>${LABEL}.launcher</string>
  <key>CFBundleName</key><string>AgentLoop</string>
  <key>CFBundleExecutable</key><string>AgentLoop</string>
  <key>CFBundleIconFile</key><string>AgentLoop</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
codesign --force --sign - "$APP" >/dev/null
ln -sfn "$APP" "$HOME/Desktop/AgentLoop"

cat > "$AGENT" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>${PNPM}</string><string>dev:local</string></array>
  <key>WorkingDirectory</key><string>${REPO}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${JOB_PATH}</string></dict>
  <key>StandardOutPath</key><string>${LOGS}/agentloop.log</string>
  <key>StandardErrorPath</key><string>${LOGS}/agentloop.log</string>
  <key>RunAtLoad</key><false/>
</dict></plist>
PLIST
# Reinstall over a live job: stop the whole tree first (bootout alone orphans the agents), and bootstrap only once
# launchd has really dropped the old service.
"$APP/Contents/MacOS/AgentLoop" stop
launchctl bootout "gui/$(id -u)/${LABEL}" 2>/dev/null || true
for _ in 1 2 3 4 5 6 7 8 9 10; do
  launchctl print "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || break
  sleep 1
done
launchctl bootstrap "gui/$(id -u)" "$AGENT"
echo "installed $APP, link on the Desktop, launchd job $LABEL"
