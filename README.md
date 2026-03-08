# copilot-remote

Control [GitHub Copilot CLI](https://github.com/github/copilot-cli) from Telegram. Send prompts from your phone, get streamed responses with thinking, tool calls, and model selection.

## Quick Start

```bash
# One-liner install (clones, builds, sets up as service)
curl -fsSL https://raw.githubusercontent.com/tag-assistant/copilot-remote/main/install.sh | bash

# Or run directly with npx
npx copilot-remote --token <telegram-bot-token> --github-token <github-pat>
```

## Prerequisites

- **Node.js 20+**
- **GitHub Copilot CLI** installed (`npm install -g @github/copilot`)
- **GitHub token** with Copilot access
- **Telegram bot token** from [@BotFather](https://t.me/BotFather)

## Install

```bash
# Run directly (no install)
npx copilot-remote --token $BOT_TOKEN --github-token $GITHUB_TOKEN

# Or install globally
npm install -g copilot-remote
copilot-remote --token $BOT_TOKEN --github-token $GITHUB_TOKEN

# Or use environment variables
export COPILOT_REMOTE_BOT_TOKEN=your-bot-token
export GITHUB_TOKEN=your-github-token
copilot-remote
```

## Options

| Flag | Env Var | Description |
|------|---------|-------------|
| `--token`, `-t` | `COPILOT_REMOTE_BOT_TOKEN` | Telegram bot token |
| `--github-token`, `-g` | `GITHUB_TOKEN` | GitHub PAT for Copilot |
| `--workdir`, `-w` | `COPILOT_REMOTE_WORKDIR` | Working directory (default: `~`) |
| `--binary`, `-b` | `COPILOT_REMOTE_BINARY` | Path to copilot binary |
| `--allowed-users`, `-u` | `COPILOT_REMOTE_ALLOWED_USERS` | Comma-separated Telegram user IDs |

## Features

- **Streamed responses** — Messages update in real-time as Copilot thinks and responds
- **Status reactions** — Your message gets emoji reactions showing what Copilot is doing (🤔 thinking, 👨‍💻 coding, ⚡ web, 👍 done)
- **Session persistence** — Conversation context maintained via `--resume`
- **Model selection** — Switch between Claude, GPT, Gemini from the `/config` menu
- **Tool visibility** — See what tools Copilot is using (file reads, bash commands, etc.)
- **Reply context** — Quote-reply to any message and Copilot gets the context
- **Interactive config** — `/config` with inline buttons to toggle settings

## Commands

| Command | Description |
|---------|-------------|
| `/new` | Fresh session (clear history) |
| `/config` | Toggle settings (thinking, tools, usage, model) |
| `/cd [dir]` | Change working directory |
| `/status` | Session status |
| `/stop` | Kill session |
| `/help` | Show all commands |

Or just type a prompt — sessions auto-start.

## Run as macOS Service

```bash
# Create a launchd plist (auto-starts on login, auto-restarts on crash)
cat > ~/Library/LaunchAgents/com.copilot-remote.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>com.copilot-remote</string>
    <key>ProgramArguments</key>
    <array>
        <string>$(which copilot-remote)</string>
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>COPILOT_REMOTE_BOT_TOKEN</key><string>YOUR_BOT_TOKEN</string>
        <key>GITHUB_TOKEN</key><string>YOUR_GITHUB_TOKEN</string>
        <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
        <key>HOME</key><string>$HOME</string>
    </dict>
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>/tmp/copilot-remote.log</string>
    <key>StandardErrorPath</key><string>/tmp/copilot-remote.log</string>
</dict>
</plist>
EOF

launchctl load ~/Library/LaunchAgents/com.copilot-remote.plist
```

## How It Works

Each message spawns a Copilot CLI process with `--output-format json` for structured JSONL streaming. Session continuity is maintained via `--resume <sessionId>`. The bot is a thin relay — Copilot manages sessions, tools, and context natively.

```
You (Telegram) → Bot → copilot -p "prompt" --output-format json → JSONL events → Bot → You
```

## License

MIT

## Inspiration

Inspired by [OpenClaw](https://github.com/openclaw/openclaw) — an AI agent that bridges to messaging platforms via structured events. Copilot Remote applies the same pattern to GitHub Copilot CLI.
