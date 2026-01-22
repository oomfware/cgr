import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * returns the cache directory for cgr.
 * uses `$XDG_CACHE_HOME/cgr` if set, otherwise falls back to:
 * - `~/.cache/cgr` on linux
 * - `~/Library/Caches/cgr` on macos
 * @returns the cache directory path
 */
export const getCacheDir = (): string => {
	const xdgCache = process.env['XDG_CACHE_HOME'];
	if (xdgCache) {
		return join(xdgCache, 'cgr');
	}
	const home = homedir();
	if (process.platform === 'darwin') {
		return join(home, 'Library', 'Caches', 'cgr');
	}
	return join(home, '.cache', 'cgr');
};

/**
 * returns the repos directory within the cache.
 * @returns the repos directory path
 */
export const getReposDir = (): string => join(getCacheDir(), 'repos');

/**
 * parses a git remote URL and extracts host, owner, and repo.
 * supports HTTP(S), SSH, and bare URLs (assumes HTTPS).
 * @param remote the remote URL to parse
 * @returns parsed components or null if invalid
 */
export const parseRemote = (remote: string): { host: string; owner: string; repo: string } | null => {
	// HTTP(S): https://github.com/user/repo or https://github.com/user/repo.git
	const httpMatch = remote.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
	if (httpMatch) {
		return {
			host: httpMatch[1]!,
			owner: httpMatch[2]!,
			repo: httpMatch[3]!,
		};
	}

	// SSH: git@github.com:user/repo.git or git@github.com:user/repo
	const sshMatch = remote.match(/^git@([^:]+):([^/]+)\/([^/]+?)(?:\.git)?$/);
	if (sshMatch) {
		return {
			host: sshMatch[1]!,
			owner: sshMatch[2]!,
			repo: sshMatch[3]!,
		};
	}

	// bare URL: github.com/user/repo (assumes HTTPS)
	const bareMatch = remote.match(/^([^/]+)\/([^/]+)\/([^/]+?)(?:\.git)?$/);
	if (bareMatch) {
		return {
			host: bareMatch[1]!,
			owner: bareMatch[2]!,
			repo: bareMatch[3]!,
		};
	}

	return null;
};

/**
 * normalizes a remote URL by prepending https:// if no protocol is present.
 * @param remote the remote URL to normalize
 * @returns normalized URL with protocol
 */
export const normalizeRemote = (remote: string): string => {
	if (remote.startsWith('https://') || remote.startsWith('http://') || remote.startsWith('git@')) {
		return remote;
	}
	return `https://${remote}`;
};

/**
 * returns the cache path for a specific repository.
 * @param remote the remote URL
 * @returns the cache path or null if the remote URL is invalid
 */
export const getRepoCachePath = (remote: string): string | null => {
	const parsed = parseRemote(remote);
	if (!parsed) {
		return null;
	}
	// normalize to lowercase for consistent cache paths across different URL casings
	const host = parsed.host.toLowerCase();
	const owner = parsed.owner.toLowerCase();
	const repo = parsed.repo.toLowerCase();
	return join(getReposDir(), host, owner, repo);
};

/**
 * parses `remote#branch` syntax.
 * @param input the input string, e.g. `github.com/owner/repo#develop`
 * @returns object with remote and optional branch
 */
export const parseRemoteWithBranch = (input: string): { remote: string; branch?: string } => {
	const hashIndex = input.lastIndexOf('#');
	if (hashIndex === -1) {
		return { remote: input };
	}
	return {
		remote: input.slice(0, hashIndex),
		branch: input.slice(hashIndex + 1),
	};
};

/**
 * returns the sessions directory within the cache.
 * @returns the sessions directory path
 */
export const getSessionsDir = (): string => join(getCacheDir(), 'sessions');

/**
 * creates a new session directory with a random UUID.
 * @returns the path to the created session directory
 */
export const createSessionDir = async (): Promise<string> => {
	const sessionPath = join(getSessionsDir(), randomUUID());
	await mkdir(sessionPath, { recursive: true });
	return sessionPath;
};

/**
 * removes a session directory.
 * @param sessionPath the session directory path
 */
export const cleanupSessionDir = async (sessionPath: string): Promise<void> => {
	await rm(sessionPath, { recursive: true, force: true });
};
