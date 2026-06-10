#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const projectDir = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const manifestPath = join(projectDir, '.aiv.yaml');
if (!existsSync(manifestPath)) process.exit(0);

const raw = readFileSync(manifestPath, 'utf8');
const needs = [...raw.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
const mode = /mode:\s*paranoid/.test(raw) ? 'paranoid' : 'standard';

const context = [
  `vaultic active (mode: ${mode}). This project declares ${needs.length} secret(s) in .aiv.yaml: ${needs.join(', ')}.`,
  'Rules: (1) NEVER ask for or write real secret values. (2) Use vault_check to see status,',
  'vault_ref for references in code/config, vault_run to execute commands that need secrets.',
  '(3) One-time value access only via vault_reveal_request (requires human approval).',
].join(' ');

process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context },
}));
