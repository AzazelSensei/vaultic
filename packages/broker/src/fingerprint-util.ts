import type { FingerprintStore } from '@vaultic/shared';

export function safeFingerprint(store: FingerprintStore, value: string): void {
  try {
    store.addValue(value);
  } catch (err) {
    console.error(`vaultic: skipped fingerprinting a secret value: ${(err as Error).message}`);
  }
}
