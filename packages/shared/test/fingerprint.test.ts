import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FingerprintStore } from '../src/fingerprint.js';

const SECRET = 'sk-test-Abc123XyzVaulticFake0042';

describe('FingerprintStore', () => {
  let store: FingerprintStore;
  beforeEach(() => {
    store = new FingerprintStore(join(mkdtempSync(join(tmpdir(), 'fp-')), 'fp.json'));
  });

  it('eklenen değeri metin içinde yakalar', () => {
    store.addValue(SECRET);
    expect(store.containsSecret(`const k = "${SECRET}";`)).toBe(true);
  });
  it('base64 varyantını yakalar', () => {
    store.addValue(SECRET);
    const b64 = Buffer.from(SECRET).toString('base64');
    expect(store.containsSecret(`echo ${b64} | base64 -d`)).toBe(true);
  });
  it('URL-encoded varyantını yakalar', () => {
    store.addValue('sk-test-needs encoding+chars/=');
    expect(store.containsSecret(encodeURIComponent('sk-test-needs encoding+chars/='))).toBe(true);
  });
  it('temiz metinde false döner', () => {
    store.addValue(SECRET);
    expect(store.containsSecret('console.log("hello world")')).toBe(false);
  });
  it('diske yazıp tekrar yükler, ham değer dosyada YOKTUR', () => {
    store.addValue(SECRET);
    const reloaded = new FingerprintStore(store.filePath);
    expect(reloaded.containsSecret(SECRET)).toBe(true);
    expect(readFileSync(store.filePath, 'utf8')).not.toContain(SECRET);
  });
  it('dosya izni 0600', () => {
    store.addValue(SECRET);
    expect(statSync(store.filePath).mode & 0o777).toBe(0o600);
  });
  it('8 karakterden kısa değerleri eklemeyi reddeder', () => {
    expect(() => store.addValue('short')).toThrow(/too short/i);
  });
});
