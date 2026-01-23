#!/usr/bin/env node

import { command, message, or } from '@optique/core';
import { run } from '@optique/run';

import manifest from '../package.json' with { type: 'json' };

import * as ask from './commands/ask.ts';
import * as clean from './commands/clean.ts';

const parser = or(
	command('ask', ask.schema, {
		description: message`ask a question about a repository`,
	}),
	command('clean', clean.schema, {
		description: message`remove cached repositories`,
	}),
);

const result = run(parser, {
	programName: 'cgr',
	help: 'both',
	version: { value: manifest.version, mode: 'both' },
	brief: message`ask questions about git repositories using Claude Code`,
});

switch (result.command) {
	case 'ask':
		await ask.handler(result);
		break;
	case 'clean':
		await clean.handler(result);
		break;
}
