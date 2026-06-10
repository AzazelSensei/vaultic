#!/usr/bin/env node
import { Command } from 'commander';
import { registerLogin } from './commands/login.js';
import { registerLink } from './commands/link.js';

const program = new Command('vaultic')
  .description('AI credentials vault — human-side CLI')
  .version('0.1.0');

registerLogin(program);
registerLink(program);

program.parseAsync();
