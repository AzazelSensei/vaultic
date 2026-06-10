#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

const MIN_TOKEN_LENGTH = 8;
const TOKEN_SPLIT = /[^A-Za-z0-9+/=_\-.~%]+/;
const GENERIC_PATTERNS = [
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
];

function configDir() {
  return process.env.VAULTIC_CONFIG_DIR ?? join(homedir(), '.config', 'vaultic');
}

function loadStore() {
  const path = join(configDir(), 'fingerprints.json');
  if (!existsSync(path)) return { salt: '', prints: new Set() };
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof data.salt !== 'string' || !Array.isArray(data.prints)) return { salt: '', prints: new Set() };
    return { salt: data.salt, prints: new Set(data.prints) };
  } catch {
    process.stderr.write('vaultic-hook: fingerprint store unreadable, skipping fingerprint layer\n');
    return { salt: '', prints: new Set() };
  }
}

function hashWith(salt, value) {
  return createHash('sha256').update(salt + value).digest('hex');
}

function matchesToken(token, store) {
  if (token.length >= MIN_TOKEN_LENGTH && store.prints.has(hashWith(store.salt, token))) return true;
  const eq = token.lastIndexOf('=');
  if (eq === -1) return false;
  const tail = token.slice(eq + 1);
  return tail.length >= MIN_TOKEN_LENGTH && store.prints.has(hashWith(store.salt, tail));
}

function containsFingerprinted(text, store) {
  if (store.prints.size === 0) return false;
  for (const token of text.split(TOKEN_SPLIT)) {
    if (matchesToken(token, store)) return true;
  }
  return false;
}

function protectedDirs() {
  const dirs = [resolve(configDir()), resolve(join(homedir(), '.config', 'vaultic'))];
  return [...new Set(dirs)];
}

function expandPath(p, cwd) {
  if (!p) return undefined;
  let out = p;
  if (out.startsWith('~')) out = join(homedir(), out.slice(1));
  return resolve(cwd ?? process.cwd(), out);
}

function isInProtectedDir(filePath, dirs, cwd) {
  const r = expandPath(filePath, cwd);
  if (!r) return false;
  return dirs.some((d) => r === d || r.startsWith(d + sep));
}

function deny(reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

let input;
try {
  input = JSON.parse(readFileSync(0, 'utf8'));
} catch {
  process.exit(0);
}

const toolInput = input.tool_input ?? {};
const serialized = JSON.stringify(toolInput);
const dirs = protectedDirs();
const cwd = typeof input.cwd === 'string' ? input.cwd : undefined;
const filePath = toolInput.file_path ?? toolInput.notebook_path;
const PROTECTED_REASON = 'vaultic: the vaultic config/credential store is off-limits to agents — use vault_ref/vault_run instead';
if (typeof filePath === 'string' && isInProtectedDir(filePath, dirs, cwd)) {
  deny(PROTECTED_REASON);
}
if (typeof toolInput.command === 'string') {
  const cmd = toolInput.command;
  const hit = dirs.some((d) => cmd.includes(d)) || cmd.includes('.config/vaultic') || cmd.includes('~/.config/vaultic');
  if (hit) deny(PROTECTED_REASON);
}
const store = loadStore();
if (containsFingerprinted(serialized, store)) {
  deny('vaultic: a known secret VALUE was detected in this tool input. Use a vault:// reference or vault_run; never write the raw value.');
}
for (const pattern of GENERIC_PATTERNS) {
  if (pattern.test(serialized)) {
    deny('vaultic: a secret-shaped string was detected. Store it with `vaultic set` and use a vault:// reference instead of the literal value.');
  }
}
process.exit(0);
