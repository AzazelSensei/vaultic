#!/usr/bin/env node
import { Command } from 'commander';
import { registerLogin } from './commands/login.js';
import { registerLink } from './commands/link.js';
import { registerInit } from './commands/init.js';
import { registerCheck } from './commands/check.js';
import { registerSet } from './commands/set.js';
import { registerShare } from './commands/share.js';
import { registerRun } from './commands/run.js';

const program = new Command('vaultic')
  .description('AI credentials vault — human-side CLI')
  .version('0.1.0');

registerLogin(program);
registerLink(program);
registerInit(program);
registerCheck(program);
registerSet(program);
registerShare(program);
registerRun(program);

program.parseAsync();
