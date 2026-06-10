export type ApprovalDecision = 'approved' | 'denied' | 'timeout';

export interface ApprovalRequest {
  ref: string;
  reason: string;
}

export interface ApprovalProvider {
  readonly channel: 'touchid' | 'telegram';
  isAvailable(): boolean;
  requestApproval(req: ApprovalRequest): Promise<ApprovalDecision>;
  close?(): Promise<void> | void;
}
