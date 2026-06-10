import { describe, it, expect } from 'vitest';
import { redactSecrets, REDACTED_PLACEHOLDER } from '../src/redact.js';

const SECRET = 'sk-test-Abc123XyzVaulticFake0042';

describe('redactSecrets', () => {
  it('bilinen değerin tüm geçişlerini maskeler', () => {
    const text = `key=${SECRET} ve tekrar: ${SECRET}!`;
    const result = redactSecrets(text, [SECRET]);
    expect(result).toBe(`key=${REDACTED_PLACEHOLDER} ve tekrar: ${REDACTED_PLACEHOLDER}!`);
    expect(result).not.toContain(SECRET);
  });
  it('birden fazla değeri maskeler', () => {
    const other = 'ghp_FakeTokenForVaulticTests0042';
    const result = redactSecrets(`${SECRET} ${other}`, [SECRET, other]);
    expect(result).toBe(`${REDACTED_PLACEHOLDER} ${REDACTED_PLACEHOLDER}`);
  });
  it('boş liste metni değiştirmez', () => {
    expect(redactSecrets(`text with ${SECRET}`, [])).toBe(`text with ${SECRET}`);
  });
  it('boş string değerini atlar', () => {
    expect(redactSecrets('hello world', [''])).toBe('hello world');
  });
  it('literal eşleme: base64 varyantını maskelemez (bilinçli v1 sınırı)', () => {
    const b64 = Buffer.from(SECRET).toString('base64');
    expect(redactSecrets(b64, [SECRET])).toBe(b64);
  });
  it('I3: bir değer diğerinin prefix\'iyse uzun olanı tam maskeler (sıra bağımsız)', () => {
    const result = redactSecrets('k=ABCDEFGHIJKL', ['ABCDEF', 'ABCDEFGHIJKL']);
    expect(result).not.toContain('GHIJKL');
    expect(result).toBe(`k=${REDACTED_PLACEHOLDER}`);
  });
});
