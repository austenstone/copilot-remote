import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const targets = [
  path.join(root, 'node_modules', '@github', 'copilot-sdk', 'dist', 'session.js'),
  path.join(root, 'node_modules', '@github', 'copilot-sdk', 'dist', 'session.d.ts'),
];

let patchedAny = false;

for (const target of targets) {
  if (!existsSync(target)) continue;

  const original = readFileSync(target, 'utf8');
  const updated = original.replaceAll('vscode-jsonrpc/node"', 'vscode-jsonrpc/node.js"');

  if (updated !== original) {
    writeFileSync(target, updated);
    console.log('[postinstall] patched', path.relative(root, target));
    patchedAny = true;
  }
}

if (!patchedAny) {
  console.log('[postinstall] copilot-sdk patch not needed');
}