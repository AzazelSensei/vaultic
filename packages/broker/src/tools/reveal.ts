import { parseVaultRef, type FingerprintStore } from '@vaultic/shared';
import type { AuditLog } from '../audit.js';
import type { ApprovalProvider } from '../approval/types.js';
import type { VaultBackend } from '../backend.js';
import { safeFingerprint } from '../fingerprint-util.js';

export async function vaultRevealRequest(
  deps: { backend: VaultBackend; approver: ApprovalProvider; audit: AuditLog; fingerprints: FingerprintStore },
  args: { ref: string; reason: string },
): Promise<{ value: string; warning: string }> {
  const { backend, approver, audit, fingerprints } = deps;
  const ref = parseVaultRef(args.ref);
  const decision = await approver.requestApproval({ ref: args.ref, reason: args.reason });
  audit.record({ action: 'reveal', ref: args.ref, decision, channel: approver.channel, detail: args.reason });
  if (decision !== 'approved') {
    throw new Error(`Reveal ${decision} for ${args.ref} — user did not approve`);
  }
  const value = await backend.getSecretValue(ref);
  safeFingerprint(fingerprints, value);
  return {
    value,
    warning: 'One-time reveal. Do NOT write this value to any file or command — hooks will block it.',
  };
}

export async function vaultSetRequest(args: { ref: string }): Promise<{ instruction: string }> {
  parseVaultRef(args.ref);
  return {
    instruction:
      `Ask the user to run \`vaultic set ${args.ref}\` in their own terminal. ` +
      'The value is entered by the human via hidden prompt; the AI never sees it.',
  };
}
