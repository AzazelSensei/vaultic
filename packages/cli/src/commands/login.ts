import { writeFileSync, mkdirSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Command } from 'commander';
import { configDir } from '../config-paths.js';

export interface Credentials {
  clientId: string;
  clientSecret: string;
  telegramBotToken?: string;
}

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const CONFIG_FILE = 'config.json';
const CREDENTIALS_FILE = 'credentials.json';

export function writeCredentials(dir: string, creds: Credentials): void {
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  const path = join(dir, CREDENTIALS_FILE);
  writeFileSync(path, JSON.stringify(creds, null, 2), { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
}

export function writeSiteUrl(dir: string, siteUrl: string): void {
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  const path = join(dir, CONFIG_FILE);
  const config = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { workspaces: {} };
  config.siteUrl = siteUrl;
  if (!config.workspaces) config.workspaces = {};
  writeFileSync(path, JSON.stringify(config, null, 2), { mode: FILE_MODE });
  chmodSync(path, FILE_MODE);
}

function promptHidden(label: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const muted = rl as unknown as { output: NodeJS.WriteStream; _writeToOutput?: (s: string) => void };
    let first = true;
    muted._writeToOutput = (s: string) => {
      if (first) {
        muted.output.write(label);
        first = false;
        return;
      }
      if (s.includes('\n') || s.includes('\r')) muted.output.write('\n');
    };
    rl.on('SIGINT', () => {
      rl.close();
      reject(new Error('aborted'));
    });
    rl.question(label, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

interface LoginOptions {
  siteUrl: string;
  clientId: string;
  telegram?: boolean;
}

export function registerLogin(program: Command): void {
  program
    .command('login')
    .description('Store Infisical credentials and site URL (secrets via hidden prompt)')
    .requiredOption('--site-url <url>', 'Infisical site URL')
    .requiredOption('--client-id <id>', 'Infisical machine identity client ID')
    .option('--telegram', 'Also prompt for a Telegram bot token')
    .action(async (opts: LoginOptions) => {
      const dir = configDir();
      const clientSecret = await promptHidden('Client secret: ');
      const telegramBotToken = opts.telegram ? await promptHidden('Telegram bot token: ') : undefined;
      writeCredentials(dir, { clientId: opts.clientId, clientSecret, telegramBotToken });
      writeSiteUrl(dir, opts.siteUrl);
      process.stdout.write(`Credentials written to ${dir}\n`);
    });
}
