/**
 * Filesystem containment for the two paths a run writes to.
 *
 * A run writes `.hoh/` beside the artifact and hands the project directory to
 * three delegating children, so both the project directory and an explicit state
 * directory must be checked before the loop uses them.
 *
 * This is a guard against accidents — a panel request naming `/`, a typo in a
 * profile's `stateDir` — not a sandbox. The host's file policy remains the
 * authority on what a role may actually read or write.
 * @module dsh-plugin-harness-of-harness/paths
 */

import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, resolve } from 'node:path';

/**
 * System prefixes a run must never treat as a project or state directory.
 *
 * Checked as *prefixes of the real path*, not as exact strings: an exact-match
 * denylist lets `/etc/ssl`, `/Users/<you>/.ssh`, and `/var/db` straight through,
 * which are exactly the directories that matter.
 */
const REFUSED_PREFIXES = [
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/lib',
  '/lib64',
  '/proc',
  '/root',
  '/sbin',
  '/sys',
  '/usr',
  '/var/db',
  '/var/log',
  '/System',
  '/Library',
  '/Applications',
  '/private/etc',
  '/private/tmp',
  '/private/var/db',
];

/**
 * Bare temporary roots refused as *whole* directories only.
 *
 * A scratch tree directly under one of these is a legitimate throwaway project,
 * which the test suite itself relies on, so these are matched by equality rather
 * than by prefix.
 */
const REFUSED_EXACT = ['/tmp', '/private/tmp', '/private/var/tmp', '/var/tmp'];

/**
 * The real path of the current user's home, or `null` when it cannot resolve.
 * @returns the home real path, or `null`.
 */
function homeRealPath() {
  try {
    return realpathSync(homedir());
  } catch {
    return null;
  }
}

/**
 * Whether a real path is a system tree or a credential directory.
 *
 * Also refuses the home directory itself and any dotfile directory directly
 * inside it (`~/.ssh`, `~/.aws`, `~/.gnupg`): those are credential stores, never
 * a place to put a project. An ordinary project *under* home — `~/code/thing` —
 * is fine, which is the common case and must not be broken by this guard.
 * @param real - the resolved real path.
 * @returns whether the path is refused.
 */
export function isRefusedPath(real) {
  if (real === '/') return true;
  if (REFUSED_EXACT.includes(real)) return true;
  for (const prefix of REFUSED_PREFIXES) {
    if (real === prefix || real.startsWith(`${prefix}/`)) return true;
  }
  const home = homeRealPath();
  if (home !== null) {
    if (real === home) return true;
    if (real.startsWith(`${home}/.`)) return true;
  }
  return false;
}

/**
 * Validate a directory a run will write into.
 *
 * `resolve()` alone is **not** containment: it is purely lexical, so a symlink
 * at `/tmp/proj` pointing at `/etc` resolves to the innocent-looking
 * `/tmp/proj`. On macOS `/tmp` is itself a symlink to `/private/tmp`, so this is
 * the ordinary case rather than an exotic one. The check therefore runs on
 * `realpathSync()`, and the caller must use the returned real path — a value
 * that was checked but not used would not be contained at all.
 * @param value - the requested directory.
 * @param options - `mustExist` (default true) and `label` for the error text.
 * @returns the real absolute directory.
 * @throws when the value is empty, relative, missing, or refused.
 */
export function resolveWriteDir(value, { mustExist = true, label = 'The directory' } = {}) {
  if (value === '') throw new Error(`${label} must not be empty.`);
  if (!isAbsolute(value)) {
    throw new Error(`${label} must be an absolute path (received "${value}").`);
  }
  // `resolve` collapses `.`/`..` and redundant separators before the filesystem
  // is asked anything, so `/etc/..` cannot dodge the realpath below.
  const lexical = resolve(value);
  let real;
  try {
    real = realpathSync(lexical);
  } catch {
    if (mustExist) throw new Error(`${label} does not exist: ${lexical}. Create it first.`);
    // A path that does not exist yet has no symlink to follow; its lexical form
    // is what will be created, so that is what gets checked.
    real = lexical;
  }
  if (isRefusedPath(real)) {
    throw new Error(`${label} resolves to ${real}, which is a system or credential tree; choose an ordinary directory.`);
  }
  return real;
}
