import { spawn } from 'node:child_process';
import { parseVaultRef, redactSecrets, type FingerprintStore, type Manifest } from '@vaultic/shared';
import type { VaultBackend } from '../backend.js';
import { safeFingerprint } from '../fingerprint-util.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 30_000;

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export async function vaultRun(
  deps: { backend: VaultBackend; manifest: Manifest | undefined; fingerprints: FingerprintStore },
  args: { command: string; cwd?: string; timeoutMs?: number },
): Promise<RunResult> {
  const { backend, manifest, fingerprints } = deps;
  if (!manifest) {
    throw new Error('No .aiv.yaml manifest found — run `vaultic init` first');
  }
  const injected: Record<string, string> = {};
  const values: string[] = [];
  for (const [envName, refString] of Object.entries(manifest.needs)) {
    const value = await backend.getSecretValue(parseVaultRef(refString));
    injected[envName] = value;
    values.push(value);
    safeFingerprint(fingerprints, value);
  }

  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', args.command], {
      cwd: args.cwd ?? process.cwd(),
      env: { ...process.env, ...injected },
      detached: true,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          void 0;
        }
      }
    }, args.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        stdout: redactSecrets(stdout, values).slice(0, MAX_OUTPUT_CHARS),
        stderr: redactSecrets(stderr, values).slice(0, MAX_OUTPUT_CHARS),
        timedOut,
      });
    });
  });
}
