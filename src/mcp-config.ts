// MCP server configuration — loading, merging, env expansion, persistence
import * as fs from 'fs';
import * as path from 'path';
import type { MCPLocalServerConfig, MCPRemoteServerConfig, MCPServerConfig } from '@github/copilot-sdk';
import { log } from './log.js';

export type { MCPLocalServerConfig, MCPRemoteServerConfig, MCPServerConfig };

const CONFIG_DIR = path.join(process.env.HOME ?? '.', '.copilot-remote');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

export interface McpConfigSource {
  name: string;
  path: string;
  servers: Record<string, MCPServerConfig>;
}

/** Expand ${VAR} references in string values using process.env */
function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, key) => process.env[key] ?? '');
}

/** Recursively expand env vars in an object's string values */
function deepExpandEnv<T>(obj: T): T {
  if (typeof obj === 'string') return expandEnvVars(obj) as T;
  if (Array.isArray(obj)) return obj.map(deepExpandEnv) as T;
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      result[k] = deepExpandEnv(v);
    }
    return result as T;
  }
  return obj;
}

/** Load env vars from a dotenv-style file */
function loadEnvFile(envFilePath: string): Record<string, string> {
  const vars: Record<string, string> = {};
  try {
    const content = fs.readFileSync(envFilePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      // Strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      vars[key] = val;
    }
  } catch {
    log.debug(`Failed to load envFile: ${envFilePath}`);
  }
  return vars;
}

/** Strip JS-style comments and trailing commas so VS Code JSONC files parse as JSON */
function stripJsonc(text: string): string {
  let result = '';
  let i = 0;
  while (i < text.length) {
    // String literal — copy verbatim
    if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') {
        if (text[j] === '\\') j++; // skip escaped char
        j++;
      }
      result += text.slice(i, j + 1);
      i = j + 1;
    // Single-line comment
    } else if (text[i] === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
    // Multi-line comment
    } else if (text[i] === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i += 2;
    } else {
      result += text[i];
      i++;
    }
  }
  // Remove trailing commas before } or ]
  return result.replace(/,\s*([}\]])/g, '$1');
}

/** Coerce a raw config object into a typed MCPServerConfig */
function coerceServerConfig(raw: Record<string, unknown>): MCPServerConfig {
  const type = (raw.type as string) ?? 'local';
  // Ensure tools defaults to ["*"] if not specified
  const tools = (raw.tools as string[]) ?? ['*'];

  if (type === 'http' || type === 'sse') {
    return {
      type,
      url: raw.url as string,
      tools,
      ...(raw.headers ? { headers: raw.headers as Record<string, string> } : {}),
      ...(raw.timeout ? { timeout: raw.timeout as number } : {}),
    } as MCPRemoteServerConfig;
  }

  return {
    ...(type !== 'local' ? { type: type as 'local' | 'stdio' } : {}),
    command: raw.command as string,
    args: (raw.args as string[]) ?? [],
    tools,
    ...(raw.env ? { env: raw.env as Record<string, string> } : {}),
    ...(raw.cwd ? { cwd: raw.cwd as string } : {}),
    ...(raw.timeout ? { timeout: raw.timeout as number } : {}),
  } as MCPLocalServerConfig;
}

/** Extract raw server entries from a config object (no type coercion yet) */
function extractRawServers(data: unknown): Record<string, Record<string, unknown>> {
  if (!data || typeof data !== 'object') return {};
  const obj = data as Record<string, unknown>;

  // VS Code format: { servers: { ... } } or { mcpServers: { ... } }
  // Also handle plain { serverName: { ... } }
  const raw = (obj.mcpServers ?? obj.servers ?? obj) as Record<string, unknown>;
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, cfg] of Object.entries(raw)) {
    if (cfg && typeof cfg === 'object' && !Array.isArray(cfg)) {
      result[name] = cfg as Record<string, unknown>;
    }
  }
  return result;
}

/** Raw config source before coercion */
interface RawConfigSource {
  name: string;
  path: string;
  servers: Record<string, Record<string, unknown>>;
}

/** Load raw MCP servers from a JSON/JSONC file */
function loadFile(filePath: string): RawConfigSource | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(stripJsonc(raw));
    const servers = extractRawServers(data);
    if (!Object.keys(servers).length) return null;
    return { name: path.basename(filePath), path: filePath, servers };
  } catch (e) {
    log.debug(`Failed to load MCP config from ${filePath}:`, e);
    return null;
  }
}

/**
 * Load and merge MCP servers from all config sources.
 * Priority (last wins): copilot-remote config.json < ~/.copilot/mcp-config.json < .vscode/mcp.json < workdir .mcp.json
 */
export function loadMcpServers(
  configServers?: Record<string, unknown>,
  workDir?: string,
): { merged: Record<string, MCPServerConfig>; sources: McpConfigSource[] } {
  const home = process.env.HOME ?? '';
  const rawSources: RawConfigSource[] = [];

  // 1. copilot-remote config.json mcpServers
  if (configServers && Object.keys(configServers).length) {
    const raw = extractRawServers({ mcpServers: configServers });
    if (Object.keys(raw).length) {
      rawSources.push({ name: 'config.json', path: CONFIG_FILE, servers: raw });
    }
  }

  // 2. ~/.copilot/mcp-config.json (VS Code Copilot format)
  const copilotMcp = loadFile(path.join(home, '.copilot', 'mcp-config.json'));
  if (copilotMcp) rawSources.push(copilotMcp);

  // 3. ~/.vscode/mcp.json (VS Code global MCP)
  const vscodeMcp = loadFile(path.join(home, '.vscode', 'mcp.json'));
  if (vscodeMcp) rawSources.push(vscodeMcp);

  // 4. <workDir>/.vscode/mcp.json (project-level)
  if (workDir) {
    const projectMcp = loadFile(path.join(workDir, '.vscode', 'mcp.json'));
    if (projectMcp) rawSources.push(projectMcp);
  }

  // 5. <workDir>/.mcp.json (project root)
  if (workDir) {
    const dotMcp = loadFile(path.join(workDir, '.mcp.json'));
    if (dotMcp) rawSources.push(dotMcp);
  }

  // Merge all raw sources (later sources override earlier)
  const rawMerged: Record<string, Record<string, unknown>> = {};
  for (const source of rawSources) {
    Object.assign(rawMerged, source.servers);
  }

  // Expand ${workspaceFolder} before any file I/O or coercion
  const asString = JSON.stringify(rawMerged);
  const expanded = workDir
    ? JSON.parse(asString.replace(/\$\{workspaceFolder\}/g, workDir)) as Record<string, Record<string, unknown>>
    : rawMerged;

  // Process envFile references (now paths are resolved)
  for (const cfg of Object.values(expanded)) {
    if (cfg.envFile) {
      const envFilePath = expandEnvVars(String(cfg.envFile));
      const fileEnv = loadEnvFile(envFilePath);
      const explicitEnv = (cfg.env as Record<string, string>) ?? {};
      cfg.env = { ...fileEnv, ...explicitEnv };
      delete cfg.envFile;
    }
  }

  // Expand remaining env vars
  const envExpanded = deepExpandEnv(expanded);

  // Coerce to typed configs and set cwd for local servers with relative paths
  const merged: Record<string, MCPServerConfig> = {};
  const sources: McpConfigSource[] = [];
  for (const [name, cfg] of Object.entries(envExpanded)) {
    try {
      const coerced = coerceServerConfig(cfg);
      // Set cwd to workDir for local servers that don't have one
      // so relative command/arg paths resolve correctly
      if (workDir && coerced.type !== 'http' && coerced.type !== 'sse') {
        const local = coerced as MCPLocalServerConfig;
        if (!local.cwd) local.cwd = workDir;
      }
      merged[name] = coerced;
    } catch (e) {
      log.debug(`Skipping invalid MCP server "${name}":`, e);
    }
  }

  // Build typed sources for display
  for (const raw of rawSources) {
    const typed: Record<string, MCPServerConfig> = {};
    for (const name of Object.keys(raw.servers)) {
      if (merged[name]) typed[name] = merged[name];
    }
    if (Object.keys(typed).length) {
      sources.push({ name: raw.name, path: raw.path, servers: typed });
    }
  }

  return { merged, sources };
}

/** Format a server config for display */
export function formatServerLine(name: string, cfg: MCPServerConfig): string {
  const isRemote = cfg.type === 'http' || cfg.type === 'sse';
  const icon = isRemote ? '🌐' : '💻';
  const detail = isRemote
    ? (cfg as MCPRemoteServerConfig).url
    : `${(cfg as MCPLocalServerConfig).command} ${(cfg as MCPLocalServerConfig).args.join(' ')}`;
  const toolsStr = cfg.tools.length === 1 && cfg.tools[0] === '*'
    ? 'all tools'
    : cfg.tools.length === 0 ? 'no tools' : cfg.tools.join(', ');
  return `${icon} \`${name}\` — ${detail}\n   _Tools: ${toolsStr}_`;
}

/** Add a server to the copilot-remote config.json */
export function addServer(name: string, config: MCPServerConfig): void {
  let data: Record<string, unknown> = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch { /* start fresh */ }

  const servers = (data.mcpServers ?? {}) as Record<string, unknown>;
  servers[name] = config;
  data.mcpServers = servers;

  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2) + '\n');
}

/** Remove a server from the copilot-remote config.json */
export function removeServer(name: string): boolean {
  try {
    if (!fs.existsSync(CONFIG_FILE)) return false;
    const data = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    const servers = (data.mcpServers ?? {}) as Record<string, unknown>;
    if (!(name in servers)) return false;
    delete servers[name];
    data.mcpServers = servers;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(data, null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}

/** Parse a quick-add string like "npx -y @modelcontextprotocol/server-filesystem /tmp" into an MCPLocalServerConfig */
export function parseQuickAdd(input: string): MCPLocalServerConfig | MCPRemoteServerConfig | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // HTTP/SSE URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return { type: 'http', url: trimmed, tools: ['*'] };
  }
  // Command string
  const parts = trimmed.split(/\s+/);
  if (!parts.length) return null;
  return {
    command: parts[0],
    args: parts.slice(1),
    tools: ['*'],
  };
}
