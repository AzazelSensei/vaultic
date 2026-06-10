import { join } from 'node:path';
import { homedir } from 'node:os';

export function configDir(): string {
  return process.env.VAULTIC_CONFIG_DIR ?? join(homedir(), '.config', 'vaultic');
}
