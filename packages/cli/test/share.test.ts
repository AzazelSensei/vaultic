import { describe, it, expect } from 'vitest';
import { buildShareUrl } from '../src/commands/share.js';

const CONFIG = {
  siteUrl: 'https://inf.example.com',
  workspaces: { ws1: { projects: { proj1: { projectId: 'pid-9' } } } },
};

describe('buildShareUrl', () => {
  it('ws/proj eşlemesinden access-management URL üretir', () => {
    expect(buildShareUrl(CONFIG as never, 'ws1/proj1')).toBe(
      'https://inf.example.com/project/pid-9/access-management',
    );
  });

  it('eşlenmemiş proje için /vaultic link/ fırlatır', () => {
    expect(() => buildShareUrl(CONFIG as never, 'ws1/nope')).toThrow(/vaultic link/);
  });

  it('slash içermeyen wsProj için ws/proj format hatası fırlatır', () => {
    expect(() => buildShareUrl(CONFIG as never, 'noslash')).toThrow(/ws\/proj|slash|format/);
  });
});
