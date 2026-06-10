import { describe, it, expect, beforeEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { FingerprintStore } from '@vaultic/shared';

const HERE = dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = resolve(HERE, '../../../hooks/vaultic-pretooluse.mjs');

const FINGERPRINTED_SECRET = 'sk-test-HookSecretVaulticFake112233';

interface HookOutput {
  hookSpecificOutput: {
    hookEventName: string;
    permissionDecision: string;
    permissionDecisionReason: string;
  };
}

function runHook(input: unknown, configDir: string, rawStdin?: string): Promise<HookOutput | undefined> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('node', [HOOK_PATH], {
      env: { ...process.env, VAULTIC_CONFIG_DIR: configDir },
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d.toString();
    });
    child.on('error', rejectPromise);
    child.on('close', () => resolvePromise(out ? (JSON.parse(out) as HookOutput) : undefined));
    child.stdin.end(rawStdin ?? JSON.stringify(input));
  });
}

function seedFingerprint(configDir: string, value: string): void {
  const store = new FingerprintStore(join(configDir, 'fingerprints.json'));
  store.addValue(value);
}

describe('vaultic-pretooluse hook', () => {
  let configDir: string;
  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'hook-cfg-'));
  });

  it('Write içinde fingerprintlenmiş secret → deny', async () => {
    seedFingerprint(configDir, FINGERPRINTED_SECRET);
    const out = await runHook(
      { tool_name: 'Write', tool_input: { file_path: '/tmp/x.ts', content: `const k = "${FINGERPRINTED_SECRET}";` } },
      configDir,
    );
    expect(out?.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('Bash export KEY=value (tırnaksız) fingerprintlenmiş tail → deny', async () => {
    seedFingerprint(configDir, FINGERPRINTED_SECRET);
    const out = await runHook(
      { tool_name: 'Bash', tool_input: { command: `export OPENAI_API_KEY=${FINGERPRINTED_SECRET}` } },
      configDir,
    );
    expect(out?.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('Bash generic pattern (store boş) → deny (regex katmanı)', async () => {
    const out = await runHook(
      { tool_name: 'Bash', tool_input: { command: 'export X=sk-proj-abcdefghijklmnopqrstuv1234' } },
      configDir,
    );
    expect(out?.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('vaultic config dizinine dokunan tool → deny (korumalı dizin)', async () => {
    const target = join(homedir(), '.config', 'vaultic', 'credentials.json');
    const out = await runHook(
      { tool_name: 'Bash', tool_input: { command: `cat ${target}` } },
      configDir,
    );
    expect(out?.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('temiz Write → karar yok (undefined, exit 0)', async () => {
    seedFingerprint(configDir, FINGERPRINTED_SECRET);
    const out = await runHook(
      { tool_name: 'Write', tool_input: { file_path: '/tmp/y.ts', content: 'console.log(1)' } },
      configDir,
    );
    expect(out).toBeUndefined();
  });

  it('Codex apply_patch komutu içindeki secret → deny (tam tool_input serileştirme)', async () => {
    seedFingerprint(configDir, FINGERPRINTED_SECRET);
    const patch = `*** Begin Patch\n*** Add File: cfg.ts\n+const k = "${FINGERPRINTED_SECRET}";\n*** End Patch`;
    const out = await runHook(
      { tool_name: 'apply_patch', tool_input: { command: patch } },
      configDir,
    );
    expect(out?.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('bozuk stdin (JSON değil) → exit 0, çıktı yok (fail-safe)', async () => {
    const out = await runHook(undefined, configDir, 'not json');
    expect(out).toBeUndefined();
  });
});
