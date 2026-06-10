import { describe, it, expect } from 'vitest';
import { matchGenericSecret } from '../src/patterns.js';

describe('matchGenericSecret', () => {
  it.each([
    ['sk-ant-api03-abcdefghijklmnopqrstuv', 'anthropic'],
    ['sk-proj-abcdefghijklmnopqrstuv123456', 'openai'],
    ['AKIAIOSFODNN7EXAMPLE', 'aws-access-key'],
    ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'github-pat'],
    ['xoxb-test-not-a-real-token-0000', 'slack-token'],
    ['-----BEGIN RSA PRIVATE KEY-----', 'private-key'],
    ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc123def456', 'jwt'],
    ['api_key = "abcdefghijklmnop123456"', 'generic-assignment'],
  ])('yakalar: %s → %s', (text, id) => {
    expect(matchGenericSecret(text)?.id).toBe(id);
  });
  it('normal metni yakalamaz', () => {
    expect(matchGenericSecret('const apiKey = process.env.OPENAI_API_KEY')).toBeUndefined();
  });
});
