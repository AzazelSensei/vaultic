import { describe, it, expect } from 'vitest';
import { mkdtempSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeProjectLink } from '../src/commands/link.js';

function tmpDirWithConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), 'vlink-'));
  writeFileSync(
    join(dir, 'config.json'),
    JSON.stringify({ siteUrl: 'https://infisical.example.com', workspaces: {} }),
  );
  return dir;
}

describe('writeProjectLink', () => {
  it('mevcut config üzerine ws1/proj1 → projectId ekler', () => {
    const dir = tmpDirWithConfig();
    writeProjectLink(dir, undefined, 'ws1/proj1', 'pid-123');
    const parsed = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    expect(parsed.siteUrl).toBe('https://infisical.example.com');
    expect(parsed.workspaces.ws1.projects.proj1).toEqual({ projectId: 'pid-123' });
    const mode = statSync(join(dir, 'config.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('ikinci çağrı proj2 ekler, proj1 düşmez', () => {
    const dir = tmpDirWithConfig();
    writeProjectLink(dir, undefined, 'ws1/proj1', 'pid-1');
    writeProjectLink(dir, undefined, 'ws1/proj2', 'pid-2');
    const parsed = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
    expect(parsed.workspaces.ws1.projects.proj1).toEqual({ projectId: 'pid-1' });
    expect(parsed.workspaces.ws1.projects.proj2).toEqual({ projectId: 'pid-2' });
  });

  it('slash içermeyen wsProj için hata fırlatır', () => {
    const dir = tmpDirWithConfig();
    expect(() => writeProjectLink(dir, undefined, 'noslash', 'pid')).toThrow(/ws\/proj|slash|format/);
  });
});
