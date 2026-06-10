import { describe, it, expect } from 'vitest';
import { renderCheckTable } from '../src/commands/check.js';

describe('renderCheckTable', () => {
  it('present ve missing anahtarlarını işaretleriyle birlikte içerir', () => {
    const out = renderCheckTable({ mode: 'standard', present: ['A'], missing: ['B'] });
    expect(out).toContain('A');
    expect(out).toContain('B');
    expect(out).toMatch(/present/i);
    expect(out).toMatch(/missing/i);
  });

  it('mode bilgisini içerir', () => {
    const out = renderCheckTable({ mode: 'standard', present: ['A'], missing: ['B'] });
    expect(out).toContain('standard');
    const paranoid = renderCheckTable({ mode: 'paranoid', present: [], missing: [] });
    expect(paranoid).toContain('paranoid');
  });

  it('boş manifest için yalnızca mode satırını üretir, hata vermez', () => {
    const out = renderCheckTable({ mode: 'standard', present: [], missing: [] });
    expect(out).toContain('standard');
  });
});
