import { describe, it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../src/server.js';
import type { VaultBackend } from '../src/backend.js';

const backend: VaultBackend = {
  listSecrets: async () => [{ key: 'K1', environment: 'prod' }],
  getSecretValue: async () => 'sk-test-srv-12345678',
  setSecret: async () => {},
};

async function connect(projectDir: string) {
  const server = buildServer({ backend, projectDir });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('buildServer', () => {
  it('6 tool kayıtlıdır', async () => {
    const client = await connect('/tmp/nonexistent-vaultic-proj');
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name).sort()).toEqual([
      'vault_check', 'vault_list', 'vault_ref', 'vault_reveal_request', 'vault_run', 'vault_set_request',
    ]);
  });
  it('vault_list isim döner, değer döndürmez', async () => {
    const client = await connect('/tmp/x');
    const result = await client.callTool({ name: 'vault_list', arguments: { workspace: 'ws', project: 'proj', environment: 'prod' } });
    const text = JSON.stringify(result);
    expect(text).toContain('K1');
    expect(text).not.toContain('sk-test-srv');
  });
  it('vault_ref geçerli referans üretir', async () => {
    const client = await connect('/tmp/x');
    const result = await client.callTool({ name: 'vault_ref', arguments: { workspace: 'ws', project: 'proj', environment: 'prod', key: 'MY_KEY' } });
    expect(JSON.stringify(result)).toContain('vault://ws/proj/prod/MY_KEY');
  });
  it('manifest yokken vault_check hata olarak döner (isError), crash etmez', async () => {
    const client = await connect('/tmp/nonexistent-vaultic-proj-xyz');
    const result = await client.callTool({ name: 'vault_check', arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toMatch(/aiv\.yaml|vaultic init/);
  });
});
