import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, resolveProjectId } from '../src/config.js';

function tmpConfigDir(config: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'vcfg-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config));
  return dir;
}

const CFG = {
  siteUrl: 'https://infisical.example.com',
  workspaces: { ws1: { projects: { proj1: { projectId: 'pid-123' } } } },
};

describe('config', () => {
  it('config dosyasını yükler', () => {
    expect(loadConfig(tmpConfigDir(CFG)).siteUrl).toBe('https://infisical.example.com');
  });
  it('eksik config anlamlı hata verir', () => {
    expect(() => loadConfig(mkdtempSync(join(tmpdir(), 'vcfg-e-')))).toThrow(/vaultic login/);
  });
  it('workspace/proje → projectId çözer', () => {
    expect(resolveProjectId(loadConfig(tmpConfigDir(CFG)), 'ws1', 'proj1')).toBe('pid-123');
  });
  it('eşlenmemiş proje için vaultic link öneren hata verir', () => {
    expect(() => resolveProjectId(loadConfig(tmpConfigDir(CFG)), 'ws1', 'nope')).toThrow(/vaultic link/);
  });
});
