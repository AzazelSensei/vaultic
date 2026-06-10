import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { stringify } from 'yaml';
import { MANIFEST_FILENAME } from '@vaultic/shared';
import type { Command } from 'commander';

const DEFAULT_ENV = 'prod';
const DEFAULT_MODE = 'standard';
const GITIGNORE_FILE = '.gitignore';
const ENV_ENTRY = '.env';

interface InitInput {
  workspace: string;
  project: string;
  env: string;
}

export function writeManifestTemplate(dir: string, input: InitInput): void {
  const path = join(dir, MANIFEST_FILENAME);
  if (existsSync(path)) throw new Error(`${MANIFEST_FILENAME} already exists in ${dir}`);
  const manifest = {
    workspace: input.workspace,
    project: input.project,
    mode: DEFAULT_MODE,
    needs: {},
  };
  writeFileSync(path, stringify(manifest), 'utf8');
}

export function buildInitHint(input: InitInput): string {
  return `Add secrets with refs like vault://${input.workspace}/${input.project}/${input.env}/KEY_NAME (values via hidden prompt).`;
}

export function ensureGitignoreEnv(dir: string): void {
  const path = join(dir, GITIGNORE_FILE);
  if (!existsSync(path)) {
    writeFileSync(path, `${ENV_ENTRY}\n`, 'utf8');
    return;
  }
  const raw = readFileSync(path, 'utf8');
  const lines = raw.split(/\r?\n/);
  if (lines.includes(ENV_ENTRY)) return;
  const prefix = raw.length > 0 && !raw.endsWith('\n') ? '\n' : '';
  writeFileSync(path, `${raw}${prefix}${ENV_ENTRY}\n`, 'utf8');
}

interface InitOptions {
  workspace: string;
  project: string;
  env?: string;
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Create a .aiv.yaml manifest in the current directory')
    .requiredOption('--workspace <ws>', 'workspace name')
    .requiredOption('--project <proj>', 'project name')
    .option('--env <env>', 'default environment hint', DEFAULT_ENV)
    .action((opts: InitOptions) => {
      const dir = process.cwd();
      const input: InitInput = {
        workspace: opts.workspace,
        project: opts.project,
        env: opts.env ?? DEFAULT_ENV,
      };
      writeManifestTemplate(dir, input);
      ensureGitignoreEnv(dir);
      process.stdout.write(`Created ${MANIFEST_FILENAME} and ensured ${ENV_ENTRY} in ${GITIGNORE_FILE}.\n`);
      process.stdout.write(`${buildInitHint(input)}\n`);
      process.stdout.write('Tip: install gitleaks to block secret commits — `brew install gitleaks` then `gitleaks protect`.\n');
    });
}
