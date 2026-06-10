import type { Command } from 'commander';
import {
  InfisicalBackend,
  safeFingerprint,
  AuditLog,
  loadConfig,
  loadCredentials,
  configDir,
  fingerprintPath,
} from 'vaultic-broker';
import { parseVaultRef, formatVaultRef, FingerprintStore, type VaultRef } from '@vaultic/shared';
import { promptHidden } from './login.js';

const AUDIT_FILE = 'audit.log';
const SET_PROMPT = 'Secret value: ';

interface InlineValueArgs {
  extraArgs: string[];
  value: string | undefined;
}

export function assertNoInlineValue(args: InlineValueArgs): void {
  if (args.extraArgs.length > 0 || args.value !== undefined) {
    throw new Error('Refusing to set: never pass a secret value via argv — value must be entered at the hidden prompt');
  }
}

interface SetDeps {
  backend: { setSecret(ref: VaultRef, value: string): Promise<void> };
  fingerprint: (value: string) => void;
  audit: { record(event: { action: 'set'; ref: string }): void };
}

interface RunSetInput {
  ref: string;
  prompt: (label: string) => Promise<string>;
  deps: SetDeps | undefined;
}

export async function runSet({ ref, prompt, deps }: RunSetInput): Promise<void> {
  const parsed = parseVaultRef(ref);
  if (!deps) return;
  const value = await prompt(SET_PROMPT);
  await deps.backend.setSecret(parsed, value);
  deps.fingerprint(value);
  deps.audit.record({ action: 'set', ref: formatVaultRef(parsed) });
}

export function registerSet(program: Command): void {
  program
    .command('set')
    .description('Set a secret value in the vault (value via hidden prompt, never argv)')
    .argument('<ref>', 'vault reference, e.g. vault://acme/web/prod/OPENAI_API_KEY')
    .argument('[extra...]', 'reserved — passing a value here is rejected')
    .option('--value <value>', 'rejected — values must be entered at the hidden prompt')
    .action(async (ref: string, extra: string[], opts: { value?: string }) => {
      assertNoInlineValue({ extraArgs: extra, value: opts.value });
      const store = new FingerprintStore(fingerprintPath());
      const deps: SetDeps = {
        backend: new InfisicalBackend({ config: loadConfig(), credentials: loadCredentials() }),
        fingerprint: (value: string) => safeFingerprint(store, value),
        audit: new AuditLog(`${configDir()}/${AUDIT_FILE}`),
      };
      await runSet({ ref, prompt: promptHidden, deps });
      process.stdout.write(`Set ${ref}\n`);
    });
}
