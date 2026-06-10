import { describe, it, expect, vi } from 'vitest';
import { InfisicalBackend } from '../src/infisical.js';

const fakeSecretsApi = {
  listSecrets: vi.fn().mockResolvedValue({ secrets: [{ secretKey: 'OPENAI_API_KEY', updatedAt: '2026-06-01' }] }),
  getSecret: vi.fn().mockResolvedValue({ secretKey: 'OPENAI_API_KEY', secretValue: 'sk-test-12345678' }),
  createSecret: vi.fn().mockResolvedValue({}),
};
const loginFn = vi.fn().mockResolvedValue(undefined);
const fakeSdk = {
  auth: () => ({ universalAuth: { login: loginFn } }),
  secrets: () => fakeSecretsApi,
};

function makeBackend() {
  return new InfisicalBackend({
    config: {
      siteUrl: 'https://inf.example.com',
      workspaces: { ws: { projects: { proj: { projectId: 'pid-1' } } } },
    },
    credentials: { clientId: 'cid', clientSecret: 'cs' },
    sdkFactory: () => fakeSdk as never,
  });
}

describe('InfisicalBackend', () => {
  it('listSecrets projectId+environment ile çağırır, değer İSTEMEZ', async () => {
    const metas = await makeBackend().listSecrets({ workspace: 'ws', project: 'proj', environment: 'prod' });
    expect(metas[0]).toEqual({ key: 'OPENAI_API_KEY', environment: 'prod', lastUpdated: '2026-06-01' });
    expect(fakeSecretsApi.listSecrets).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'pid-1', environment: 'prod', viewSecretValue: false }),
    );
  });
  it('getSecretValue değeri döner', async () => {
    const v = await makeBackend().getSecretValue({ workspace: 'ws', project: 'proj', environment: 'prod', key: 'OPENAI_API_KEY' });
    expect(v).toBe('sk-test-12345678');
  });
  it('login yalnızca BİR kez yapılır (client cache)', async () => {
    const b = makeBackend();
    await b.listSecrets({ workspace: 'ws', project: 'proj', environment: 'prod' });
    await b.getSecretValue({ workspace: 'ws', project: 'proj', environment: 'prod', key: 'OPENAI_API_KEY' });
    expect(loginFn).toHaveBeenCalledTimes(1);
  });
  it('setSecret shared tipinde oluşturur', async () => {
    await makeBackend().setSecret({ workspace: 'ws', project: 'proj', environment: 'prod', key: 'NEW_KEY' }, 'sk-test-new-9999');
    expect(fakeSecretsApi.createSecret).toHaveBeenCalledWith('NEW_KEY', expect.objectContaining({ projectId: 'pid-1', environment: 'prod', secretValue: 'sk-test-new-9999', type: 'shared' }));
  });
  it('eşlenmemiş proje için anlamlı hata (vault link)', async () => {
    await expect(makeBackend().listSecrets({ workspace: 'ws', project: 'nope', environment: 'prod' }))
      .rejects.toThrow(/vaultic link/i);
  });
});
