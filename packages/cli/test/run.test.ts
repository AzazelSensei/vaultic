import { describe, it, expect } from 'vitest';
import { assembleCommand } from '../src/commands/run.js';

describe('assembleCommand', () => {
  it('-- sonrası argümanları tek komut dizesine birleştirir', () => {
    expect(assembleCommand(['echo', 'hi'])).toBe('echo hi');
  });

  it('boş argüman için komut gerektiğini söyleyerek fırlatır', () => {
    expect(() => assembleCommand([])).toThrow(/no command|command required/i);
  });
});
