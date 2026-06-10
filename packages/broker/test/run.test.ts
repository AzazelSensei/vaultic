import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { vaultRun } from '../src/tools/run.js';
import { FingerprintStore } from '@vaultic/shared';
import type { VaultBackend } from '../src/backend.js';

const SECRET = 'sk-test-RunSecret12345678';
const backend: VaultBackend = {
  listSecrets: async () => [{ key: 'MY_API_KEY', environment: 'prod' }],
  getSecretValue: async () => SECRET,
  setSecret: async () => {},
};
const manifest = {
  workspace: 'ws',
  project: 'proj',
  mode: 'standard' as const,
  needs: { MY_API_KEY: 'vault://ws/proj/prod/MY_API_KEY' },
};
function makeStore() {
  return new FingerprintStore(join(mkdtempSync(join(tmpdir(), 'run-')), 'fp.json'));
}

describe('vaultRun', () => {
  it("secret'ı env'e inject eder, çıktıda redakte eder", async () => {
    const r = await vaultRun(
      { backend, manifest, fingerprints: makeStore() },
      { command: 'echo "key is $MY_API_KEY"' },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('[vaultic:redacted]');
    expect(r.stdout).not.toContain(SECRET);
  });

  it("fingerprint store'a değeri kaydeder", async () => {
    const store = makeStore();
    await vaultRun({ backend, manifest, fingerprints: store }, { command: 'true' });
    expect(store.containsSecret(`x=${SECRET}`)).toBe(true);
  });

  it('komut hata kodunu aynen taşır', async () => {
    const r = await vaultRun({ backend, manifest, fingerprints: makeStore() }, { command: 'exit 3' });
    expect(r.exitCode).toBe(3);
  });

  it('manifest yoksa hata verir', async () => {
    await expect(
      vaultRun({ backend, manifest: undefined, fingerprints: makeStore() }, { command: 'true' }),
    ).rejects.toThrow(/vaultic init/);
  });

  it('stderr de redakte edilir', async () => {
    const r = await vaultRun(
      { backend, manifest, fingerprints: makeStore() },
      { command: 'echo "$MY_API_KEY" 1>&2' },
    );
    expect(r.stderr).toContain('[vaultic:redacted]');
    expect(r.stderr).not.toContain(SECRET);
  });

  it('çok kısa secret crash etmeden çalışır ve yine redakte edilir', async () => {
    const shortSecret = 'sk123';
    const shortBackend: VaultBackend = {
      listSecrets: async () => [{ key: 'MY_API_KEY', environment: 'prod' }],
      getSecretValue: async () => shortSecret,
      setSecret: async () => {},
    };
    const r = await vaultRun(
      { backend: shortBackend, manifest, fingerprints: makeStore() },
      { command: 'echo "v=$MY_API_KEY"' },
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('[vaultic:redacted]');
    expect(r.stdout).not.toContain(shortSecret);
  });

  it('uzun çıktıda secret truncate sınırında sızmaz', async () => {
    const r = await vaultRun(
      { backend, manifest, fingerprints: makeStore() },
      { command: `printf 'A%.0s' {1..40000}; echo "$MY_API_KEY"` },
    );
    expect(r.stdout).not.toContain(SECRET);
  });

  it(
    "timeout: torun süreç secret'larla hayatta kalmaz, promise zamanında çözülür",
    async () => {
      const leakFile = join(mkdtempSync(join(tmpdir(), 'run-leak-')), 'leak.txt');
      const command = `( sleep 5; echo "$MY_API_KEY" > ${leakFile} ) & echo started`;
      const start = Date.now();
      const r = await vaultRun(
        { backend, manifest, fingerprints: makeStore() },
        { command, timeoutMs: 800 },
      );
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(2000);
      expect(r.timedOut).toBe(true);
      expect(r.exitCode).toBe(124);

      await sleep(300);
      if (existsSync(leakFile)) {
        expect(readFileSync(leakFile, 'utf8')).not.toContain(SECRET);
      }
    },
    10000,
  );
});
