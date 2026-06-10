import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest } from '../src/manifest.js';

const VALID = `workspace: blackhole-labs
project: payment-api
mode: standard
needs:
  OPENAI_API_KEY: vault://blackhole-labs/payment-api/prod/OPENAI_API_KEY
`;

function writeTmpManifest(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'vaultic-'));
  writeFileSync(join(dir, '.aiv.yaml'), content);
  return dir;
}

describe('loadManifest', () => {
  it('geçerli manifesti yükler', () => {
    const m = loadManifest(writeTmpManifest(VALID));
    expect(m?.project).toBe('payment-api');
    expect(m?.mode).toBe('standard');
    expect(Object.keys(m!.needs)).toEqual(['OPENAI_API_KEY']);
  });
  it('dosya yoksa undefined döner', () => {
    expect(loadManifest(mkdtempSync(join(tmpdir(), 'vaultic-empty-')))).toBeUndefined();
  });
  it('mode verilmezse standard varsayar', () => {
    const m = loadManifest(writeTmpManifest(VALID.replace('mode: standard\n', '')));
    expect(m?.mode).toBe('standard');
  });
  it('geçersiz referansı anlamlı hatayla reddeder', () => {
    const bad = VALID.replace('vault://blackhole-labs/payment-api/prod/OPENAI_API_KEY', 'not-a-ref');
    expect(() => loadManifest(writeTmpManifest(bad))).toThrow(/Invalid vault reference/);
  });
  it('env değişken adı UPPER_SNAKE değilse reddeder', () => {
    const bad = VALID.replace('OPENAI_API_KEY:', 'openai_key:');
    expect(() => loadManifest(writeTmpManifest(bad))).toThrow(/env var name/i);
  });
});
