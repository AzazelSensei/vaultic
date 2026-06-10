import type { Command } from 'commander';
import {
  InfisicalBackend,
  vaultRun,
  loadConfig,
  loadCredentials,
  fingerprintPath,
} from 'vaultic-broker';
import { FingerprintStore, loadManifest } from '@vaultic/shared';

const PARANOID_NOTICE =
  'vaultic: --paranoid is not active yet — paranoid routing through agent-vault arrives in a later release; running normally for now.';

export function assembleCommand(args: string[]): string {
  if (args.length === 0) throw new Error('No command given — usage: vaultic run -- <cmd...>');
  return args.join(' ');
}

interface RunOptions {
  paranoid?: boolean;
}

export function registerRun(program: Command): void {
  program
    .command('run')
    .description('Run a command with manifest secrets injected and output redacted')
    .argument('[cmd...]', 'command to run after --, e.g. vaultic run -- npm test')
    .option('--paranoid', 'reserved — paranoid mode routes through agent-vault (not yet active)')
    .action(async (cmd: string[], opts: RunOptions) => {
      if (opts.paranoid) process.stderr.write(`${PARANOID_NOTICE}\n`);
      const command = assembleCommand(cmd);
      const manifest = loadManifest(process.cwd());
      if (!manifest) throw new Error('No .aiv.yaml found — run `vaultic init` first');
      const backend = new InfisicalBackend({ config: loadConfig(), credentials: loadCredentials() });
      const fingerprints = new FingerprintStore(fingerprintPath());
      const result = await vaultRun({ backend, manifest, fingerprints }, { command });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      process.exitCode = result.exitCode;
    });
}
