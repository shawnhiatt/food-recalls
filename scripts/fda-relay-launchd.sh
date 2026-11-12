#!/bin/bash
# Install, run or remove the FDA press relay as a macOS launchd agent
# (health-audit ticket T5). See docs/fda-relay.md.
#
#   scripts/fda-relay-launchd.sh install   # copy the relay, write + load the agent
#   scripts/fda-relay-launchd.sh run       # one relay run now, in this terminal
#   scripts/fda-relay-launchd.sh status    # agent state + last log lines
#   scripts/fda-relay-launchd.sh uninstall # unload + delete the agent and its files
#
# The shared secret lives in the login Keychain (service below), never in the
# plist, the repo or the log. Store it once with `secret`, which prompts for it
# without echoing it:
#   scripts/fda-relay-launchd.sh secret
set -euo pipefail

LABEL="app.foodrecalls.fda-relay"
KEYCHAIN_SERVICE="food-recalls-fda-relay"
# Prod Convex HTTP actions are served from the .convex.site host.
RELAY_URL="${FDA_RELAY_URL:-https://good-lynx-479.convex.site/relay/fda-rss}"
INTERVAL_SECONDS=10800 # every 3h, matching Convex's own fda_rss cron

HOME_DIR="$HOME/Library/Application Support/food-recalls-fda-relay"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/food-recalls-fda-relay.log"
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || true)"

die() { echo "fda-relay: $*" >&2; exit 1; }

write_runner() {
  mkdir -p "$HOME_DIR"
  cp "$REPO_DIR/scripts/fda-relay.mjs" "$HOME_DIR/fda-relay.mjs"
  # The runner launchd calls: reads the secret from the Keychain at run time.
  cat > "$HOME_DIR/run.sh" <<RUNNER
#!/bin/bash
set -euo pipefail
secret="\$(/usr/bin/security find-generic-password -a "\$USER" -s "$KEYCHAIN_SERVICE" -w 2>/dev/null)" \\
  || { echo "\$(date -u +%FT%TZ) [fda-relay] no secret in Keychain service $KEYCHAIN_SERVICE" >&2; exit 1; }
FDA_RELAY_URL="$RELAY_URL" FDA_RELAY_SECRET="\$secret" exec "$NODE" "$HOME_DIR/fda-relay.mjs"
RUNNER
  chmod 700 "$HOME_DIR/run.sh"
}

case "${1:-}" in
  secret)
    echo "Paste the FDA relay secret (the value of Convex's FDA_RELAY_SECRET) at both prompts."
    # -w as the last option makes security prompt for it, so the value never
    # appears in argv or shell history.
    /usr/bin/security add-generic-password -U -a "$USER" -s "$KEYCHAIN_SERVICE" -w
    echo "Stored in the login Keychain as service $KEYCHAIN_SERVICE."
    ;;
  install)
    [ -n "$NODE" ] || die "node not found on PATH"
    /usr/bin/security find-generic-password -a "$USER" -s "$KEYCHAIN_SERVICE" >/dev/null 2>&1 \
      || die "no secret yet: run '$0 secret' first"
    write_runner
    mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$HOME_DIR/run.sh</string></array>
  <key>StartInterval</key><integer>$INTERVAL_SECONDS</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
PLIST
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Installed $LABEL (every ${INTERVAL_SECONDS}s, and once now). Log: $LOG"
    ;;
  run)
    write_runner # refresh the copy, so a run always uses the repo's relay
    /bin/bash "$HOME_DIR/run.sh"
    ;;
  status)
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state|last exit|runs" || echo "$LABEL is not loaded"
    [ -f "$LOG" ] && tail -n 8 "$LOG"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    rm -rf "$HOME_DIR"
    echo "Removed $LABEL. The log ($LOG) and the Keychain item are kept; delete them with:"
    echo "  rm \"$LOG\"; security delete-generic-password -a \"\$USER\" -s $KEYCHAIN_SERVICE"
    ;;
  *)
    sed -n '2,14p' "$0"
    exit 1
    ;;
esac
