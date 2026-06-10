export interface SecretPattern {
  id: string;
  pattern: RegExp;
}

export const GENERIC_SECRET_PATTERNS: SecretPattern[] = [
  { id: 'anthropic', pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'openai', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { id: 'aws-access-key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-pat', pattern: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: 'slack-token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'private-key', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { id: 'generic-assignment', pattern: /\b(api[_-]?key|secret|password|token)\s*[:=]\s*['"][^'"]{16,}['"]/i },
];

export function matchGenericSecret(text: string): SecretPattern | undefined {
  return GENERIC_SECRET_PATTERNS.find((p) => p.pattern.test(text));
}
