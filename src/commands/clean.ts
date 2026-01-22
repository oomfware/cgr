import { existsSync, readdirSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import { argument, constant, type InferValue, message, object, option, string } from '@optique/core';
import { optional } from '@optique/core/modifiers';

import { getRepoCachePath, getReposDir } from '../lib/paths.ts';

export const schema = object({
	command: constant('clean'),
	all: option('--all', { description: message`remove all cached repositories` }),
	remote: optional(
		argument(string({ metavar: 'URL' }), {
			description: message`specific remote URL to clean`,
		}),
	),
});

export type Args = InferValue<typeof schema>;

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
const getDirSize = (dir: string): number => {
	let size = 0;
	try {
		const entries = readdirSync(dir, { withFileTypes: true });
		for (const entry of entries) {
			const fullPath = join(dir, entry.name);
			if (entry.isDirectory()) {
				size += getDirSize(fullPath);
			} else {
				size += statSync(fullPath).size;
			}
		}
	} catch {
		// ignore errors (e.g., permission denied)
	}
	return size;
};

/**
 * lists all cached repositories with their sizes.
 * @returns array of { path, displayPath, size } objects
 */
const listCachedRepos = (): {
	path: string;
	displayPath: string;
	size: number;
}[] => {
	const reposDir = getReposDir();
	const repos: { path: string; displayPath: string; size: number }[] = [];

	if (!existsSync(reposDir)) {
		return repos;
	}

	// iterate hosts
	for (const host of readdirSync(reposDir)) {
		const hostPath = join(reposDir, host);
		if (!statSync(hostPath).isDirectory()) {
			continue;
		}

		// iterate owners
		for (const owner of readdirSync(hostPath)) {
			const ownerPath = join(hostPath, owner);
			if (!statSync(ownerPath).isDirectory()) {
				continue;
			}

			// iterate repos
			for (const repo of readdirSync(ownerPath)) {
				const repoPath = join(ownerPath, repo);
				if (!statSync(repoPath).isDirectory()) {
					continue;
				}

				repos.push({
					path: repoPath,
					displayPath: `${host}/${owner}/${repo}`,
					size: getDirSize(repoPath),
				});
			}
		}
	}

	return repos;
};

/**
 * prompts the user for confirmation.
 * @param msg the prompt message
 * @returns promise that resolves to true if confirmed, or exits on interrupt
 */
const confirm = (msg: string): Promise<boolean> =>
	new Promise((resolve) => {
		let answered = false;
		const rl = createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		rl.on('close', () => {
			if (!answered) {
				// handle Ctrl+C or stream close
				console.log();
				process.exit(130);
			}
		});
		rl.question(`${msg} [y/N] `, (answer) => {
			answered = true;
			rl.close();
			resolve(answer.toLowerCase() === 'y');
		});
	});

/**
 * handles the clean command.
 * @param args parsed command arguments
 */
export const handler = async (args: Args): Promise<void> => {
	const reposDir = getReposDir();

	// clean all
	if (args.all) {
		if (!existsSync(reposDir)) {
			console.log('no cached repositories found');
			return;
		}
		const size = getDirSize(reposDir);
		console.log(`removing all cached repositories (${formatSize(size)})`);
		await rm(reposDir, { recursive: true });
		console.log('done');
		return;
	}

	// clean specific remote
	if (args.remote) {
		const cachePath = getRepoCachePath(args.remote);
		if (!cachePath) {
			console.error(`error: invalid remote URL: ${args.remote}`);
			process.exit(1);
		}
		if (!existsSync(cachePath)) {
			console.error(`error: repository not cached: ${args.remote}`);
			process.exit(1);
		}
		const size = getDirSize(cachePath);
		console.log(`removing ${cachePath} (${formatSize(size)})`);
		await rm(cachePath, { recursive: true });
		console.log('done');
		return;
	}

	// list repos and prompt for confirmation
	const repos = listCachedRepos();
	if (repos.length === 0) {
		console.log('no cached repositories found');
		return;
	}

	console.log('cached repositories:\n');
	let totalSize = 0;
	for (const repo of repos) {
		console.log(`  ${repo.displayPath.padEnd(50)} ${formatSize(repo.size)}`);
		totalSize += repo.size;
	}
	console.log(`\n  total: ${formatSize(totalSize)}`);
	console.log();

	const confirmed = await confirm('remove all cached repositories?');
	if (confirmed) {
		await rm(reposDir, { recursive: true });
		console.log('done');
	}
};
