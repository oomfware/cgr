import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { debug, debugEnabled } from './debug.ts';

/**
 * executes a git command silently, only showing output on failure.
 * when debug is enabled, inherits stdio to show git progress.
 * @param args git command arguments
 * @param cwd working directory
 * @returns promise that resolves when the command completes
 */
const git = (args: string[], cwd?: string): Promise<void> =>
	new Promise((resolve, reject) => {
		debug(`git ${args.join(' ')}${cwd ? ` (in ${cwd})` : ''}`);
		const proc = spawn('git', args, {
			cwd,
			stdio: debugEnabled ? 'inherit' : ['inherit', 'pipe', 'pipe'],
		});
		let stderr = '';
		if (!debugEnabled) {
			proc.stderr!.on('data', (data: Buffer) => {
				stderr += data.toString();
			});
		}
		proc.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				if (stderr) {
					process.stderr.write(stderr);
				}
				reject(new Error(`git ${args[0]} failed with code ${code}`));
			}
		});
		proc.on('error', reject);
	});

/**
 * executes a git command and captures stdout, only showing stderr on failure.
 * when debug is enabled, inherits stderr to show git progress.
 * @param args git command arguments
 * @param cwd working directory
 * @returns promise that resolves with stdout
 */
const gitOutput = (args: string[], cwd?: string): Promise<string> =>
	new Promise((resolve, reject) => {
		debug(`git ${args.join(' ')}${cwd ? ` (in ${cwd})` : ''}`);
		const proc = spawn('git', args, {
			cwd,
			stdio: ['inherit', 'pipe', debugEnabled ? 'inherit' : 'pipe'],
		});
		let output = '';
		let stderr = '';
		proc.stdout!.on('data', (data: Buffer) => {
			output += data.toString();
		});
		if (!debugEnabled) {
			proc.stderr!.on('data', (data: Buffer) => {
				stderr += data.toString();
			});
		}
		proc.on('close', (code) => {
			if (code === 0) {
				resolve(output.trim());
			} else {
				if (stderr) {
					process.stderr.write(stderr);
				}
				reject(new Error(`git ${args[0]} failed with code ${code}`));
			}
		});
		proc.on('error', reject);
	});

/**
 * clones a repository to the cache path.
 * @param remote the remote URL
 * @param cachePath the local cache path
 * @param branch optional branch to checkout
 */
export const cloneRepo = async (remote: string, cachePath: string, branch?: string): Promise<void> => {
	await mkdir(dirname(cachePath), { recursive: true });
	const args = ['clone'];
	if (branch) {
		args.push('--branch', branch);
	}
	args.push(remote, cachePath);
	await git(args);
};

/**
 * updates an existing repository in the cache.
 * discards any local modifications, staged changes, and untracked files.
 * @param cachePath the local cache path
 * @param branch optional branch to checkout (uses default branch if not specified)
 */
export const updateRepo = async (cachePath: string, branch?: string): Promise<void> => {
	await git(['fetch', 'origin'], cachePath);

	// determine the branch to use
	let targetBranch = branch;
	if (!targetBranch) {
		// get the default branch from origin
		const defaultRef = await gitOutput(['symbolic-ref', 'refs/remotes/origin/HEAD'], cachePath);
		targetBranch = defaultRef.replace('refs/remotes/origin/', '');
	}

	// discard all local changes before checkout to avoid conflicts
	await git(['reset', '--hard', 'HEAD'], cachePath);
	await git(['clean', '-fd'], cachePath);
	await git(['checkout', '-f', targetBranch], cachePath);
	await git(['reset', '--hard', `origin/${targetBranch}`], cachePath);
};

/**
 * ensures a repository is cloned and up-to-date.
 * @param remote the remote URL
 * @param cachePath the local cache path
 * @param branch optional branch to checkout
 */
export const ensureRepo = async (remote: string, cachePath: string, branch?: string): Promise<void> => {
	if (existsSync(cachePath)) {
		await updateRepo(cachePath, branch);
	} else {
		await cloneRepo(remote, cachePath, branch);
	}
};
