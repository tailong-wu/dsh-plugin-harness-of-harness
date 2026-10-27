/**
 * Plugin configuration and its resolution into runtime settings.
 * @module dsh-plugin-harness-of-harness/config
 */

import z from '@deepseek-ai/schemastery';

import { resolveWriteDir } from './paths.js';

import {
  MAX_DIRECTORY_CHARS,
  MAX_PHASE_TIMEOUT_SECONDS,
  MAX_INNER_REPAIRS_LIMIT,
  MAX_ITERATIONS,
  MIN_ITERATIONS,
  TESTER_POLICIES,
} from './contract.js';

/** Configuration accepted from the profile's YAML (all fields optional). */
export const Config = z.object({
  showPanel: z
    .boolean()
    .default(true)
    .description('Expose the Harness of Harness panel: a right-Sidebar tab and a conversation-header button.'),
  stateDir: z
    .string()
    .default('')
    .description('Directory holding run records. Empty keeps them in `<project>/.hoh/runs`, beside the developed code.'),
  defaultIterations: z
    .number()
    .default(3)
    .description(`Iteration budget the panel offers by default (${MIN_ITERATIONS}-${MAX_ITERATIONS}).`),
  phaseTimeoutSeconds: z
    .number()
    .default(3600)
    .description('Wall-clock ceiling for one role turn in seconds; 0 disables the ceiling.'),
  childMaxDepth: z
    .number()
    .default(0)
    .description(
      'Extra delegation levels granted to the Planner, Developer, and Tester children: how much further a role may itself delegate. 0 keeps one iteration at three roles. The absolute maxDepth sent to the subagent service adds the depth the role child occupies (usually 1), so this value is a grant, not a cap.',
    ),
  testerPolicy: z
    .string()
    .default('repair-then-next')
    .description('How a QA Tester verdict is acted on: `next-loop` defers gaps to the next iteration, `repair-then-next` hands them back to the Developer inside the same iteration.'),
  maxInnerRepairs: z
    .number()
    .default(2)
    .description(`Same-iteration Developer repairs allowed under \`repair-then-next\` (0-${MAX_INNER_REPAIRS_LIMIT}).`),
  enforceRolePresets: z
    .boolean()
    .default(true)
    .description('Delegate each role under its own agent preset, so the read-only roles have no file-writing tool. Turn off only when the preset rows are not mounted.'),
});

/**
 * Validate and normalize the loader's configuration.
 *
 * The loader runs {@link Config} first, so this only re-checks the values the
 * panel and the loop depend on and fills in defaults for callers outside the
 * loader.
 * @param config - the validated YAML configuration.
 * @returns resolved runtime settings.
 */
export function resolveConfig(config = {}) {
  const defaultIterations = config.defaultIterations ?? 3;
  if (!Number.isInteger(defaultIterations) || defaultIterations < MIN_ITERATIONS || defaultIterations > MAX_ITERATIONS) {
    throw new Error(
      `defaultIterations must be a whole number from ${MIN_ITERATIONS} to ${MAX_ITERATIONS} (received ${String(defaultIterations)}).`,
    );
  }

  const phaseTimeoutSeconds = config.phaseTimeoutSeconds ?? 3600;
  // Upper bound is not arbitrary: the engine passes `seconds * 1000` to
  // `setTimeout`, which takes a 32-bit signed millisecond value. A larger value
  // overflows and Node silently clamps it to 1 ms, so every role would time out
  // immediately instead of never. 0 still means "no ceiling".
  if (!Number.isInteger(phaseTimeoutSeconds) || phaseTimeoutSeconds < 0 || phaseTimeoutSeconds > MAX_PHASE_TIMEOUT_SECONDS) {
    throw new Error(
      `phaseTimeoutSeconds must be a whole number from 0 to ${MAX_PHASE_TIMEOUT_SECONDS}, or 0 for no ceiling (received ${String(phaseTimeoutSeconds)}).`,
    );
  }

  const childMaxDepth = config.childMaxDepth ?? 0;
  if (!Number.isInteger(childMaxDepth) || childMaxDepth < 0 || childMaxDepth > 5) {
    throw new Error(`childMaxDepth must be a whole number from 0 to 5 (received ${String(childMaxDepth)}).`);
  }

  const stateDir = (config.stateDir ?? '').trim();
  if (stateDir.length > MAX_DIRECTORY_CHARS) {
    throw new Error(`stateDir is longer than ${MAX_DIRECTORY_CHARS} characters.`);
  }
  // `stateDir` is the other place a run writes, and it comes from profile YAML
  // rather than from a request — but pointing it at a system tree would put run
  // records somewhere no project belongs, so the same containment the project
  // directory gets applies here too. A relative value is refused as well: it
  // would resolve against whatever the host's working directory happens to be.
  //
  // The directory may not exist yet (the run creates it), so the check does not
  // require it to; the returned real path is unusable here because resolution
  // happens per run, which is why only the containment decision is made now.
  if (stateDir !== '') {
    resolveWriteDir(stateDir, { mustExist: false, label: 'stateDir' });
  }

  const testerPolicy = config.testerPolicy ?? 'repair-then-next';
  if (!TESTER_POLICIES.includes(testerPolicy)) {
    throw new Error(`testerPolicy must be one of ${TESTER_POLICIES.join(', ')} (received ${String(testerPolicy)}).`);
  }

  const maxInnerRepairs = config.maxInnerRepairs ?? 2;
  if (!Number.isInteger(maxInnerRepairs) || maxInnerRepairs < 0 || maxInnerRepairs > MAX_INNER_REPAIRS_LIMIT) {
    throw new Error(
      `maxInnerRepairs must be a whole number from 0 to ${MAX_INNER_REPAIRS_LIMIT} (received ${String(maxInnerRepairs)}).`,
    );
  }

  return {
    showPanel: config.showPanel ?? true,
    stateDir,
    defaultIterations,
    phaseTimeoutSeconds,
    childMaxDepth,
    testerPolicy,
    maxInnerRepairs,
    enforceRolePresets: config.enforceRolePresets ?? true,
  };
}