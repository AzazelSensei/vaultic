import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { ApprovalDecision, ApprovalProvider, ApprovalRequest } from './types.js';

type ExecFn = (path: string, args: string[]) => Promise<{ exitCode: number }>;

const defaultExec: ExecFn = (path, args) =>
  new Promise((resolve) => {
    const child = execFile(path, args, () => resolve({ exitCode: child.exitCode ?? 1 }));
  });

export class TouchIdApprover implements ApprovalProvider {
  readonly channel = 'touchid' as const;
  constructor(
    private readonly options: { helperPath: string; exec?: ExecFn; env?: NodeJS.ProcessEnv },
  ) {}

  isAvailable(): boolean {
    const env = this.options.env ?? process.env;
    if (env.SSH_CONNECTION || env.SSH_TTY) return false;
    if (this.options.env !== undefined) return true;
    return process.platform === 'darwin' && existsSync(this.options.helperPath);
  }

  async requestApproval(req: ApprovalRequest): Promise<ApprovalDecision> {
    const exec = this.options.exec ?? defaultExec;
    const { exitCode } = await exec(this.options.helperPath, [`vaultic: ${req.ref} — ${req.reason}`]);
    return exitCode === 0 ? 'approved' : 'denied';
  }
}
