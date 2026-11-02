#!/bin/bash
# Executable of AgentLoop.app (the shortcut): starts AgentLoop through launchd if it is down, then opens the UI.
# launchd owns the process, so it outlives whatever started it (a terminal, a Claude session).
LABEL=com.dzotyara.agentloop
UI=http://127.0.0.1:8800
API=http://127.0.0.1:@API_PORT@
LOG="$HOME/.pr-loop/logs/agentloop.log"

# Both servers: Vite answers seconds before the API. The API has a token, so any HTTP answer counts, even a 401.
up() { /usr/bin/curl -fs -o /dev/null --max-time 2 "$UI" && /usr/bin/curl -s -o /dev/null --max-time 2 "$API"; }
say() { /usr/bin/osascript -e "display notification \"$1\" with title \"AgentLoop\"" >/dev/null 2>&1; }

# Every process under the launchd job. Agents run in sessions of their own, so a signal to the job or its process
# group misses them, and pnpm ignores SIGTERM: stop walks the tree instead. An agent left alive would keep working in
# the worktree the next start resets.
descendants() {
  /bin/ps -axo pid=,ppid= | /usr/bin/awk -v root="$1" '
    { parent[$1] = $2 }
    END { for (p in parent) { q = p; while (q > 1 && q != root) q = parent[q]; if (q == root) print p } }'
}

stop() {
  local root pids left
  root="$(/bin/launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | /usr/bin/awk '/^[[:space:]]*pid = /{print $3; exit}')"
  [ -n "$root" ] || return 0
  pids="$root $(descendants "$root")"
  # shellcheck disable=SC2086
  /bin/kill -TERM $pids 2>/dev/null
  for _ in $(seq 1 10); do
    sleep 1
    left=""
    for p in $pids; do /bin/kill -0 "$p" 2>/dev/null && left="$left $p"; done
    [ -z "$left" ] && return 0
  done
  # shellcheck disable=SC2086
  /bin/kill -KILL $left 2>/dev/null
  return 0
}

if [ "${1:-}" = "stop" ]; then
  stop
  say "Stopped"
  exit 0
fi

if ! up; then
  say "Starting…"
  if ! /bin/launchctl kickstart "gui/$(id -u)/$LABEL" 2>/dev/null; then
    /usr/bin/osascript -e 'display alert "AgentLoop" message "The launcher is not installed. Run widget/macos/launcher/install.sh in the repo." as critical' >/dev/null 2>&1
    exit 1
  fi
  for _ in $(seq 1 60); do
    up && break
    sleep 1
  done
fi

if up; then
  /usr/bin/open "$UI"
else
  /usr/bin/osascript -e "display alert \"AgentLoop\" message \"Did not start in 60 s. Log: $LOG\" as critical" >/dev/null 2>&1
  exit 1
fi
