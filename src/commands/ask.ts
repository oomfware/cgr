import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { argument, choice, constant, type InferValue, message, object, option, string } from '@optique/core';
import { optional, withDefault } from '@optique/core/modifiers';

import { ensureRepo } from '../lib/git.ts';
import { getRepoCachePath, normalizeRemote, parseRemote } from '../lib/paths.ts';

// resolve asset paths relative to the bundle (dist/index.mjs -> dist/assets/)
const assetsDir = join(import.meta.dirname, 'assets');
const settingsPath = join(assetsDir, 'settings.json');
const systemPromptPath = join(assetsDir, 'system-prompt.md');

export const schema = object({
	command: constant('ask'),
	model: withDefault(
		option('-m', '--model', choice(['opus', 'sonnet', 'haiku']), {
			description: message`model to use for analysis`,
		}),
		'haiku',
	),
	branch: optional(
		option('-b', '--branch', string(), {
			description: message`branch to checkout`,
		}),
	),
	remote: argument(string({ metavar: 'REPO' }), {
		description: message`git remote URL (HTTP/HTTPS/SSH)`,
	}),
	question: argument(string({ metavar: 'QUESTION' }), {
		description: message`question to ask about the repository`,
	}),
});

export type Args = InferValue<typeof schema>;

/**
 * handles the ask command.
 * clones/updates the repository and spawns Claude Code to answer the question.
 * @param args parsed command arguments
 */
export const handler = async (args: Args): Promise<void> => {
	// validate remote URL
	const parsed = parseRemote(args.remote);
	if (!parsed) {
		console.error(`error: invalid remote URL: ${args.remote}`);
		console.error('expected format: host/owner/repo, e.g.:');
		console.error('  github.com/user/repo');
		console.error('  https://github.com/user/repo');
		console.error('  git@github.com:user/repo.git');
		process.exit(1);
	}

	// get cache path
	const cachePath = getRepoCachePath(args.remote);
	if (!cachePath) {
		console.error(`error: could not determine cache path for: ${args.remote}`);
		process.exit(1);
	}

	// clone or update repository
	const remoteUrl = normalizeRemote(args.remote);
	console.error(`preparing repository: ${parsed.host}/${parsed.owner}/${parsed.repo}`);
	try {
		await ensureRepo(remoteUrl, cachePath, args.branch);
	} catch (err) {
		console.error(`error: failed to prepare repository: ${err}`);
		process.exit(1);
	}

	// build context for append prompt
	const repoDisplay = `${parsed.host}/${parsed.owner}/${parsed.repo}`;
	const branchDisplay = args.branch ?? 'default branch';
	const contextPrompt = `You are examining ${repoDisplay} (checked out on ${branchDisplay}).`;

	// spawn Claude Code
	const claudeArgs = [
		'-p',
		args.question,
		'--model',
		args.model,
		'--settings',
		settingsPath,
		'--system-prompt-file',
		systemPromptPath,
		'--append-system-prompt',
		contextPrompt,
	];

	console.error('spawning claude...');
	const claude = spawn('claude', claudeArgs, {
		cwd: cachePath,
		stdio: 'inherit',
	});

	claude.on('close', (code) => {
		process.exit(code ?? 0);
	});

	claude.on('error', (err) => {
		console.error(`error: failed to spawn claude: ${err}`);
		process.exit(1);
	});
};
