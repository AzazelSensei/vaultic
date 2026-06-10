import { describe, it, expect } from 'vitest';
import { vaultCheck, vaultList, vaultRef } from '../src/tools/readonly.js';
import type { VaultBackend } from '../src/backend.js';

const backend: VaultBackend = {
  listSecrets: async () => [{ key: 'OPENAI_API_KEY', environment: 'prod' }],
  getSecretValue: async () => {
    throw new Error('not used');
  },
  setSecret: async () => {},
};

const manifest = {
  workspace: 'ws',
  project: 'proj',
  mode: 'standard' as const,
  needs: {
    OPENAI_API_KEY: 'vault://ws/proj/prod/OPENAI_API_KEY',
    MISSING_KEY: 'vault://ws/proj/prod/MISSING_KEY',
  },
};

describe('vaultCheck', () => {
  it("mevcut ve eksik secret'ları raporlar, değer içermez", async () => {
    const r = await vaultCheck({ backend, manifest });
    expect(r.present).toEqual(['OPENAI_API_KEY']);
    expect(r.missing).toEqual(['MISSING_KEY']);
    expect(r.mode).toBe('standard');
  });
  it('manifest yoksa yol gösteren hata verir', async () => {
    await expect(vaultCheck({ backend, manifest: undefined })).rejects.toThrow(
      /\.aiv\.yaml|vaultic init/,
    );
  });
  it("aynı scope için listSecrets'i bir kez çağırır (cache)", async () => {
    let calls = 0;
    const counting: VaultBackend = {
      listSecrets: async () => {
        calls++;
        return [{ key: 'OPENAI_API_KEY', environment: 'prod' }];
      },
      getSecretValue: async () => {
        throw new Error('x');
      },
      setSecret: async () => {},
    };
    await vaultCheck({ backend: counting, manifest });
    expect(calls).toBe(1);
  });
});

describe('vaultList', () => {
  it('sadece isim+metadata döner', async () => {
    const r = await vaultList({ backend }, { workspace: 'ws', project: 'proj', environment: 'prod' });
    expect(r).toEqual([{ key: 'OPENAI_API_KEY', environment: 'prod' }]);
  });
});

describe('vaultRef', () => {
  it("geçerli referans string'i üretir", () => {
    expect(vaultRef({ workspace: 'ws', project: 'proj', environment: 'prod', key: 'MY_KEY' })).toBe(
      'vault://ws/proj/prod/MY_KEY',
    );
  });
});
