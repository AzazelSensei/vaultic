import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import * as z from 'zod';

const ConfigSchema = z.object({
  siteUrl: z.url(),
  workspaces: z.record(z.string(), z.object({
    projects: z.record(z.string(), z.object({ projectId: z.string() })),
  })),
  approval: z.object({ telegramAllowedUserId: z.number().optional() }).optional(),
});
const CredentialsSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  telegramBotToken: z.string().optional(),
});

export type VaulticConfig = z.infer<typeof ConfigSchema>;
export type VaulticCredentials = z.infer<typeof CredentialsSchema>;

export function configDir(): string {
  return process.env.VAULTIC_CONFIG_DIR ?? join(homedir(), '.config', 'vaultic');
}

function loadJsonFile(dir: string, name: string, hint: string): unknown {
  const path = join(dir, name);
  if (!existsSync(path)) throw new Error(`vaultic config missing: ${path} — run \`${hint}\` first`);
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`vaultic config invalid JSON: ${path} — check for trailing commas or quotes`);
  }
}

export function loadConfig(dir = configDir()): VaulticConfig {
  return ConfigSchema.parse(loadJsonFile(dir, 'config.json', 'vaultic login'));
}

export function loadCredentials(dir = configDir()): VaulticCredentials {
  return CredentialsSchema.parse(loadJsonFile(dir, 'credentials.json', 'vaultic login'));
}

export function resolveProjectId(config: VaulticConfig, workspace: string, project: string): string {
  const projectId = config.workspaces[workspace]?.projects[project]?.projectId;
  if (!projectId) {
    throw new Error(
      `No Infisical project mapped for ${workspace}/${project} — run \`vaultic link ${workspace}/${project} <projectId>\``,
    );
  }
  return projectId;
}

export function fingerprintPath(dir = configDir()): string {
  return join(dir, 'fingerprints.json');
}
