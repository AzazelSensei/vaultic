import { describe, it, expect, vi } from 'vitest';
import { TouchIdApprover } from '../src/approval/touchid.js';
import { resolveApprover } from '../src/approval/resolve.js';

describe('TouchIdApprover', () => {
  it('helper exit 0 → approved', async () => {
    const exec = vi.fn().mockResolvedValue({ exitCode: 0 });
    const a = new TouchIdApprover({ helperPath: '/x/helper', exec, env: {} });
    expect(await a.requestApproval({ ref: 'vault://w/p/e/K', reason: 'test' })).toBe('approved');
  });
  it('helper exit 1 → denied', async () => {
    const exec = vi.fn().mockResolvedValue({ exitCode: 1 });
    const a = new TouchIdApprover({ helperPath: '/x/helper', exec, env: {} });
    expect(await a.requestApproval({ ref: 'vault://w/p/e/K', reason: 'test' })).toBe('denied');
  });
  it('SSH oturumunda kullanılamaz', () => {
    const a = new TouchIdApprover({ helperPath: '/x/helper', exec: vi.fn(), env: { SSH_CONNECTION: '1' } });
    expect(a.isAvailable()).toBe(false);
  });
  it('env override verildiğinde (test) platform bağımsız available', () => {
    const a = new TouchIdApprover({ helperPath: '/x/helper', exec: vi.fn(), env: {} });
    expect(a.isAvailable()).toBe(true);
  });
});

describe('resolveApprover', () => {
  it('hiçbir kanal yoksa anlamlı hata verir', () => {
    expect(() => resolveApprover({ approvers: [] })).toThrow(/no approval channel/i);
  });
  it('ilk available approver seçilir', () => {
    const unavailable = { channel: 'touchid' as const, isAvailable: () => false, requestApproval: async () => 'denied' as const };
    const available = { channel: 'telegram' as const, isAvailable: () => true, requestApproval: async () => 'approved' as const };
    expect(resolveApprover({ approvers: [unavailable, available] })).toBe(available);
  });
});
