#!/usr/bin/env node
// ============================================================
// Copilot Remote — CLI Entry Point
// ============================================================
// Usage: copilot-remote [options]
//   --token, -t          Telegram bot token
//   --github-token, -g   GitHub token (for Copilot auth)
//   --cli-url, -c        URL of an existing headless Copilot CLI server
//   --workdir, -w        Working directory (default: $HOME)
//   --binary, -b         Path to copilot binary
//   --allowed-users, -u  Comma-separated Telegram user IDs
// ============================================================

const args = process.argv.slice(2);

function getArg(flags: string[]): string | undefined {
  for (const flag of flags) {
    const idx = args.indexOf(flag);
    if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  }
  return undefined;
}

const token = getArg(['--token', '-t']) ?? process.env.COPILOT_REMOTE_BOT_TOKEN;
const githubToken = getArg(['--github-token', '-g']) ?? process.env.GITHUB_TOKEN;
const cliUrl = getArg(['--cli-url', '-c']) ?? process.env.COPILOT_REMOTE_CLI_URL;
const workdir = getArg(['--workdir', '-w']) ?? process.env.COPILOT_REMOTE_WORKDIR ?? process.env.HOME ?? process.cwd();
const binary = getArg(['--binary', '-b']) ?? process.env.COPILOT_REMOTE_BINARY;
const allowedUsers = getArg(['--allowed-users', '-u']) ?? process.env.COPILOT_REMOTE_ALLOWED_USERS;

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  copilot-remote — Control GitHub Copilot CLI from Telegram

  Usage:
    copilot-remote --token <bot-token> --github-token <gh-token>

  Options:
    --token, -t          Telegram bot token (or COPILOT_REMOTE_BOT_TOKEN)
    --github-token, -g   GitHub token for Copilot (or GITHUB_TOKEN)
    --cli-url, -c        Existing headless Copilot CLI server URL (or COPILOT_REMOTE_CLI_URL)
    --workdir, -w        Working directory (default: ~)
    --binary, -b         Path to copilot binary (auto-detected)
    --allowed-users, -u  Comma-separated Telegram user IDs (default: auto-pair)
    --help, -h           Show this message

  Environment variables:
    COPILOT_REMOTE_BOT_TOKEN    Telegram bot token
    GITHUB_TOKEN                GitHub token for Copilot auth
    COPILOT_REMOTE_CLI_URL      Existing headless Copilot CLI server URL
    COPILOT_REMOTE_WORKDIR      Working directory
    COPILOT_REMOTE_BINARY       Path to copilot binary
    COPILOT_REMOTE_ALLOWED_USERS  Comma-separated user IDs
`);
  process.exit(0);
}

if (!token) {
  console.error('Error: Telegram bot token required.');
  console.error('  Use --token <token> or set COPILOT_REMOTE_BOT_TOKEN');
  console.error('  Create a bot at https://t.me/BotFather');
  process.exit(1);
}

if (!githubToken && !cliUrl) {
  console.error('Error: GitHub token required for Copilot authentication.');
  console.error('  Use --github-token <token>, set GITHUB_TOKEN, or connect to an existing headless server with --cli-url');
  process.exit(1);
}

// Set env vars for the main module
process.env.COPILOT_REMOTE_BOT_TOKEN = token;
if (githubToken && !cliUrl) process.env.GITHUB_TOKEN = githubToken;
if (cliUrl) process.env.COPILOT_REMOTE_CLI_URL = cliUrl;
process.env.COPILOT_REMOTE_WORKDIR = workdir;
if (binary) process.env.COPILOT_REMOTE_BINARY = binary;
if (allowedUsers) process.env.COPILOT_REMOTE_ALLOWED_USERS = allowedUsers;

// Run
import('./index.js');
