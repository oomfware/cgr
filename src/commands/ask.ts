import { spawn } from 'node:child_process';
import { join } from 'node:path';

import { argument, choice, constant, type InferValue, message, object, option, string } from '@optique/core';
import { multiple, optional, withDefault } from '@optique/core/modifiers';

import { ensureRepo } from '../lib/git.ts';
import {
	cleanupSessionDir,
	createSessionDir,
	getRepoCachePath,
	normalizeRemote,
	parseRemote,
	parseRemoteWithBranch,
} from '../lib/paths.ts';
import { buildSymlinkDir, type RepoEntry } from '../lib/symlink.ts';

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
	// TODO: deprecated in favor of #branch syntax, remove in future version
	branch: optional(
		option('-b', '--branch', string(), {
			description: message`branch to checkout (deprecated: use repo#branch instead)`,
		}),
	),
	with: withDefault(
		multiple(
			option('-w', '--with', string(), {
				description: message`additional repository to include`,
			}),
		),
		[],
	),
	remote: argument(string({ metavar: 'REPO' }), {
		description: message`git remote URL (HTTP/HTTPS/SSH), optionally with #branch`,
	}),
	question: argument(string({ metavar: 'QUESTION' }), {
		description: message`question to ask about the repository`,
	}),
});

export type Args = InferValue<typeof schema>;

/**
 * prints an error message for invalid remote URL and exits.
 * @param remote the invalid remote URL
 */
const exitInvalidRemote = (remote: string): never => {
	console.error(`error: invalid remote URL: ${remote}`);
	console.error('expected format: host/path, e.g.:');
	console.error('  github.com/user/repo');
	console.error('  gitlab.com/group/subgroup/repo');
	console.error('  https://github.com/user/repo');
	console.error('  git@github.com:user/repo.git');
	process.exit(1);
};

/**
 * validates and parses a remote string (with optional #branch).
 * @param input the remote string, possibly with #branch suffix
 * @returns parsed repo entry or exits on error
 */
const parseRepoInput = (input: string): RepoEntry => {
	const { remote, branch } = parseRemoteWithBranch(input);
	const parsed = parseRemote(remote);
	if (!parsed) {
		return exitInvalidRemote(remote);
	}
	const cachePath = getRepoCachePath(remote);
	if (!cachePath) {
		console.error(`error: could not determine cache path for: ${remote}`);
		process.exit(1);
	}
	return { remote, parsed, cachePath, branch };
};

/**
 * builds a context prompt for a single repository.
 * @param repo the repo entry
 * @returns context prompt string
 */
const buildSingleRepoContext = (repo: RepoEntry): string => {
	const repoDisplay = `${repo.parsed.host}/${repo.parsed.path}`;
	const branchDisplay = repo.branch ?? 'default branch';
	return `You are examining ${repoDisplay} (checked out on ${branchDisplay}).`;
};

/**
 * builds a context prompt for multiple repositories.
 * @param dirMap map of directory name -> repo entry
 * @returns context prompt string
 */
const buildMultiRepoContext = (dirMap: Map<string, RepoEntry>): string => {
	const lines = ['You are examining multiple repositories:', ''];
	for (const [dirName, repo] of dirMap) {
		const repoDisplay = `${repo.parsed.host}/${repo.parsed.path}`;
		const branchDisplay = repo.branch ?? 'default branch';
		lines.push(`- ${dirName}/ -> ${repoDisplay} (checked out on ${branchDisplay})`);
	}
	return lines.join('\n');
};

/**
 * spawns Claude Code and waits for it to exit.
 * @param cwd working directory
 * @param contextPrompt context prompt for Claude
 * @param args command arguments
 * @returns promise that resolves with exit code
 */
const spawnClaude = (cwd: string, contextPrompt: string, args: Args): Promise<number> =>
	new Promise((resolve, reject) => {
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
			cwd,
			stdio: 'inherit',
		});

		claude.on('close', (code) => {
			resolve(code ?? 0);
		});

		claude.on('error', (err) => {
			reject(new Error(`failed to spawn claude: ${err}`));
		});
	});

/**
 * handles the ask command.
 * clones/updates the repository and spawns Claude Code to answer the question.
 * @param args parsed command arguments
 */
export const handler = async (args: Args): Promise<void> => {
	// parse main remote (with optional #branch)
	const mainRepo = parseRepoInput(args.remote);

	// #branch takes precedence over -b flag
	if (!mainRepo.branch && args.branch) {
		mainRepo.branch = args.branch;
	}

	// #region single repo mode
	if (args.with.length === 0) {
		// clone or update repository
		const remoteUrl = normalizeRemote(mainRepo.remote);
		console.error(`preparing repository: ${mainRepo.parsed.host}/${mainRepo.parsed.path}`);
		try {
			await ensureRepo(remoteUrl, mainRepo.cachePath, mainRepo.branch);
		} catch (err) {
			console.error(`error: failed to prepare repository: ${err}`);
			process.exit(1);
		}

		const contextPrompt = buildSingleRepoContext(mainRepo);
		const exitCode = await spawnClaude(mainRepo.cachePath, contextPrompt, args);
		process.exit(exitCode);
	}
	// #endregion

	// #region multi repo mode
	// parse all -w remotes
	const additionalRepos = args.with.map(parseRepoInput);
	const allRepos = [mainRepo, ...additionalRepos];

	// clone/update all repos in parallel
	console.error('preparing repositories...');
	const prepareResults = await Promise.allSettled(
		allRepos.map(async (repo) => {
			const remoteUrl = normalizeRemote(repo.remote);
			const display = `${repo.parsed.host}/${repo.parsed.path}`;
			console.error(`  preparing: ${display}`);
			await ensureRepo(remoteUrl, repo.cachePath, repo.branch);
			return repo;
		}),
	);

	// check for failures
	const failures: string[] = [];
	for (let i = 0; i < prepareResults.length; i++) {
		const result = prepareResults[i]!;
		if (result.status === 'rejected') {
			const repo = allRepos[i]!;
			const display = `${repo.parsed.host}/${repo.parsed.path}`;
			failures.push(`  ${display}: ${result.reason}`);
		}
	}

	if (failures.length > 0) {
		console.error('error: failed to prepare repositories:');
		for (const failure of failures) {
			console.error(failure);
		}
		process.exit(1);
	}

	// create session directory and symlinks
	const sessionPath = await createSessionDir();
	let exitCode = 1;

	try {
		const dirMap = await buildSymlinkDir(sessionPath, allRepos);
		const contextPrompt = buildMultiRepoContext(dirMap);
		exitCode = await spawnClaude(sessionPath, contextPrompt, args);
	} finally {
		// always clean up session directory
		await cleanupSessionDir(sessionPath);
	}

	process.exit(exitCode);
	// #endregion
};
