import type { Command } from 'commander';
import {
  InfisicalBackend,
  vaultCheck,
  loadConfig,
  loadCredentials,
  type CheckResult,
} from 'vaultic-broker';
import { loadManifest } from '@vaultic/shared';

const PRESENT_MARK = 'present';
const MISSING_MARK = 'missing';

export function renderCheckTable(result: CheckResult): string {
  const lines = [`mode: ${result.mode}`];
  const width = Math.max(0, ...result.present.map((k) => k.length), ...result.missing.map((k) => k.length));
  for (const key of result.present) lines.push(`  ${key.padEnd(width)}  ${PRESENT_MARK}`);
  for (const key of result.missing) lines.push(`  ${key.padEnd(width)}  ${MISSING_MARK}`);
  return lines.join('\n');
}

export function registerCheck(program: Command): void {
  program
    .command('check')
    .description('Show which secrets the manifest needs and which exist in the vault (no values)')
    .action(async () => {
      const manifest = loadManifest(process.cwd());
      if (!manifest) throw new Error('No .aiv.yaml found — run `vaultic init` first');
      const backend = new InfisicalBackend({ config: loadConfig(), credentials: loadCredentials() });
      const result = await vaultCheck({ backend, manifest });
      process.stdout.write(`${renderCheckTable(result)}\n`);
    });
}
