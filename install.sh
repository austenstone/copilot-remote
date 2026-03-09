#!/bin/bash
# ============================================================
# Copilot Remote — One-line Installer
# ============================================================
# curl -fsSL https://raw.githubusercontent.com/tag-assistant/copilot-remote/main/install.sh | bash
# Hackable mode (self-dev, source watching, hot reload):
#   curl -fsSL ... | bash -s -- --hackable
# ============================================================

set -e

REPO="tag-assistant/copilot-remote"
INSTALL_DIR="$HOME/.copilot-remote"
PLIST_PATH="$HOME/Library/LaunchAgents/com.copilot-remote.plist"
HACKABLE=0

# Parse flags
for arg in "$@"; do
  case "$arg" in
    --hackable) HACKABLE=1 ;;
  esac
done

echo ""
echo "  ⚡ Copilot Remote Installer"
echo "  ─────────────────────────────"
if [ "$HACKABLE" -eq 1 ]; then
  echo "  🔧 Hackable mode — self-dev enabled"
fi
echo ""

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "❌ Node.js required. Install: https://nodejs.org"; exit 1; }
command -v copilot >/dev/null 2>&1 || { echo "❌ GitHub Copilot CLI required. Install: npm install -g @github/copilot"; exit 1; }

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
  echo "❌ Node.js 20+ required (found $(node -v))"
  exit 1
fi

# Get tokens
if [ -z "$COPILOT_REMOTE_BOT_TOKEN" ]; then
  echo "  Telegram bot token (from @BotFather):"
  read -rp "  > " COPILOT_REMOTE_BOT_TOKEN
fi

if [ -z "$GITHUB_TOKEN" ]; then
  echo ""
  echo "  GitHub token (with Copilot access):"
  read -rp "  > " GITHUB_TOKEN
fi

if [ -z "$COPILOT_REMOTE_BOT_TOKEN" ] || [ -z "$GITHUB_TOKEN" ]; then
  echo "❌ Both tokens are required."
  exit 1
fi

echo ""
echo "  📦 Installing copilot-remote..."

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  cd "$INSTALL_DIR"
  git pull --quiet
else
  git clone --quiet "https://github.com/$REPO.git" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

npm install --silent 2>/dev/null
npm run build --silent 2>/dev/null

COPILOT_BIN=$(which copilot)
NODE_BIN=$(which node)

# Enable self-development in config for hackable mode
if [ "$HACKABLE" -eq 1 ]; then
  CONFIG_DIR="$HOME/.copilot-remote"
  CONFIG_PATH="$CONFIG_DIR/config.json"
  mkdir -p "$CONFIG_DIR"
  if [ -f "$CONFIG_PATH" ]; then
    # Merge selfDevelopment into existing config
    node -e "
      const fs = require('fs');
      const cfg = JSON.parse(fs.readFileSync('$CONFIG_PATH', 'utf8'));
      cfg.selfDevelopment = { ...cfg.selfDevelopment, enabled: true, autoRestart: true };
      fs.writeFileSync('$CONFIG_PATH', JSON.stringify(cfg, null, 2) + '\n');
    "
  else
    echo '{ "selfDevelopment": { "enabled": true, "autoRestart": true } }' > "$CONFIG_PATH"
  fi
  echo "  🔧 Self-development enabled in config"
fi

# ProgramArguments
if [ "$HACKABLE" -eq 1 ]; then
  # Hackable: run TypeScript directly via tsx (no watch) for Node 24 ESM compat
  PROG_ARGS="        <string>$NODE_BIN</string>
        <string>$INSTALL_DIR/node_modules/.bin/tsx</string>
        <string>src/index.ts</string>"
else
  # Standard: run compiled JS via tsx loader for Node 24 ESM compat
  PROG_ARGS="        <string>$NODE_BIN</string>
        <string>$INSTALL_DIR/node_modules/.bin/tsx</string>
        <string>$INSTALL_DIR/dist/index.js</string>"
fi
EXTRA_ENV="        <key>LAUNCH_JOB_NAME</key>
        <string>com.copilot-remote</string>"

# Detect OS
if [ "$(uname)" = "Darwin" ]; then
  echo "  🍎 Setting up macOS LaunchAgent..."

  # Stop existing
  launchctl unload "$PLIST_PATH" 2>/dev/null || true

  cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.copilot-remote</string>
    <key>ProgramArguments</key>
    <array>
$PROG_ARGS
    </array>
    <key>WorkingDirectory</key>
    <string>$INSTALL_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>COPILOT_REMOTE_BOT_TOKEN</key>
        <string>$COPILOT_REMOTE_BOT_TOKEN</string>
        <key>COPILOT_REMOTE_WORKDIR</key>
        <string>$HOME</string>
        <key>GITHUB_TOKEN</key>
        <string>$GITHUB_TOKEN</string>
        <key>PATH</key>
        <string>$(dirname "$NODE_BIN"):$(dirname "$COPILOT_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
        <key>HOME</key>
        <string>$HOME</string>
        <key>NODE_OPTIONS</key>
        <string>--experimental-sqlite</string>
$EXTRA_ENV
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>$HOME/.copilot-remote/copilot-remote.log</string>
    <key>StandardErrorPath</key>
    <string>$HOME/.copilot-remote/copilot-remote.log</string>
</dict>
</plist>
EOF

  launchctl load "$PLIST_PATH"

  echo ""
  echo "  ✅ Copilot Remote is running!"
  echo ""
  echo "  ─────────────────────────────"
  if [ "$HACKABLE" -eq 1 ]; then
    echo "  Mode:     🔧 Hackable (self-dev, file watching)"
    echo "  Source:   ~/.copilot-remote/src/"
  fi
  echo "  Service:  launchctl list | grep copilot"
  echo "  Logs:     tail -f ~/.copilot-remote/copilot-remote.log"
  echo "  Stop:     launchctl unload $PLIST_PATH"
  echo "  Start:    launchctl load $PLIST_PATH"
  if [ "$HACKABLE" -eq 1 ]; then
    echo "  Update:   cd ~/.copilot-remote && git pull && npm install && npm run build"
    echo "  Hack:     code ~/.copilot-remote  (edit src/, build, auto-restarts)"
  else
    echo "  Update:   cd ~/.copilot-remote && git pull && npm run build"
  fi
  echo "  Uninstall: launchctl unload $PLIST_PATH && rm -rf ~/.copilot-remote $PLIST_PATH"
  echo ""

elif command -v systemctl >/dev/null 2>&1; then
  echo "  🐧 Setting up systemd service..."

  UNIT_PATH="$HOME/.config/systemd/user/copilot-remote.service"
  mkdir -p "$(dirname "$UNIT_PATH")"

  # Hackable: run TypeScript directly, standard: compiled JS
  if [ "$HACKABLE" -eq 1 ]; then
    EXEC_START="$NODE_BIN $INSTALL_DIR/node_modules/.bin/tsx src/index.ts"
  else
    EXEC_START="$NODE_BIN $INSTALL_DIR/node_modules/.bin/tsx $INSTALL_DIR/dist/index.js"
  fi

  cat > "$UNIT_PATH" << EOF
[Unit]
Description=Copilot Remote — Telegram ↔ Copilot CLI bridge
After=network.target

[Service]
ExecStart=$EXEC_START
WorkingDirectory=$INSTALL_DIR
Environment=COPILOT_REMOTE_BOT_TOKEN=$COPILOT_REMOTE_BOT_TOKEN
Environment=GITHUB_TOKEN=$GITHUB_TOKEN
Environment=COPILOT_REMOTE_WORKDIR=$HOME
Environment=PATH=$(dirname "$NODE_BIN"):$(dirname "$COPILOT_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable copilot-remote
  systemctl --user start copilot-remote

  echo ""
  echo "  ✅ Copilot Remote is running!"
  echo ""
  echo "  ─────────────────────────────"
  echo "  Status:    systemctl --user status copilot-remote"
  echo "  Logs:      journalctl --user -u copilot-remote -f"
  echo "  Stop:      systemctl --user stop copilot-remote"
  echo "  Start:     systemctl --user start copilot-remote"
  if [ "$HACKABLE" -eq 1 ]; then
    echo "  Update:    cd ~/.copilot-remote && git pull && npm install"
    echo "  Hack:      code ~/.copilot-remote  (edit src/, auto-reloads)"
  else
    echo "  Update:    cd ~/.copilot-remote && git pull && npm run build && systemctl --user restart copilot-remote"
  fi
  echo "  Uninstall: systemctl --user disable --now copilot-remote && rm -rf ~/.copilot-remote $UNIT_PATH"
  echo ""

else
  echo ""
  echo "  ✅ Installed to ~/.copilot-remote"
  echo ""
  echo "  Run manually:"
  if [ "$HACKABLE" -eq 1 ]; then
    echo "    COPILOT_REMOTE_BOT_TOKEN='$COPILOT_REMOTE_BOT_TOKEN' \\"
    echo "    GITHUB_TOKEN='$GITHUB_TOKEN' \\"
    echo "    npx tsx watch ~/.copilot-remote/src/index.ts"
  else
    echo "    COPILOT_REMOTE_BOT_TOKEN='$COPILOT_REMOTE_BOT_TOKEN' \\"
    echo "    GITHUB_TOKEN='$GITHUB_TOKEN' \\"
    echo "    node ~/.copilot-remote/dist/cli.js"
  fi
  echo ""
fi

echo "  Open your bot in Telegram and send a message. 🚀"
echo ""
