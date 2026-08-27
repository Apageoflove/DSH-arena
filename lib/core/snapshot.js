/** Safe Git worktree argument construction for isolated Arena runs. */

import { isAbsolute, relative, resolve, sep } from 'node:path';

/** Requires an absolute repository path to prevent accidental process-directory writes. */
export function validateRepoPath(repoPath        )         {
  if (!isAbsolute(repoPath)) throw new Error('repoPath must be absolute.');
  return resolve(repoPath);
}

/** Ensures an isolated run directory is nested inside the dedicated runs root. */
export function validateRunPath(runsRoot        , targetPath        )         {
  const root = resolve(runsRoot);
  const target = resolve(targetPath);
  const relation = relative(root, target);
  if (!relation || relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) throw new Error('run target must be nested inside runsRoot.');
  return target;
}

/** Builds shell-free `git worktree add --detach` arguments; callers must execute them as an argument array. */
export function buildWorktreeArgs(repoPath        , runsRoot        , targetPath        , snapshot        )           {
  validateRepoPath(repoPath);
  const safeTarget = validateRunPath(runsRoot, targetPath);
  if (!snapshot.trim()) throw new Error('snapshot must not be empty.');
  if (snapshot.startsWith('-')) throw new Error('snapshot must not start with a dash.');
  return ['-C', repoPath, 'worktree', 'add', '--detach', safeTarget, snapshot];
}


//# sourceURL=E:\agent\DSH_UI\dsh-arena\src\core\snapshot.ts