import { readdir, rm, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import checkbox from '@inquirer/checkbox';
import confirm from '@inquirer/confirm';
import { argument, constant, type InferValue, message, object, option, string } from '@optique/core';
import { optional } from '@optique/core/modifiers';

import { getRepoCachePath, getReposDir, getSessionsDir } from '../lib/paths.ts';

export const schema = object({
	command: constant('clean'),
	all: option('--all', { description: message`remove all cached repositories` }),
	yes: option('-y', '--yes', { description: message`skip confirmation prompts` }),
	remote: optional(
		argument(string({ metavar: 'URL' }), {
			description: message`specific remote URL to clean`,
		}),
	),
});

export type Args = InferValue<typeof schema>;

type Choice = {
	name: string;
	value: string;
	short: string;
};

/**
 * checks if a path exists.
 * @param path the path to check
 * @returns true if the path exists
 */
const exists = async (path: string): Promise<boolean> => {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
};

/**
 * formats a byte size in human-readable form.
 * @param bytes size in bytes
 * @returns formatted string
 */
const formatSize = (bytes: number): string => {
	if (bytes < 1024) {
		return `${bytes} B`;
	}
	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	if (bytes < 1024 * 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
};

/**
 * calculates the total size of a directory recursively.
 * @param dir directory path
 * @returns total size in bytes
 */
const getDirSize = async (dir: string): Promise<number> => {
	let size = 0;
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				size += await getDirSize(fullPath);
			} else {
				const s = await stat(fullPath);
				size += s.size;
			}
		}
	} catch {
		// ignore errors (e.g., permission denied)
	}
	return size;
};

/**
 * recursively finds git repositories within a directory.
 * yields directories that contain a .git subdirectory.
 * @param dir directory to search
 */
async function* findRepos(dir: string): AsyncGenerator<string> {
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		const hasGit = entries.some((e) => e.name === '.git' && e.isDirectory());

		if (hasGit) {
			yield dir;
		} else {
			for (const entry of entries) {
				if (entry.isDirectory()) {
					yield* findRepos(join(dir, entry.name));
				}
			}
		}
	} catch {
		// ignore errors (e.g., permission denied)
	}
}

/**
 * lists all cached repositories with their sizes.
 * @returns array of { path, displayPath, size } objects
 */
const listCachedRepos = async (): Promise<{ path: string; displayPath: string; size: number }[]> => {
	const reposDir = getReposDir();

	if (!(await exists(reposDir))) {
		return [];
	}

	const repos: { path: string; displayPath: string; size: number }[] = [];
	for await (const repoPath of findRepos(reposDir)) {
		const displayPath = relative(reposDir, repoPath);
		const size = await getDirSize(repoPath);
		repos.push({ path: repoPath, displayPath, size });
	}
	return repos;
};

/**
 * handles the clean command.
 * @param args parsed command arguments
 */
export const handler = async (args: Args): Promise<void> => {
	const reposDir = getReposDir();
	const sessionsDir = getSessionsDir();

	// #region clean all
	if (args.all) {
		const reposExist = await exists(reposDir);
		const sessionsExist = await exists(sessionsDir);

		if (!reposExist && !sessionsExist) {
			console.log('no cached data found');
			return;
		}

		let totalSize = 0;
		if (reposExist) {
			totalSize += await getDirSize(reposDir);
		}
		if (sessionsExist) {
			totalSize += await getDirSize(sessionsDir);
		}

		if (!args.yes) {
			const confirmed = await confirm({
				message: `remove all cached data? (${formatSize(totalSize)})`,
				default: false,
			});
			if (!confirmed) {
				return;
			}
		}

		if (reposExist) {
			await rm(reposDir, { recursive: true });
		}
		if (sessionsExist) {
			await rm(sessionsDir, { recursive: true });
		}
		console.log('done');
		return;
	}
	// #endregion

	// #region clean specific remote
	if (args.remote) {
		const cachePath = getRepoCachePath(args.remote);
		if (!cachePath) {
			console.error(`error: invalid remote URL: ${args.remote}`);
			process.exit(1);
		}
		if (!(await exists(cachePath))) {
			console.error(`error: repository not cached: ${args.remote}`);
			process.exit(1);
		}

		const size = await getDirSize(cachePath);

		if (!args.yes) {
			const confirmed = await confirm({
				message: `remove ${args.remote}? (${formatSize(size)})`,
				default: false,
			});
			if (!confirmed) {
				return;
			}
		}

		await rm(cachePath, { recursive: true });
		console.log('done');
		return;
	}
	// #endregion

	// #region interactive selection
	const repos = await listCachedRepos();

	if (repos.length === 0) {
		console.log('no cached repositories found');
		return;
	}

	// build choices for checkbox
	const maxNameLen = Math.max(...repos.map((r) => r.displayPath.length));
	const maxSizeLen = Math.max(...repos.map((r) => formatSize(r.size).length));

	// checkbox prefix is ~4 chars, leave some margin
	const termWidth = process.stdout.columns ?? 80;
	const usePadding = maxNameLen + 2 + maxSizeLen + 6 <= termWidth;

	const formatChoice = (name: string, size: number): string =>
		usePadding ? `${name.padEnd(maxNameLen)}  ${formatSize(size)}` : `${name} (${formatSize(size)})`;

	const choices: Choice[] = repos.map((repo) => ({
		name: formatChoice(repo.displayPath, repo.size),
		value: repo.path,
		short: repo.displayPath,
	}));

	const selected = await checkbox({
		message: 'select items to remove',
		choices,
		pageSize: 20,
	});

	if (selected.length === 0) {
		return;
	}

	// calculate total size of selected items
	let totalSize = 0;
	for (const path of selected) {
		totalSize += await getDirSize(path);
	}

	if (!args.yes) {
		const confirmed = await confirm({
			message: `remove ${selected.length} item(s)? (${formatSize(totalSize)})`,
			default: false,
		});
		if (!confirmed) {
			return;
		}
	}

	for (const path of selected) {
		await rm(path, { recursive: true });
	}
	console.log('done');
	// #endregion
};
