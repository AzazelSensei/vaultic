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

  it('vault:// ile başlamayan uzun girdiyi redact eder', () => {
    const longInput = 'x'.repeat(200);
    expect(() => parseVaultRef(longInput)).toThrow(/Invalid vault reference/);
    try {
      parseVaultRef(longInput);
      expect.unreachable('parseVaultRef fırlatmalıydı');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('redacted');
      expect(message).not.toContain('xxx');
    }
  });

  it('vault:// ile başlayan uzun girdiyi 32 karaktere kısaltır', () => {
    const longInput = 'vault://' + 'x'.repeat(200);
    expect(() => parseVaultRef(longInput)).toThrow(/Invalid vault reference/);
    try {
      parseVaultRef(longInput);
      expect.unreachable('parseVaultRef fırlatmalıydı');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain(longInput);
      expect(message).toContain('vault://' + 'x'.repeat(24) + '…');
      expect(message).not.toContain('x'.repeat(25));
    }
  });

  it('ref yerine yapıştırılan raw secret prefix\'ini sızdırmaz', () => {
    const secret = 'sk-proj-' + 'A'.repeat(60);
    expect(() => parseVaultRef(secret)).toThrow(/Invalid vault reference/);
    try {
      parseVaultRef(secret);
      expect.unreachable('parseVaultRef fırlatmalıydı');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('redacted');
      expect(message).not.toContain('sk-proj-');
      expect(message).toBe('Invalid vault reference (value does not start with vault://, redacted)');
    }
  });

  it('vault:// ile başlayan geçersiz girdiyi hata mesajında gösterir', () => {
    expect(() => parseVaultRef('vault://bad/REF')).toThrow(/Invalid vault reference/);
    try {
      parseVaultRef('vault://bad/REF');
      expect.unreachable('parseVaultRef fırlatmalıydı');
    } catch (err) {
      expect((err as Error).message).toContain('vault://bad/REF');
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
