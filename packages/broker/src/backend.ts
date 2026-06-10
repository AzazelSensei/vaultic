import type { VaultRef } from '@vaultic/shared';

export interface SecretMeta {
  key: string;
  environment: string;
  lastUpdated?: string;
}

export interface VaultBackend {
  listSecrets(ref: Pick<VaultRef, 'workspace' | 'project' | 'environment'>): Promise<SecretMeta[]>;
  getSecretValue(ref: VaultRef): Promise<string>;
  setSecret(ref: VaultRef, value: string): Promise<void>;
}
