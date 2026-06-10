export interface VaultRef {
  workspace: string;
  project: string;
  environment: string;
  key: string;
}

const REF_PATTERN =
  /^vault:\/\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/([A-Z][A-Z0-9_]*)$/;

const MAX_ECHOED_REF_LENGTH = 32;
const VAULT_REF_PREFIX = 'vault://';

export function parseVaultRef(ref: string): VaultRef {
  const m = REF_PATTERN.exec(ref);
  if (!m) {
    if (!ref.startsWith(VAULT_REF_PREFIX)) {
      throw new Error('Invalid vault reference (value does not start with vault://, redacted)');
    }
    const echoed =
      ref.length > MAX_ECHOED_REF_LENGTH ? `${ref.slice(0, MAX_ECHOED_REF_LENGTH)}…` : ref;
    throw new Error(
      `Invalid vault reference: ${echoed} (expected vault://workspace/project/env/UPPER_SNAKE_KEY)`,
    );
  }
  return { workspace: m[1], project: m[2], environment: m[3], key: m[4] };
}

export function formatVaultRef(r: VaultRef): string {
  const ref = `vault://${r.workspace}/${r.project}/${r.environment}/${r.key}`;
  parseVaultRef(ref);
  return ref;
}
