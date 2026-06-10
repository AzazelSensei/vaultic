import { describe, it, expect, vi } from 'vitest';
import { assertNoInlineValue, runSet } from '../src/commands/set.js';

const VALID_REF = 'vault://acme/web/prod/OPENAI_API_KEY';

describe('assertNoInlineValue', () => {
  it('ekstra positional argüman varsa fırlatır', () => {
    expect(() => assertNoInlineValue({ extraArgs: ['hunter2'], value: undefined })).toThrow(
      /never pass.*value|value must be entered/i,
    );
  });

  it('--value flag verilmişse fırlatır', () => {
    expect(() => assertNoInlineValue({ extraArgs: [], value: 'hunter2' })).toThrow(
      /never pass.*value|value must be entered/i,
    );
  });

  it('ekstra argüman yoksa geçer', () => {
    expect(() => assertNoInlineValue({ extraArgs: [], value: undefined })).not.toThrow();
  });
});

describe('runSet ref-parse-first', () => {
  it('geçersiz ref için prompt çağrılmadan /Invalid vault reference/ fırlatır', async () => {
    const prompt = vi.fn();
    await expect(
      runSet({ ref: 'not-a-vault-ref', prompt, deps: undefined }),
    ).rejects.toThrow(/Invalid vault reference/);
    expect(prompt).not.toHaveBeenCalled();
  });

  it('geçerli ref için promptu çağırır (deps verilince devam eder)', async () => {
    const prompt = vi.fn().mockResolvedValue('a-real-secret-value');
    const setSecret = vi.fn().mockResolvedValue(undefined);
    const fingerprint = vi.fn();
    const record = vi.fn();
    await runSet({
      ref: VALID_REF,
      prompt,
      deps: {
        backend: { setSecret } as never,
        fingerprint,
        audit: { record } as never,
      },
    });
    expect(prompt).toHaveBeenCalledOnce();
    expect(setSecret).toHaveBeenCalledOnce();
    expect(fingerprint).toHaveBeenCalledWith('a-real-secret-value');
    expect(record).toHaveBeenCalledWith({ action: 'set', ref: VALID_REF });
  });
});
