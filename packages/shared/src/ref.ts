export interface VaultRef {
  workspace: string;
  project: string;
  environment: string;
  key: string;
}

const REF_PATTERN =
  /^vault:\/\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/([A-Z][A-Z0-9_]*)$/;

export function parseVaultRef(ref: string): VaultRef {
  const m = REF_PATTERN.exec(ref);
  if (!m) {
    throw new Error(
      `Invalid vault reference: ${ref} (expected vault://workspace/project/env/UPPER_SNAKE_KEY)`,
    );
  }
  return { workspace: m[1], project: m[2], environment: m[3], key: m[4] };
}

export function formatVaultRef(r: VaultRef): string {
  return `vault://${r.workspace}/${r.project}/${r.environment}/${r.key}`;
}
