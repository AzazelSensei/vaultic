import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { FingerprintStore } from '../src/fingerprint.js';

const SECRET = 'sk-test-Abc123XyzVaulticFake0042';
const SECRET_B = 'sk-test-OtherSecretVaulticFake9988';

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

  it('C1: iki ayrı süreç aynı tuzu paylaşır, eklenen parmak izleri birleştirilir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-xproc-'));
    const path = join(dir, 'fp.json');
    const a = new FingerprintStore(path);
    const b = new FingerprintStore(path);
    a.addValue(SECRET);
    b.addValue(SECRET_B);
    const c = new FingerprintStore(path);
    expect(c.containsSecret(`x ${SECRET} y`)).toBe(true);
    expect(c.containsSecret(`x ${SECRET_B} y`)).toBe(true);
  });

  it('C1: stale cache yerine dosyadaki tuzla hash hesaplar (CLI eklemesini görür)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-stale-'));
    const path = join(dir, 'fp.json');
    const broker = new FingerprintStore(path);
    broker.addValue(SECRET);
    const cli = new FingerprintStore(path);
    cli.addValue(SECRET_B);
    expect(broker.containsSecret(`cmd ${SECRET_B} arg`)).toBe(true);
  });

  it('I1: addValue sonrası .tmp dosyası kalmaz, son dosya geçerli JSON', () => {
    store.addValue(SECRET);
    const dir = dirname(store.filePath);
    const leftover = readdirSync(dir).filter((f) => f.includes('.tmp'));
    expect(leftover).toEqual([]);
    expect(() => JSON.parse(readFileSync(store.filePath, 'utf8'))).not.toThrow();
  });

  it('I1: bozuk store dosyası containsSecret çağrısında throw eder (fail-OPEN değil)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-corrupt-'));
    const path = join(dir, 'fp.json');
    new FingerprintStore(path).addValue(SECRET);
    writeFileSync(path, '{ broken json');
    const reopened = () => new FingerprintStore(path).containsSecret('anything');
    expect(reopened).toThrow(/corrupt/i);
  });

  it('Minor: salt eksik/yanlış tipli dosya yapı doğrulamasıyla reddedilir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fp-shape-'));
    const path = join(dir, 'fp.json');
    writeFileSync(path, JSON.stringify({}));
    expect(() => new FingerprintStore(path)).toThrow();
  });

  it('I2: unquoted export KEY=value içindeki secret\'ı yakalar', () => {
    store.addValue(SECRET);
    expect(store.containsSecret(`export OPENAI_API_KEY=${SECRET}`)).toBe(true);
  });
});
