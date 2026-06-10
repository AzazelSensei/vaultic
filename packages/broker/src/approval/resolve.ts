import type { ApprovalProvider } from './types.js';

export function resolveApprover(deps: { approvers: ApprovalProvider[] }): ApprovalProvider {
  const available = deps.approvers.find((a) => a.isAvailable());
  if (!available) {
    throw new Error(
      'No approval channel available — configure Touch ID helper (macOS) or Telegram (vaultic login --telegram)',
    );
  }
  return available;
}
