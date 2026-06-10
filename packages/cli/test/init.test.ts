import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadManifest, MANIFEST_FILENAME } from '@vaultic/shared';
import { writeManifestTemplate, ensureGitignoreEnv, buildInitHint } from '../src/commands/init.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'vinit-'));
}

describe('writeManifestTemplate', () => {
  it('loadManifest ile geri okunabilen .aiv.yaml yazar, needs boş', () => {
    const dir = tmpDir();
    writeManifestTemplate(dir, { workspace: 'acme', project: 'web', env: 'prod' });
    const manifest = loadManifest(dir);
    expect(manifest).toEqual({ workspace: 'acme', project: 'web', mode: 'standard', needs: {} });
  });

  it('needs altında 2-boşluk indent kullanır (SessionStart regex ile uyumlu)', () => {
    const dir = tmpDir();
    writeManifestTemplate(dir, { workspace: 'acme', project: 'web', env: 'prod' });
    const raw = readFileSync(join(dir, MANIFEST_FILENAME), 'utf8');
    const withKey = raw.replace(/needs:\s*\{\s*\}/, 'needs:\n  OPENAI_API_KEY: vault://acme/web/prod/OPENAI_API_KEY');
    const matches = [...withKey.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
    expect(matches).toContain('OPENAI_API_KEY');
  });

  it('zaten varsa /already exists/ fırlatır (clobber etmez)', () => {
    const dir = tmpDir();
    writeManifestTemplate(dir, { workspace: 'acme', project: 'web', env: 'prod' });
    expect(() =>
      writeManifestTemplate(dir, { workspace: 'other', project: 'thing', env: 'dev' }),
    ).toThrow(/already exists/);
    const manifest = loadManifest(dir);
    expect(manifest?.workspace).toBe('acme');
  });
});

describe('buildInitHint', () => {
  it('ipucu gerçek workspace/project/env değerlerini içerir', () => {
    const hint = buildInitHint({ workspace: 'acme', project: 'web', env: 'prod' });
    expect(hint).toContain('acme');
    expect(hint).toContain('web');
    expect(hint).toContain('prod');
    expect(hint).toContain('vault://acme/web/prod/');
  });
});

describe('ensureGitignoreEnv', () => {
  it('.gitignore yoksa .env içeren dosya oluşturur', () => {
    const dir = tmpDir();
    ensureGitignoreEnv(dir);
    const raw = readFileSync(join(dir, '.gitignore'), 'utf8');
    expect(raw.split(/\r?\n/)).toContain('.env');
  });

  it('mevcut .gitignore varsa .env ekler, idempotenttir', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, '.gitignore'), 'node_modules\n');
    ensureGitignoreEnv(dir);
    ensureGitignoreEnv(dir);
    const lines = readFileSync(join(dir, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(lines).toContain('node_modules');
    expect(lines.filter((l) => l === '.env')).toHaveLength(1);
  });

  it('mevcut .gitignore zaten .env içeriyorsa duplicate etmez', () => {
    const dir = tmpDir();
    writeFileSync(join(dir, '.gitignore'), '.env\nnode_modules\n');
    ensureGitignoreEnv(dir);
    const lines = readFileSync(join(dir, '.gitignore'), 'utf8').split(/\r?\n/);
    expect(lines.filter((l) => l === '.env')).toHaveLength(1);
    expect(existsSync(join(dir, '.gitignore'))).toBe(true);
  });
});
