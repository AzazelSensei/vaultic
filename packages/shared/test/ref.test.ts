import { describe, it, expect } from 'vitest';
import { parseVaultRef, formatVaultRef } from '../src/ref.js';

describe('parseVaultRef', () => {
  it('geçerli referansı parse eder', () => {
    expect(parseVaultRef('vault://blackhole-labs/payment-api/prod/OPENAI_API_KEY')).toEqual({
      workspace: 'blackhole-labs',
      project: 'payment-api',
      environment: 'prod',
      key: 'OPENAI_API_KEY',
    });
  });

  it('roundtrip çalışır', () => {
    const ref = 'vault://ws/proj/dev/MY_KEY_2';
    expect(formatVaultRef(parseVaultRef(ref))).toBe(ref);
  });

  it.each([
    'vault://ws/proj/dev/lower_case',
    'vault://ws/proj/dev',
    'http://ws/proj/dev/KEY',
    'vault://ws/proj/dev/KEY/extra',
    'vault://WS/proj/dev/KEY',
  ])('geçersiz referansı reddeder: %s', (bad) => {
    expect(() => parseVaultRef(bad)).toThrow(/Invalid vault reference/);
  });

  it('hata mesajında uzun girdiyi 120 karaktere kısaltır', () => {
    const longInput = 'x'.repeat(200);
    expect(() => parseVaultRef(longInput)).toThrow(/Invalid vault reference/);
    try {
      parseVaultRef(longInput);
      expect.unreachable('parseVaultRef fırlatmalıydı');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain(longInput);
      expect(message).toContain('x'.repeat(120) + '…');
      expect(message).not.toContain('x'.repeat(121));
    }
  });
});

describe('formatVaultRef', () => {
  it.each([
    { workspace: 'WS', project: 'p', environment: 'dev', key: 'KEY' },
    { workspace: 'ws', project: 'p', environment: 'dev', key: 'lower' },
  ])('geçersiz alan içeren referansı reddeder: %o', (bad) => {
    expect(() => formatVaultRef(bad)).toThrow(/Invalid vault reference/);
  });
});
