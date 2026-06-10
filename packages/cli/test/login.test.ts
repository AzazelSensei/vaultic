import { describe, it, expect } from 'vitest';
import { mkdtempSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeCredentials, writeSiteUrl } from '../src/commands/login.js';

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'vlogin-'));
}

describe('writeCredentials', () => {
  it('credentials.json dosyasını 0600 modunda yazar', () => {
    const dir = tmpDir();
    writeCredentials(dir, { clientId: 'cid', clientSecret: 'sec' });
    const mode = statSync(join(dir, 'credentials.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('clientId/clientSecret/telegramBotToken roundtrip eder', () => {
    const dir = tmpDir();
    writeCredentials(dir, { clientId: 'cid', clientSecret: 'sec', telegramBotToken: 'bot:123' });
    const parsed = JSON.parse(readFileSync(join(dir, 'credentials.json'), 'utf8'));
    expect(parsed).toEqual({ clientId: 'cid', clientSecret: 'sec', telegramBotToken: 'bot:123' });
  });
});

describe('writeSiteUrl', () => {
  it('config.json yoksa siteUrl + boş workspaces ile oluşturur', () => {
    const dir = tmpDir();
    writeSiteUrl(dir, 'https://infisical.example.com');
    const parsed = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    expect(parsed).toEqual({ siteUrl: 'https://infisical.example.com', workspaces: {} });
    const mode = statSync(join(dir, 'config.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('mevcut config.json varken workspaces korunur, siteUrl güncellenir', () => {
    const dir = tmpDir();
    const existing = {
      siteUrl: 'https://old.example.com',
      workspaces: { ws1: { projects: { proj1: { projectId: 'pid-1' } } } },
    };
    writeFileSync(join(dir, 'config.json'), JSON.stringify(existing));
    writeSiteUrl(dir, 'https://new.example.com');
    const parsed = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    expect(parsed.siteUrl).toBe('https://new.example.com');
    expect(parsed.workspaces).toEqual({ ws1: { projects: { proj1: { projectId: 'pid-1' } } } });
  });
});
