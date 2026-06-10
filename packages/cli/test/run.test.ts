import { describe, it, expect } from 'vitest';
import { assembleCommand, assertAgentVaultAvailable } from '../src/commands/run.js';

describe('assembleCommand', () => {
  it('-- sonrası argümanları tek komut dizesine birleştirir', () => {
    expect(assembleCommand(['echo', 'hi'])).toBe('echo hi');
  });

  it('boş argüman için komut gerektiğini söyleyerek fırlatır', () => {
    expect(() => assembleCommand([])).toThrow(/no command|command required/i);
  });
});

describe('assertAgentVaultAvailable', () => {
  it('lookup bir yol döndürdüğünde fırlatmaz', () => {
    expect(() => assertAgentVaultAvailable(() => '/usr/local/bin/agent-vault')).not.toThrow();
  });

  it('lookup undefined döndürdüğünde kurulum yönergesiyle fırlatır', () => {
    expect(() => assertAgentVaultAvailable(() => undefined)).toThrow(
      /agent-vault|install|get\.agent-vault/,
    );
  });
});
