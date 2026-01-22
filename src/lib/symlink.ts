import { symlink } from 'node:fs/promises';
import { basename, join } from 'node:path';

/** parsed remote information */
export type ParsedRemote = { host: string; path: string };

/** repository entry with all metadata needed for symlinking */
export type RepoEntry = {
	remote: string;
	parsed: ParsedRemote;
	cachePath: string;
	branch?: string;
};

/**
 * builds symlinks in a session directory for all repositories.
 * handles name conflicts by appending `-2`, `-3`, etc.
 * @param sessionPath the session directory path
 * @param repos array of repository entries to symlink
 * @returns map of directory name -> repo entry
 */
export const buildSymlinkDir = async (
	sessionPath: string,
	repos: RepoEntry[],
): Promise<Map<string, RepoEntry>> => {
	const result = new Map<string, RepoEntry>();
	const usedNames = new Set<string>();

	for (const repo of repos) {
		// use the last component of the path as the directory name
		const repoName = basename(repo.parsed.path);
		let name = repoName;
		let suffix = 1;

		// handle name conflicts
		while (usedNames.has(name)) {
			suffix++;
			name = `${repoName}-${suffix}`;
		}

		usedNames.add(name);
		result.set(name, repo);

		const linkPath = join(sessionPath, name);
		await symlink(repo.cachePath, linkPath);
	}

	return result;
};
