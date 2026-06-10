import { formatVaultRef, parseVaultRef, type Manifest, type VaultRef } from '@vaultic/shared';
import type { SecretMeta, VaultBackend } from '../backend.js';

export interface CheckResult {
  mode: 'standard' | 'paranoid';
  present: string[];
  missing: string[];
}

export async function vaultCheck(deps: {
  backend: VaultBackend;
  manifest: Manifest | undefined;
}): Promise<CheckResult> {
  const { backend, manifest } = deps;
  if (!manifest) {
    throw new Error('No .aiv.yaml manifest found in project root — run `vaultic init` to create one');
  }
  const present: string[] = [];
  const missing: string[] = [];
  const cache = new Map<string, Set<string>>();
  for (const [envName, refString] of Object.entries(manifest.needs)) {
    const ref = parseVaultRef(refString);
    const scope = `${ref.workspace}/${ref.project}/${ref.environment}`;
    if (!cache.has(scope)) {
      const metas = await backend.listSecrets(ref);
      cache.set(scope, new Set(metas.map((m) => m.key)));
    }
    (cache.get(scope)!.has(ref.key) ? present : missing).push(envName);
  }
  return { mode: manifest.mode, present, missing };
}

export async function vaultList(
  deps: { backend: VaultBackend },
  scope: Pick<VaultRef, 'workspace' | 'project' | 'environment'>,
): Promise<SecretMeta[]> {
  return deps.backend.listSecrets(scope);
}

export function vaultRef(ref: VaultRef): string {
  return formatVaultRef(ref);
}
