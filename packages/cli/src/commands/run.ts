import { spawnSync } from 'node:child_process';
import type { Command } from 'commander';
import {
  InfisicalBackend,
  vaultRun,
  loadConfig,
  loadCredentials,
  fingerprintPath,
} from 'vaultic-broker';
import { FingerprintStore, loadManifest } from '@vaultic/shared';

const AGENT_VAULT_BIN = 'agent-vault';

const AGENT_VAULT_INSTALL =
  'vaultic: --paranoid needs agent-vault on your PATH, but it was not found.\n' +
  'Install it with:\n' +
  '  curl -sSL https://get.agent-vault.dev | sh\n' +
  'Pin v0.32.0 — it is a research preview and its API is subject to change.';

export function assembleCommand(args: string[]): string {
  if (args.length === 0) throw new Error('No command given — usage: vaultic run -- <cmd...>');
  return args.join(' ');
}

export function assertAgentVaultAvailable(lookup: (cmd: string) => string | undefined): void {
  if (lookup(AGENT_VAULT_BIN)) return;
  throw new Error(AGENT_VAULT_INSTALL);
}

function lookupOnPath(cmd: string): string | undefined {
  const probe = process.platform === 'win32' ? 'where' : 'command';
  const args = process.platform === 'win32' ? [cmd] : ['-v', cmd];
  const result = spawnSync(probe, args, { encoding: 'utf8', shell: process.platform !== 'win32' });
  if (result.status !== 0) return undefined;
  const path = result.stdout.split('\n')[0]?.trim();
  return path ? path : undefined;
}

function delegateToAgentVault(command: string): void {
  const child = spawnSync(AGENT_VAULT_BIN, ['run', '--', command], {
    stdio: 'inherit',
    shell: false,
  });
  if (child.error) throw child.error;
  process.exitCode = child.status ?? 1;
}

interface RunOptions {
  paranoid?: boolean;
}

export function registerRun(program: Command): void {
  program
    .command('run')
    .description('Run a command with manifest secrets injected and output redacted')
    .argument('[cmd...]', 'command to run after --, e.g. vaultic run -- npm test')
    .option('--paranoid', 'route the command through agent-vault so secrets are injected into outgoing HTTPS instead of env')
    .action(async (cmd: string[], opts: RunOptions) => {
      const command = assembleCommand(cmd);
      if (opts.paranoid) {
        assertAgentVaultAvailable(lookupOnPath);
        delegateToAgentVault(command);
        return;
      }
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
