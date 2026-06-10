import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { vaultRevealRequest, vaultSetRequest } from '../src/tools/reveal.js';
import { AuditLog } from '../src/audit.js';
import { FingerprintStore } from '@vaultic/shared';
import type { ApprovalProvider } from '../src/approval/types.js';
import type { VaultBackend } from '../src/backend.js';

const SECRET = 'sk-test-Reveal0987654321';
const backend: VaultBackend = {
  listSecrets: async () => [],
  getSecretValue: async () => SECRET,
  setSecret: async () => {},
};
function deps(decision: 'approved' | 'denied' | 'timeout') {
  const dir = mkdtempSync(join(tmpdir(), 'rev-'));
  const approver: ApprovalProvider = {
    channel: 'touchid',
    isAvailable: () => true,
    requestApproval: async () => decision,
  };
  return {
    backend, approver,
    audit: new AuditLog(join(dir, 'audit.jsonl')),
    fingerprints: new FingerprintStore(join(dir, 'fp.json')),
    auditPath: join(dir, 'audit.jsonl'),
  };
}

describe('vaultRevealRequest', () => {
  it('onaylanırsa değeri döner ve fingerprint kaydeder', async () => {
    const d = deps('approved');
    const r = await vaultRevealRequest(d, { ref: 'vault://ws/proj/prod/KEY_NAME', reason: 'dashboard' });
    expect(r.value).toBe(SECRET);
    expect(r.warning).toMatch(/do not|never|one-time/i);
    expect(d.fingerprints.containsSecret(SECRET)).toBe(true);
  });
  it('onaylanırsa audit\'e approved kaydı düşer (değer içermez)', async () => {
    const d = deps('approved');
    await vaultRevealRequest(d, { ref: 'vault://ws/proj/prod/KEY_NAME', reason: 'dashboard' });
    const line = readFileSync(d.auditPath, 'utf8').trim();
    expect(line).toContain('"decision":"approved"');
    expect(line).not.toContain(SECRET);
  });
  it('reddedilirse değer İÇERMEYEN hata fırlatır ve audit\'e denied düşer', async () => {
    const d = deps('denied');
    await expect(
      vaultRevealRequest(d, { ref: 'vault://ws/proj/prod/KEY_NAME', reason: 'x' }),
    ).rejects.toThrow(/denied/i);
    expect(readFileSync(d.auditPath, 'utf8')).toContain('"decision":"denied"');
  });
  it('reddedilirse backend.getSecretValue ÇAĞRILMAZ', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rev2-'));
    let called = false;
    const d = {
      backend: { listSecrets: async () => [], getSecretValue: async () => { called = true; return SECRET; }, setSecret: async () => {} },
      approver: { channel: 'touchid' as const, isAvailable: () => true, requestApproval: async () => 'denied' as const },
      audit: new AuditLog(join(dir, 'a.jsonl')),
      fingerprints: new FingerprintStore(join(dir, 'fp.json')),
    };
    await expect(vaultRevealRequest(d, { ref: 'vault://ws/proj/prod/KEY_NAME', reason: 'x' })).rejects.toThrow();
    expect(called).toBe(false);
  });
  it('geçersiz ref reddedilir', async () => {
    await expect(vaultRevealRequest(deps('approved'), { ref: 'not-a-ref', reason: 'x' })).rejects.toThrow(/Invalid vault reference/);
  });
  it('kısa değer (5 char) için fingerprint atlanır, hata fırlatmaz, değeri döner', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rev3-'));
    const shortBackend: VaultBackend = { listSecrets: async () => [], getSecretValue: async () => 'short', setSecret: async () => {} };
    const d = {
      backend: shortBackend,
      approver: { channel: 'touchid' as const, isAvailable: () => true, requestApproval: async () => 'approved' as const },
      audit: new AuditLog(join(dir, 'audit.jsonl')),
      fingerprints: new FingerprintStore(join(dir, 'fp.json')),
    };
    const r = await vaultRevealRequest(d, { ref: 'vault://ws/proj/prod/SHORT_KEY', reason: 'x' });
    expect(r.value).toBe('short');
    expect(d.fingerprints.containsSecret('short')).toBe(false);
  });
});

describe('vaultSetRequest', () => {
  it('AI\'ya değer girdirmez, CLI komutu tarif eder', async () => {
    const r = await vaultSetRequest({ ref: 'vault://ws/proj/prod/NEW_KEY' });
    expect(r.instruction).toContain('vaultic set vault://ws/proj/prod/NEW_KEY');
  });
  it('geçersiz ref reddedilir', async () => {
    await expect(vaultSetRequest({ ref: 'bad' })).rejects.toThrow(/Invalid vault reference/);
  });
});
