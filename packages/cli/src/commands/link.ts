import { writeFileSync, mkdirSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { configDir } from '../config-paths.js';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const CONFIG_FILE = 'config.json';

interface ProjectEntry {
  projectId: string;
}
interface WorkspaceEntry {
  projects: Record<string, ProjectEntry>;
}
interface Config {
  siteUrl?: string;
  workspaces: Record<string, WorkspaceEntry>;
}

function parseWsProj(wsProj: string): { workspace: string; project: string } {
  const slash = wsProj.indexOf('/');
  if (slash < 0) throw new Error(`Expected ws/proj format, got: ${wsProj}`);
  const workspace = wsProj.slice(0, slash);
  const project = wsProj.slice(slash + 1);
  if (!workspace || !project) throw new Error(`Expected ws/proj format, got: ${wsProj}`);
  return { workspace, project };
}

export function writeProjectLink(
  dir: string,
  siteUrl: string | undefined,
  wsProj: string,
  projectId: string,
): void {
  const { workspace, project } = parseWsProj(wsProj);
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  const path = join(dir, CONFIG_FILE);
  const config: Config = existsSync(path)
    ? JSON.parse(readFileSync(path, 'utf8'))
    : { workspaces: {} };
  if (!config.workspaces) config.workspaces = {};
  if (siteUrl) config.siteUrl = siteUrl;
  const ws = config.workspaces[workspace] ?? { projects: {} };
  ws.projects[project] = { projectId };
  config.workspaces[workspace] = ws;
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
}

interface LinkOptions {
  siteUrl?: string;
}

export function registerLink(program: Command): void {
  program
    .command('link')
    .description('Map a workspace/project to an Infisical projectId')
    .argument('<wsProj>', 'workspace/project pair, e.g. acme/web')
    .argument('<projectId>', 'Infisical project ID')
    .option('--site-url <url>', 'Override the stored site URL')
    .action((wsProj: string, projectId: string, opts: LinkOptions) => {
      writeProjectLink(configDir(), opts.siteUrl, wsProj, projectId);
      process.stdout.write(`Linked ${wsProj} → ${projectId}\n`);
    });
}
