#!/usr/bin/env node
// ============================================================
// Copilot Remote — CLI Entry Point
// ============================================================
// Usage: copilot-remote [options]
//   --token, -t          Telegram bot token
//   --github-token, -g   GitHub token (for Copilot auth)
//   --cli-url, -c        URL of an existing headless Copilot CLI server
//   --provider-type      BYOK provider type (openai|azure|anthropic)
//   --provider-base-url  BYOK provider base URL
//   --provider-api-key   BYOK API key
//   --provider-bearer-token  BYOK bearer token
//   --provider-wire-api  BYOK wire API (completions|responses)
//   --provider-azure-api-version  Azure API version override
//   --fake-telegram      Use local mock Telegram harness instead of the real bot API
//   --workdir, -w        Working directory (default: $HOME)
//   --binary, -b         Path to copilot binary
//   --allowed-users, -u  Comma-separated Telegram user IDs
// ============================================================

import { resolveProviderConfig, type RemoteProviderConfig } from './provider-config.js';

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
const provider = resolveProviderConfig({
  type: getArg(['--provider-type']) as RemoteProviderConfig['type'] | undefined,
  baseUrl: getArg(['--provider-base-url']),
  apiKey: getArg(['--provider-api-key']),
  bearerToken: getArg(['--provider-bearer-token']),
  wireApi: getArg(['--provider-wire-api']) as 'completions' | 'responses' | undefined,
  azure: {
    apiVersion: getArg(['--provider-azure-api-version']),
  },
});
const fakeTelegram = args.includes('--fake-telegram') || process.env.COPILOT_REMOTE_FAKE_TELEGRAM === '1';
const workdir = getArg(['--workdir', '-w']) ?? process.env.COPILOT_REMOTE_WORKDIR ?? process.env.HOME ?? process.cwd();
const binary = getArg(['--binary', '-b']) ?? process.env.COPILOT_REMOTE_BINARY;
const allowedUsers = getArg(['--allowed-users', '-u']) ?? process.env.COPILOT_REMOTE_ALLOWED_USERS;

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  copilot-remote — Control GitHub Copilot CLI from Telegram

  Usage:
    copilot-remote --token <bot-token> --github-token <gh-token>
    copilot-remote --token <bot-token> --provider-base-url <url>

  Options:
    --token, -t          Telegram bot token (or COPILOT_REMOTE_BOT_TOKEN)
    --github-token, -g   GitHub token for Copilot (or GITHUB_TOKEN)
    --cli-url, -c        Existing headless Copilot CLI server URL (or COPILOT_REMOTE_CLI_URL)
    --provider-type      BYOK provider type: openai, azure, anthropic
    --provider-base-url  BYOK provider base URL
    --provider-api-key   BYOK provider API key
    --provider-bearer-token  BYOK static bearer token
    --provider-wire-api  BYOK wire API: completions or responses
    --provider-azure-api-version  Azure API version override
    --fake-telegram      Use local mock Telegram harness (no real bot required)
    --workdir, -w        Working directory (default: ~)
    --binary, -b         Path to copilot binary (auto-detected)
    --allowed-users, -u  Comma-separated Telegram user IDs (default: auto-pair)
    --help, -h           Show this message

  Environment variables:
    COPILOT_REMOTE_BOT_TOKEN    Telegram bot token
    GITHUB_TOKEN                GitHub token for Copilot auth
    COPILOT_REMOTE_CLI_URL      Existing headless Copilot CLI server URL
    COPILOT_REMOTE_PROVIDER_TYPE  BYOK provider type
    COPILOT_REMOTE_PROVIDER_BASE_URL  BYOK provider base URL
    COPILOT_REMOTE_PROVIDER_API_KEY  BYOK API key
    COPILOT_REMOTE_PROVIDER_BEARER_TOKEN  BYOK bearer token
    COPILOT_REMOTE_PROVIDER_WIRE_API  BYOK wire API
    COPILOT_REMOTE_PROVIDER_AZURE_API_VERSION  Azure API version override
    COPILOT_REMOTE_FAKE_TELEGRAM  Set to 1 to use the local mock Telegram harness
    COPILOT_REMOTE_WORKDIR      Working directory
    COPILOT_REMOTE_BINARY       Path to copilot binary
    COPILOT_REMOTE_ALLOWED_USERS  Comma-separated user IDs
`);
  process.exit(0);
}

if (!token && !fakeTelegram) {
  console.error('Error: Telegram bot token required.');
  console.error('  Use --token <token> or set COPILOT_REMOTE_BOT_TOKEN');
  console.error('  Create a bot at https://t.me/BotFather');
  process.exit(1);
}

if (!githubToken && !cliUrl && !provider) {
  console.error('Error: GitHub token required for Copilot authentication.');
  console.error('  Use --github-token <token>, configure a BYOK provider, or connect to an existing headless server with --cli-url');
  process.exit(1);
}

// Set env vars for the main module
if (token) process.env.COPILOT_REMOTE_BOT_TOKEN = token;
if (githubToken && !cliUrl && !provider) process.env.GITHUB_TOKEN = githubToken;
if (cliUrl) process.env.COPILOT_REMOTE_CLI_URL = cliUrl;
if (fakeTelegram) process.env.COPILOT_REMOTE_FAKE_TELEGRAM = '1';
if (provider?.type) process.env.COPILOT_REMOTE_PROVIDER_TYPE = provider.type;
if (provider?.baseUrl) process.env.COPILOT_REMOTE_PROVIDER_BASE_URL = provider.baseUrl;
if (provider?.apiKey) process.env.COPILOT_REMOTE_PROVIDER_API_KEY = provider.apiKey;
if (provider?.bearerToken) process.env.COPILOT_REMOTE_PROVIDER_BEARER_TOKEN = provider.bearerToken;
if (provider?.wireApi) process.env.COPILOT_REMOTE_PROVIDER_WIRE_API = provider.wireApi;
if (provider?.azure?.apiVersion) process.env.COPILOT_REMOTE_PROVIDER_AZURE_API_VERSION = provider.azure.apiVersion;
process.env.COPILOT_REMOTE_WORKDIR = workdir;
if (binary) process.env.COPILOT_REMOTE_BINARY = binary;
if (allowedUsers) process.env.COPILOT_REMOTE_ALLOWED_USERS = allowedUsers;

// Run
import('./index.js');
