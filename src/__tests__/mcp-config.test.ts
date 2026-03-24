import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadMcpServers,
  formatServerLine,
  getConfigPaths,
  type MCPLocalServerConfig,
  type MCPRemoteServerConfig,
} from '../mcp-config.js';

// Use a temp dir for isolation
let tmpDir: string;

function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data));
}

describe('mcp-config', () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('loadMcpServers', () => {
    it('returns empty when no sources exist', () => {
      const { merged, sources } = loadMcpServers(undefined, tmpDir);
      assert.equal(Object.keys(merged).length, 0);
      assert.equal(sources.length, 0);
    });

    it('loads from config.json mcpServers', () => {
      const cfgServers = {
        myserver: { command: 'node', args: ['server.js'], tools: ['*'] },
      };
      const { merged, sources } = loadMcpServers(cfgServers, tmpDir);
      assert.equal(Object.keys(merged).length, 1);
      assert.ok('myserver' in merged);
      assert.equal(sources.length, 1);
    });

    it('loads from .vscode/mcp.json in workdir', () => {
      writeJson(path.join(tmpDir, '.vscode', 'mcp.json'), {
        servers: {
          vscode_server: { type: 'http', url: 'https://example.com/mcp', tools: ['*'] },
        },
      });
      const { merged } = loadMcpServers(undefined, tmpDir);
      assert.ok('vscode_server' in merged);
      const cfg = merged.vscode_server as MCPRemoteServerConfig;
      assert.equal(cfg.type, 'http');
      assert.equal(cfg.url, 'https://example.com/mcp');
    });

    it('loads from .mcp.json in workdir', () => {
      writeJson(path.join(tmpDir, '.mcp.json'), {
        mcpServers: {
          dotfile: { command: 'npx', args: ['-y', 'some-server'], tools: ['*'] },
        },
      });
      const { merged } = loadMcpServers(undefined, tmpDir);
      assert.ok('dotfile' in merged);
    });

    it('later sources override earlier sources', () => {
      // config.json has server A with one command
      const cfgServers = {
        overlap: { command: 'old-cmd', args: ['old'], tools: ['*'] },
      };
      // .mcp.json has server A with different command (higher priority)
      writeJson(path.join(tmpDir, '.mcp.json'), {
        mcpServers: {
          overlap: { command: 'new-cmd', args: ['new'], tools: ['*'] },
        },
      });
      const { merged } = loadMcpServers(cfgServers, tmpDir);
      const cfg = merged.overlap as MCPLocalServerConfig;
      assert.equal(cfg.command, 'new-cmd');
    });

    it('defaults tools to ["*"] when not specified', () => {
      const cfgServers = {
        notoolsspec: { command: 'node', args: ['s.js'] },
      };
      const { merged } = loadMcpServers(cfgServers, tmpDir);
      const cfg = merged.notoolsspec as MCPLocalServerConfig;
      assert.deepEqual(cfg.tools, ['*']);
    });

    it('expands env vars in config values', () => {
      const key = 'MCP_TEST_TOKEN_' + Date.now();
      process.env[key] = 'secret123';
      try {
        const cfgServers = {
          authserver: {
            type: 'http',
            url: 'https://api.example.com/mcp',
            headers: { Authorization: 'Bearer ${' + key + '}' },
            tools: ['*'],
          },
        };
        const { merged } = loadMcpServers(cfgServers, tmpDir);
        const cfg = merged.authserver as MCPRemoteServerConfig;
        assert.equal(cfg.headers?.Authorization, 'Bearer secret123');
      } finally {
        delete process.env[key];
      }
    });

    it('expands env vars in local server env', () => {
      const key = 'MCP_TEST_PATH_' + Date.now();
      process.env[key] = '/usr/local/bin';
      try {
        const cfgServers = {
          localenv: {
            command: 'node',
            args: ['s.js'],
            env: { PATH: '${' + key + '}' },
            tools: ['*'],
          },
        };
        const { merged } = loadMcpServers(cfgServers, tmpDir);
        const cfg = merged.localenv as MCPLocalServerConfig;
        assert.equal(cfg.env?.PATH, '/usr/local/bin');
      } finally {
        delete process.env[key];
      }
    });
  });

  describe('formatServerLine', () => {
    it('formats local server', () => {
      const line = formatServerLine('mytools', {
        command: 'npx',
        args: ['-y', '@mcp/server'],
        tools: ['*'],
      } as MCPLocalServerConfig);
      assert.ok(line.includes('💻'));
      assert.ok(line.includes('mytools'));
      assert.ok(line.includes('npx'));
      assert.ok(line.includes('all tools'));
    });

    it('formats remote server', () => {
      const line = formatServerLine('github', {
        type: 'http',
        url: 'https://api.github.com/mcp',
        tools: ['search', 'issues'],
      } as MCPRemoteServerConfig);
      assert.ok(line.includes('🌐'));
      assert.ok(line.includes('github'));
      assert.ok(line.includes('https://api.github.com/mcp'));
      assert.ok(line.includes('search, issues'));
    });

    it('shows "no tools" for empty tools array', () => {
      const line = formatServerLine('empty', {
        command: 'node',
        args: ['s.js'],
        tools: [],
      } as MCPLocalServerConfig);
      assert.ok(line.includes('no tools'));
    });
  });

  describe('getConfigPaths', () => {
    it('returns expected config file paths', () => {
      const paths = getConfigPaths('/my/project');
      assert.ok(paths.length >= 5);
      assert.ok(paths.some((p) => p.includes('.copilot-remote')));
      assert.ok(paths.some((p) => p.includes('mcp-config.json')));
      assert.ok(paths.some((p) => p.endsWith('.mcp.json')));
    });

    it('includes workdir-specific paths when workDir is provided', () => {
      const withWork = getConfigPaths('/my/project');
      const without = getConfigPaths();
      assert.ok(withWork.length > without.length);
      assert.ok(withWork.some((p) => p.startsWith('/my/project')));
    });
  });

  describe('coercion', () => {
    it('defaults type to local when not specified', () => {
      const cfgServers = {
        implicit: { command: 'node', args: ['s.js'], tools: ['*'] },
      };
      const { merged } = loadMcpServers(cfgServers, tmpDir);
      const cfg = merged.implicit as MCPLocalServerConfig;
      // type should be undefined (defaulted) or "local"
      assert.ok(!cfg.type || cfg.type === 'local');
    });

    it('handles sse type as remote', () => {
      const cfgServers = {
        sseserver: { type: 'sse', url: 'https://sse.example.com', tools: ['*'] },
      };
      const { merged } = loadMcpServers(cfgServers, tmpDir);
      const cfg = merged.sseserver as MCPRemoteServerConfig;
      assert.equal(cfg.type, 'sse');
      assert.equal(cfg.url, 'https://sse.example.com');
    });

    it('handles stdio type as local alias', () => {
      const cfgServers = {
        stdioserver: { type: 'stdio', command: 'python', args: ['srv.py'], tools: ['*'] },
      };
      const { merged } = loadMcpServers(cfgServers, tmpDir);
      const cfg = merged.stdioserver as MCPLocalServerConfig;
      assert.equal(cfg.type, 'stdio');
      assert.equal(cfg.command, 'python');
    });

    it('preserves timeout and cwd', () => {
      const cfgServers = {
        full: { command: 'node', args: ['s.js'], tools: ['*'], timeout: 30000, cwd: '/tmp' },
      };
      const { merged } = loadMcpServers(cfgServers, tmpDir);
      const cfg = merged.full as MCPLocalServerConfig;
      assert.equal(cfg.timeout, 30000);
      assert.equal(cfg.cwd, '/tmp');
    });
  });

  describe('JSONC support', () => {
    it('parses files with single-line comments', () => {
      const jsonc = `{
        "servers": {
          // this is a time server
          "time": {
            "command": "uvx",
            "args": ["mcp-server-time"],
            "type": "stdio"
          }
        }
      }`;
      fs.mkdirSync(path.join(tmpDir, '.vscode'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.vscode', 'mcp.json'), jsonc);
      const { merged } = loadMcpServers(undefined, tmpDir);
      assert.ok('time' in merged);
      assert.equal((merged.time as MCPLocalServerConfig).command, 'uvx');
    });

    it('parses files with trailing commas', () => {
      const jsonc = `{
        "servers": {
          "myserver": {
            "command": "node",
            "args": ["s.js"],
          },
        }
      }`;
      fs.mkdirSync(path.join(tmpDir, '.vscode'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.vscode', 'mcp.json'), jsonc);
      const { merged } = loadMcpServers(undefined, tmpDir);
      assert.ok('myserver' in merged);
    });

    it('preserves URLs containing // inside strings', () => {
      const jsonc = `{
        "servers": {
          // github server
          "github": {
            "type": "http",
            "url": "https://api.githubcopilot.com/mcp/"
          }
        }
      }`;
      fs.mkdirSync(path.join(tmpDir, '.vscode'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.vscode', 'mcp.json'), jsonc);
      const { merged } = loadMcpServers(undefined, tmpDir);
      assert.ok('github' in merged);
      assert.equal((merged.github as MCPRemoteServerConfig).url, 'https://api.githubcopilot.com/mcp/');
    });

    it('handles commented-out server blocks', () => {
      const jsonc = `{
        "servers": {
          "active": { "command": "node", "args": ["a.js"] },
          // "disabled": {
          //   "command": "node",
          //   "args": ["d.js"]
          // },
          "also-active": { "command": "node", "args": ["b.js"] }
        }
      }`;
      fs.mkdirSync(path.join(tmpDir, '.vscode'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, '.vscode', 'mcp.json'), jsonc);
      const { merged } = loadMcpServers(undefined, tmpDir);
      assert.ok('active' in merged);
      assert.ok('also-active' in merged);
      assert.ok(!('disabled' in merged));
    });
  });

  describe('VS Code variable expansion', () => {
    it('expands ${workspaceFolder} to workDir', () => {
      const cfgServers = {
        local: {
          command: 'python3',
          args: ['${workspaceFolder}/tools/server.py'],
          tools: ['*'],
        },
      };
      const { merged } = loadMcpServers(cfgServers, '/home/user/myproject');
      const cfg = merged.local as MCPLocalServerConfig;
      assert.equal(cfg.args[0], '/home/user/myproject/tools/server.py');
    });

    it('expands ${workspaceFolder} in envFile paths', () => {
      // Create a mock env file
      const envFile = path.join(tmpDir, '.env');
      fs.writeFileSync(envFile, 'MY_KEY=my_value\n');
      const cfgServers = {
        withEnvFile: {
          command: 'node',
          args: ['s.js'],
          envFile: '${workspaceFolder}/.env',
          tools: ['*'],
        },
      };
      const { merged } = loadMcpServers(cfgServers, tmpDir);
      const cfg = merged.withEnvFile as MCPLocalServerConfig;
      assert.equal(cfg.env?.MY_KEY, 'my_value');
    });
  });

  describe('envFile support', () => {
    it('loads env vars from envFile', () => {
      const envFile = path.join(tmpDir, 'test.env');
      fs.writeFileSync(envFile, 'FOO=bar\nBAZ=qux\n');
      const cfgServers = {
        withEnv: {
          command: 'node',
          args: ['s.js'],
          envFile: envFile,
          tools: ['*'],
        },
      };
      const { merged } = loadMcpServers(cfgServers, tmpDir);
      const cfg = merged.withEnv as MCPLocalServerConfig;
      assert.equal(cfg.env?.FOO, 'bar');
      assert.equal(cfg.env?.BAZ, 'qux');
    });

    it('explicit env overrides envFile values', () => {
      const envFile = path.join(tmpDir, 'test.env');
      fs.writeFileSync(envFile, 'KEY=from_file\nOTHER=file_only\n');
      const cfgServers = {
        override: {
          command: 'node',
          args: ['s.js'],
          envFile: envFile,
          env: { KEY: 'explicit' },
          tools: ['*'],
        },
      };
      const { merged } = loadMcpServers(cfgServers, tmpDir);
      const cfg = merged.override as MCPLocalServerConfig;
      assert.equal(cfg.env?.KEY, 'explicit');
      assert.equal(cfg.env?.OTHER, 'file_only');
    });

    it('strips quotes from envFile values', () => {
      const envFile = path.join(tmpDir, 'quoted.env');
      fs.writeFileSync(envFile, 'DOUBLE="double_val"\nSINGLE=\'single_val\'\n');
      const cfgServers = {
        quoted: { command: 'node', args: ['s.js'], envFile: envFile, tools: ['*'] },
      };
      const { merged } = loadMcpServers(cfgServers, tmpDir);
      const cfg = merged.quoted as MCPLocalServerConfig;
      assert.equal(cfg.env?.DOUBLE, 'double_val');
      assert.equal(cfg.env?.SINGLE, 'single_val');
    });

    it('skips comments and blank lines in envFile', () => {
      const envFile = path.join(tmpDir, 'comments.env');
      fs.writeFileSync(envFile, '# This is a comment\n\nKEY=val\n  \n# Another\n');
      const cfgServers = {
        comments: { command: 'node', args: ['s.js'], envFile: envFile, tools: ['*'] },
      };
      const { merged } = loadMcpServers(cfgServers, tmpDir);
      const cfg = merged.comments as MCPLocalServerConfig;
      assert.equal(cfg.env?.KEY, 'val');
      assert.equal(Object.keys(cfg.env ?? {}).length, 1);
    });
  });
});
