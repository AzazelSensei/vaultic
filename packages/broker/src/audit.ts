import { appendFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_DETAIL_LENGTH = 200;

export interface AuditEvent {
  action: 'reveal' | 'run' | 'set' | 'check' | 'list';
  ref?: string;
  decision?: 'approved' | 'denied' | 'timeout';
  channel?: 'touchid' | 'telegram' | 'none';
  detail?: string;
}

export class AuditLog {
  constructor(private readonly path: string) {}

  record(event: AuditEvent): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const isNew = !existsSync(this.path);
    const safeEvent =
      event.detail !== undefined && event.detail.length > MAX_DETAIL_LENGTH
        ? { ...event, detail: `${event.detail.slice(0, MAX_DETAIL_LENGTH - 1)}…` }
        : event;
    appendFileSync(this.path, `${JSON.stringify({ ts: new Date().toISOString(), ...safeEvent })}\n`);
    if (isNew) chmodSync(this.path, 0o600);
  }
}
