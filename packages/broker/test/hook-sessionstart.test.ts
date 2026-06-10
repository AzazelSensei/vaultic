import { describe, it, expect, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = resolve(HERE, '../../../hooks/vaultic-sessionstart.mjs');

const STDIN = JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' });

interface SessionStartOutput {
  hookSpecificOutput: {
    hookEventName: string;
    additionalContext: string;
  };
}

function runHook(projectDir: string): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('node', [HOOK_PATH], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', () => resolvePromise(out));
    child.stdin.end(STDIN);
  });
}

function writeManifest(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'sessionstart-'));
  writeFileSync(join(dir, '.aiv.yaml'), content);
  return dir;
}

const STANDARD = `workspace: acme
project: web
mode: standard
needs:
  OPENAI_API_KEY: vault://acme/web/prod/OPENAI_API_KEY
  STRIPE_SECRET: vault://acme/web/prod/STRIPE_SECRET
`;

describe('vaultic-sessionstart hook', () => {
  let dir: string;

  it('manifest varsa secret adlarını, modu ve vault_check kuralını bildirir', async () => {
    dir = writeManifest(STANDARD);
    const parsed = JSON.parse(await runHook(dir)) as SessionStartOutput;
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    const ctx = parsed.hookSpecificOutput.additionalContext;
    expect(ctx).toContain('OPENAI_API_KEY');
    expect(ctx).toContain('STRIPE_SECRET');
    expect(ctx).toContain('standard');
    expect(ctx).toContain('vault_check');
  });

  it('paranoid mod manifesti → additionalContext paranoid içerir', async () => {
    dir = writeManifest(STANDARD.replace('mode: standard', 'mode: paranoid'));
    const parsed = JSON.parse(await runHook(dir)) as SessionStartOutput;
    expect(parsed.hookSpecificOutput.additionalContext).toContain('paranoid');
  });

  it('manifest yoksa → çıktı boş (exit 0 sessiz)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'sessionstart-empty-'));
    expect(await runHook(dir)).toBe('');
  });

  it('needs bloğu boşsa → 0 secret(s) ile yine bildirir, çökmez', async () => {
    dir = writeManifest('workspace: acme\nproject: web\nmode: standard\nneeds: {}\n');
    const parsed = JSON.parse(await runHook(dir)) as SessionStartOutput;
    expect(parsed.hookSpecificOutput.hookEventName).toBe('SessionStart');
    expect(parsed.hookSpecificOutput.additionalContext).toContain('0 secret(s)');
  });
});
