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
});
