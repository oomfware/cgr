import { randomUUID } from 'node:crypto';
import type { Dirent } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import * as v from 'valibot';

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

// windows reserved names that cannot be used as filenames
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

// characters that are invalid in windows filenames
const UNSAFE_CHARS = /[<>:"|?*\\]/g;

/**
 * sanitizes a path segment to be safe on all filesystems.
 * encodes unsafe characters using percent-encoding and handles windows reserved names.
 * @param segment the path segment to sanitize
 * @returns sanitized segment
 */
const sanitizeSegment = (segment: string): string => {
	let safe = segment
		// encode percent first to avoid double-encoding
		.replace(/%/g, '%25')
		// encode windows-unsafe characters
		.replace(UNSAFE_CHARS, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
		// trim trailing dots and spaces (windows doesn't allow them)
		.replace(/[. ]+$/, (m) =>
			m
				.split('')
				.map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
				.join(''),
		);

	// handle windows reserved names by appending an underscore
	if (WINDOWS_RESERVED.test(safe)) {
		safe = `${safe}_`;
	}

	return safe;
};

/**
 * parses a git remote URL and extracts host and path.
 * supports HTTP(S), SSH, and bare URLs (assumes HTTPS).
 * @param remote the remote URL to parse
 * @returns parsed components or null if invalid
 */
export const parseRemote = (remote: string): { host: string; path: string } | null => {
	// HTTP(S): https://github.com/user/repo[/more/paths] or ending with .git
	const httpMatch = remote.match(/^https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
	if (httpMatch) {
		return {
			host: httpMatch[1]!,
			path: httpMatch[2]!,
		};
	}

	// SSH: git@github.com:path/to/repo.git or git@github.com:path/to/repo
	const sshMatch = remote.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
	if (sshMatch) {
		return {
			host: sshMatch[1]!,
			path: sshMatch[2]!,
		};
	}

	// bare URL: github.com/user/repo (assumes HTTPS)
	const bareMatch = remote.match(/^([^/]+)\/(.+?)(?:\.git)?$/);
	if (bareMatch) {
		return {
			host: bareMatch[1]!,
			path: bareMatch[2]!,
		};
	}

	return null;
};

/**
 * sanitizes a parsed remote path for safe filesystem storage.
 * @param parsed the parsed remote (host + path)
 * @returns sanitized path segments joined with the system separator
 */
export const sanitizeRemotePath = (parsed: { host: string; path: string }): string => {
	const host = sanitizeSegment(parsed.host.toLowerCase());
	const pathSegments = parsed.path.toLowerCase().split('/').map(sanitizeSegment);
	return join(host, ...pathSegments);
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
	return join(getReposDir(), sanitizeRemotePath(parsed));
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

const PID_FILE = '.pid';

// linux PID limits: 1 to 2^22 (4194304) by default, configurable up to 2^22
const PidSchema = v.pipe(v.string(), v.trim(), v.toNumber(), v.integer(), v.minValue(1));

/**
 * creates a new session directory with a random UUID and writes a PID lockfile.
 * @returns the path to the created session directory
 */
export const createSessionDir = async (): Promise<string> => {
	const sessionPath = join(getSessionsDir(), randomUUID());
	await mkdir(sessionPath, { recursive: true });
	await writeFile(join(sessionPath, PID_FILE), process.pid.toString());
	return sessionPath;
};

/**
 * removes a session directory.
 * @param sessionPath the session directory path
 */
export const cleanupSessionDir = async (sessionPath: string): Promise<void> => {
	await rm(sessionPath, { recursive: true, force: true });
};

/**
 * checks if a process with the given PID is running.
 * @param pid the process ID to check
 * @returns true if the process is running
 */
const isProcessRunning = (pid: number): boolean => {
	try {
		// signal 0 doesn't send a signal but checks if process exists
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

/**
 * garbage collects orphaned session directories.
 * a session is orphaned if its PID file is missing or the process is no longer running.
 * this function is meant to be called fire-and-forget (errors are silently ignored).
 */
export const gcSessions = async (): Promise<void> => {
	const sessionsDir = getSessionsDir();

	let entries: Dirent[];
	try {
		entries = await readdir(sessionsDir, { withFileTypes: true });
	} catch {
		// sessions dir doesn't exist or can't be read
		return;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) {
			continue;
		}
		const sessionPath = join(sessionsDir, entry.name);
		const pidPath = join(sessionPath, PID_FILE);

		try {
			const pidContent = await readFile(pidPath, 'utf-8');
			const result = v.safeParse(PidSchema, pidContent);

			if (!result.success || !isProcessRunning(result.output)) {
				await rm(sessionPath, { recursive: true, force: true });
			}
		} catch {
			// no PID file or can't read it - orphaned session
			await rm(sessionPath, { recursive: true, force: true }).catch(() => {});
		}
	}
};
