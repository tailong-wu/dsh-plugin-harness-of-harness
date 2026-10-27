/**
 * The two audit records a run keeps, and the fingerprints they are built from.
 *
 * Upstream HoH writes `runtime_receipt.json` (a deterministic host's event log)
 * and `reproducibility.json` (observed versions, revisions, role bindings, and a
 * configuration hash) so a run can be audited and compared later. This module
 * owns the same two files for this plugin, in the same shape where the data
 * exists here.
 * @module dsh-plugin-harness-of-harness/records
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The per-run event log, mirroring the upstream receipt file name. */
export const RECEIPT_FILE = 'runtime_receipt.json';

/** The per-run observability record, mirroring the upstream file name. */
export const REPRODUCIBILITY_FILE = 'reproducibility.json';

/** Schema version of both records; bump when a reader-visible field changes. */
export const RECORD_SCHEMA_VERSION = 1;

/**
 * Write one JSON document, creating its directory.
 * @param path - the absolute file path.
 * @param value - the JSON-serializable value.
 */
export function writeJson(path, value) {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

/**
 * Write a run's deterministic-host receipt.
 *
 * The receipt is appended after every role event, exactly as upstream rewrites
 * its receipt on each append, so an interrupted run still leaves an auditable
 * record of the turns that happened.
 * @param runDir - the run's record directory.
 * @param input - the receipt fields.
 */
export function writeReceipt(runDir, input) {
  // The receipt is an external document, so its keys follow the upstream
  // RoleBinding.to_dict() spelling rather than this codebase's camelCase.
  const roles = {};
  for (const [role, binding] of Object.entries(input.roles)) {
    roles[role] = {
      role,
      preset: binding.preset ?? null,
      workspace_access: binding.workspaceAccess,
      // Upstream has no `max_depth` field at all. This plugin records both
      // numbers because they differ and the difference is the point:
      // `max_depth_grant` is the extra delegation the configuration allows,
      // while `max_depth_effective` is the ABSOLUTE cap actually put on the
      // activation, which is what a reader means by "depth limit". Keeping only
      // the grant under a bare `max_depth` read as the cap, and was wrong.
      max_depth_grant: binding.maxDepth,
      max_depth_effective: binding.maxDepthEffective ?? null,
      harness: 'deepseek-harness',
      model: null,
      reasoning_effort: null,
    };
  }

  writeJson(join(runDir, RECEIPT_FILE), {
    schema_version: RECORD_SCHEMA_VERSION,
    runtime: 'dsh-harness-of-harness',
    coordination: 'deterministic-host',
    active_iteration: input.activeIteration ?? null,
    tester_policy: input.testerPolicy,
    max_inner_repairs: input.maxInnerRepairs,
    roles,
    events: input.events,
  });
}

/**
 * Read the HEAD revision of a project, when it is a git repository.
 * @param projectDir - the artifact directory.
 * @returns the revision and dirty flag, or `null` outside a repository.
 */
export function gitRevision(projectDir) {
  const run = (args) =>
    execFileSync('git', args, {
      cwd: projectDir,
      encoding: 'utf8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  try {
    const head = run(['rev-parse', 'HEAD']);
    const status = run(['status', '--porcelain', '--untracked-files=no']);
    return { head: head === '' ? null : head, dirty: status !== '' };
  } catch {
    return null;
  }
}

/**
 * Hash the configuration a run was admitted with.
 *
 * Two runs whose hash and role bindings match ran the same loop over the same
 * settings; the hash is what makes that checkable without diffing prose.
 * @param value - any JSON-serializable configuration.
 * @returns the digest, prefixed with its algorithm.
 */
export function configHash(value) {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

/**
 * Build a run's reproducibility record.
 *
 * Fields this deployment cannot observe (a benchmark revision, a per-role
 * model, a harness CLI version) are recorded as `null` rather than omitted, so
 * "not applicable here" stays distinguishable from "forgotten".
 * @param input - the observed facts.
 * @returns the record to write.
 */
export function buildReproducibility(input) {
  const roles = {};
  for (const [role, binding] of Object.entries(input.roleBindings)) {
    roles[role] = {
      preset: binding.preset,
      workspace_access: binding.workspaceAccess,
      max_depth_grant: binding.maxDepth,
      max_depth_effective: binding.maxDepthEffective ?? null,
      harness: 'deepseek-harness',
      model: null,
      reasoning_effort: null,
      benchmark: null,
    };
  }

  return {
    schema_version: RECORD_SCHEMA_VERSION,
    runtime: 'dsh-harness-of-harness',
    plugin: input.plugin,
    observed: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      provider: input.provider,
    },
    project: {
      dir: input.projectDir,
      git: input.git,
    },
    preset: { id: input.presetId },
    roles,
    config: input.config,
    config_hash: configHash({ config: input.config, roles, preset: input.presetId }),
    tester_policy: input.testerPolicy,
    max_inner_repairs: input.maxInnerRepairs,
    started_at: new Date(input.startedAt ?? Date.now()).toISOString(),
    external_evaluator: null,
  };
}
