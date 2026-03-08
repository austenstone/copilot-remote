# Copilot Remote ⚡

> Control GitHub Copilot CLI from Telegram. Start local coding sessions from your phone.

## How it works

```
┌──────────┐    Telegram API    ┌─────────────────┐    PTY     ┌─────────────┐
│  Phone   │ ←───────────────→ │  copilot-remote  │ ←───────→ │ copilot CLI │
│ Telegram │                    │  (bridge daemon) │           │  (local)    │
└──────────┘                    └─────────────────┘            └─────────────┘
                                       ↕
                                  Your filesystem,
                                  MCP servers, tools
```

Your Copilot CLI runs locally with full access to your filesystem, GitHub context, and MCP servers. The bridge daemon relays messages between Telegram and the CLI via a pseudo-terminal. Nothing leaves your machine except the chat messages.

## Prerequisites

- [Copilot CLI](https://github.com/github/copilot-cli) installed and authenticated
- A Telegram bot token (create via [@BotFather](https://t.me/botfather))
- Node.js 22+

## Setup

```bash
git clone https://github.com/tag-assistant/copilot-remote.git
cd copilot-remote
npm install
```

Create `.copilot-remote.json`:

```json
{
  "botToken": "YOUR_TELEGRAM_BOT_TOKEN",
  "allowedUsers": ["YOUR_TELEGRAM_USER_ID"],
  "workDir": "/path/to/your/project"
}
```

Or use environment variables:

```bash
export COPILOT_REMOTE_BOT_TOKEN="..."
export COPILOT_REMOTE_ALLOWED_USERS="6694168781"
export COPILOT_REMOTE_WORKDIR="/path/to/project"
```

## Usage

```bash
npm run dev    # development (watch mode)
npm start      # production
```

Then in Telegram:

| Command | Description |
|---------|-------------|
| `/start [dir]` | Start a Copilot session in directory |
| `/stop` | Kill current session |
| `/status` | Check if session is alive |
| `/yes` `/y` | Approve tool action |
| `/no` `/n` | Deny tool action |
| `/help` | Show commands |

Or just type a message to send it as a prompt to Copilot.

## Architecture

- **`src/session.ts`** — PTY manager for Copilot CLI. Spawns the process, handles ANSI stripping, detects prompts/responses, manages approve/deny flows.
- **`src/telegram.ts`** — Lightweight Telegram Bot API client. Long-polling, message splitting, typing indicators. Zero dependencies.
- **`src/index.ts`** — Wires it all together. Per-chat session management, command routing, graceful shutdown.

## Security

- Only Telegram user IDs in `allowedUsers` can interact
- Copilot CLI runs with your local permissions — same as running it in your terminal
- Bot token should be kept secret (use env vars in production)

## License

MIT
