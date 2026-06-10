import { spawn } from 'node:child_process';
import type { Command } from 'commander';
import { loadConfig, resolveProjectId, type VaulticConfig } from 'vaultic-broker';

const ACCESS_PATH = 'access-management';

function parseWsProj(wsProj: string): { workspace: string; project: string } {
  const slash = wsProj.indexOf('/');
  if (slash < 0) throw new Error(`Expected ws/proj format, got: ${wsProj}`);
  const workspace = wsProj.slice(0, slash);
  const project = wsProj.slice(slash + 1);
  if (!workspace || !project) throw new Error(`Expected ws/proj format, got: ${wsProj}`);
  return { workspace, project };
}

export function buildShareUrl(config: VaulticConfig, wsProj: string): string {
  const { workspace, project } = parseWsProj(wsProj);
  const projectId = resolveProjectId(config, workspace, project);
  return `${config.siteUrl}/project/${projectId}/${ACCESS_PATH}`;
}

function openerCommand(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'open';
  if (platform === 'win32') return 'start';
  return 'xdg-open';
}

export function openInBrowser(url: string): void {
  try {
    const child = spawn(openerCommand(process.platform), [url], { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    process.stderr.write(`vaultic: could not open browser — visit the URL above manually\n`);
  }
}

export function registerShare(program: Command): void {
  program
    .command('share')
    .description('Open the Infisical project access page to manage who can see this vault')
    .argument('<wsProj>', 'workspace/project pair, e.g. acme/web')
    .action((wsProj: string) => {
      const url = buildShareUrl(loadConfig(), wsProj);
      process.stdout.write(`${url}\n`);
      openInBrowser(url);
    });
}
