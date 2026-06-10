export const REDACTED_PLACEHOLDER = '[vaultic:redacted]';

export function redactSecrets(text: string, values: string[]): string {
  let result = text;
  for (const value of values) {
    if (value.length === 0) continue;
    result = result.split(value).join(REDACTED_PLACEHOLDER);
  }
  return result;
}
