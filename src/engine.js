/**
 * The Harness of Harness run engine.
 *
 * One run is a sequence of iterations. Each iteration delegates fresh DSH
 * subagents — Project Planner, Developer, QA Tester — and carries the artifact
 * and the evidence forward between iterations. The engine owns run state, keeps
 * the two audit records, and never blocks the caller: {@link Engine.start}
 * returns as soon as the run is admitted.
 *
 * Three upstream HoH mechanisms live here:
 *
 * - a deterministic role machine (`src/transitions.js`) instead of a bare loop,
 *   so an illegal role order is refused rather than performed;
 * - `repair-then-next`, which hands a failing QA verdict back to the Developer
 *   inside the same iteration, bounded by `maxInnerRepairs`;
 * - the two audit records, `runtime_receipt.json` and `reproducibility.json`.
 *
 * Delegation uses `ctx.subagents.startActivation` with `delivery: 'caller'`, so
 * a role's work stays out of the parent conversation while the loop still
 * awaits its result. Children appear in the parent session's subagent list.
 * @module dsh-plugin-harness-of-harness/engine
 */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BLOCKING_SEVERITIES,
  EVIDENCE_SCHEMA,
  MAX_DIRECTORY_CHARS,
  MAX_GOAL_CHARS,
  MAX_ITERATIONS,
  MAX_LOG_ENTRIES,
  MAX_SUMMARY_CHARS,
  MIN_ITERATIONS,
  ROLE_LABELS,
  ROLE_PRESETS,
  ROLES,
  SEVERITIES,
} from './contract.js';
import { resolveWriteDir } from './paths.js';
import { rolePrompt } from './prompts.js';
import {
  RECEIPT_FILE,
  REPRODUCIBILITY_FILE,
  buildReproducibility,
  gitRevision,
  writeJson,
  writeReceipt,
} from './records.js';
import { createRoleMachine } from './transitions.js';

/** The magic race value that means a role outlived its wall-clock ceiling. */
const TIMEOUT = Symbol('timeout');

/** The magic race value that means the run was stopped mid-role. */
const ABORTED = Symbol('aborted');

/**
 * The ordered roles of one iteration, for filling skipped turns.
 */
const ROLE_ORDER = ['planner', 'developer', 'tester'];

/**
 * The delegation depth an agent itself occupies.
 *
 * Mirrors the host's own rule (`@deepseek-ai/dsh-subagent`'s
 * `delegationDepthOf`): the persisted session header is the monotone floor and
 * the runtime `AgentOptions.subagentDepth` may only deepen it. Read
 * defensively here — this module deliberately keeps no dependency on the
 * subagent package, so it must not assume both fields exist.
 * @param agent - the delegating agent, when one is known.
 * @returns the agent's non-negative depth.
 */
function agentDepth(agent) {
  const fromHeader = agent?.session?.header?.delegationDepth;
  const fromOptions = agent?.options?.subagentDepth;
  const header = Number.isSafeInteger(fromHeader) && fromHeader > 0 ? fromHeader : 0;
  const options = Number.isSafeInteger(fromOptions) && fromOptions > 0 ? fromOptions : 0;
  return Math.max(header, options);
}

/**
 * Translate the configured recursion budget into the absolute `maxDepth` the
 * subagent service enforces for one role activation.
 *
 * `childMaxDepth` counts the levels a role child may still open BELOW itself,
 * so `0` means "a role may not delegate further". The service, however,
 * compares the child's OWN absolute depth against `maxDepth`, and that depth is
 * the parent's depth plus one. Passing the configured 0 straight through was
 * the defect: it made the cap 0 while the planner child is already at depth 1,
 * so every run failed at its first delegation with
 * `subagent depth 1 exceeds maxDepth 0`.
 *
 * A role's parent is the session agent, so in the ordinary case the cap is
 * `1 + childMaxDepth`. Computing it from the parent's real depth keeps the
 * budget meaning the same when the session that started the run is itself a
 * subagent.
 * @param childMaxDepth - extra delegation levels granted to a role child.
 * @param parent - the session agent the role is delegated from.
 * @returns the absolute depth cap to put on a role activation.
 */
function absoluteRoleMaxDepth(childMaxDepth, parent) {
  const extra = Number.isInteger(childMaxDepth) && childMaxDepth > 0 ? childMaxDepth : 0;
  return agentDepth(parent) + 1 + extra;
}

/**
 * The map key for one session's run. A panel that cannot name its session
 * shares the single default slot.
 * @param sessionId - the session id, when the panel could supply one.
 * @returns the run map key.
 */
function keyFor(sessionId) {
  return sessionId === undefined || sessionId === null || sessionId === '' ? '__default__' : String(sessionId);
}

/**
 * Validate and normalize the project directory a run will develop in.
 *
 * The directory is the one place a run writes outside its own state directory,
 * so it must be absolute, must exist, and must not resolve into a system tree.
 * The containment itself lives in `./paths.js`, shared with the `stateDir` check
 * in `./config.js` so the two cannot drift apart.
 * @param value - the requested directory, or the fallback when empty.
 * @returns the real absolute directory.
 * @throws when the value is empty, relative, missing, or resolves into a refused tree.
 */
function resolveProjectDir(value) {
  // The error text is part of what the panel shows a person, so the wording this
  // plugin has always used is preserved here rather than inherited from the
  // shared helper.
  if (value === '') throw new Error('No project directory: name one in the panel.');
  try {
    return resolveWriteDir(value, { label: 'The project directory' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/must be an absolute path/.test(message)) throw error;
    if (/does not exist/.test(message)) throw error;
    throw new Error(`Refusing to run a loop over ${/resolves to (\S+?),/.exec(message)?.[1] ?? value}: choose a project directory, not a system or credential tree.`);
  }
}

/**
 * Make a new run id: sortable by time and unique within a second.
 * @returns the run id.
 */
function makeRunId() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `hoh-${stamp}-${randomUUID().slice(0, 6)}`;
}

/**
 * The artifact paths of one iteration.
 * @param runDir - the run's record directory.
 * @param index - the 1-based iteration number.
 * @returns the iteration's directory and its artifacts.
 */
function iterationPaths(runDir, index) {
  const dir = join(runDir, `iteration-${index}`);
  return {
    dir,
    planPath: join(dir, 'plan.md'),
    evidencePath: join(dir, 'evidence.md'),
    structuredPath: join(dir, 'evidence.json'),
  };
}

/**
 * Describe one failure without losing its type.
 * @param error - the thrown value.
 * @returns a readable message.
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Clip a role's closing summary to the snapshot budget.
 * @param text - the summary text.
 * @returns the clipped text.
 */
function clip(text) {
  return text.length <= MAX_SUMMARY_CHARS ? text : `${text.slice(0, MAX_SUMMARY_CHARS)}\n… (truncated)`;
}

/**
 * Read the plain-text blocks of a settled role result.
 * @param result - the activation's settled result.
 * @returns the child's closing text.
 */
function textOf(result) {
  const blocks = Array.isArray(result?.output) ? result.output : [];
  return blocks
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

/**
 * Read the structured verdict a QA Tester submitted.
 *
 * The value is schema-validated by the subagent service, so this only narrows
 * it to the fields the engine acts on; anything unexpected is treated as "no
 * verdict" rather than as a pass.
 * @param result - the activation's settled result.
 * @returns the verdict, or `null` when the child submitted none.
 */
function verdictOf(result) {
  const structured = result?.structured;
  if (structured === null || typeof structured !== 'object' || Array.isArray(structured)) return null;
  const verified = Array.isArray(structured.verified) ? structured.verified : [];
  const gaps = Array.isArray(structured.gaps) ? structured.gaps : [];
  return {
    // Strictly `true`, never merely "not false". The schema makes `passed`
    // required, so an absent flag means the submission did not honour the
    // contract — and a verifier's silence must not read as a pass.
    passed: structured.passed === true,
    verified,
    gaps: gaps.map((gap) => ({
      gap: typeof gap?.gap === 'string' ? gap.gap : String(gap),
      // Upstream defaults an unknown severity to `high` (core/evidence.py:133).
      severity: SEVERITIES.includes(gap?.severity) ? gap.severity : 'high',
    })),
  };
}

/**
 * Decide whether one QA verdict actually accepts the iteration.
 *
 * A verdict can contradict itself: real runs recorded `passed: true` next to
 * `blocker` gaps. Acceptance therefore requires the flag *and* the absence of a
 * blocking gap, so one helper — not the flag alone — decides repair, iteration
 * completeness, and what the receipt reports.
 *
 * A missing verdict is **not** an acceptance. Upstream's
 * `tester_acceptance_passed` (`core/../adapters/gamecraft_bench/runner.py:418`)
 * returns false for anything that is not a dict and true only for an explicit
 * pass, so a verifier that says nothing fails closed. Treating "no verdict" as a
 * pass would let a Tester whose structured submission was rejected, or that
 * answered in prose, close its iteration as verified.
 * @param verdict - the parsed verdict, or `null` when the child submitted none.
 * @returns `{ accepted, blocking, missing }`.
 */
function acceptanceOf(verdict) {
  if (verdict === null) return { accepted: false, blocking: [], missing: true };
  const blocking = verdict.gaps.filter((gap) => BLOCKING_SEVERITIES.includes(gap.severity));
  return { accepted: verdict.passed && blocking.length === 0, blocking, missing: false };
}

/**
 * Dispose one activation without letting a cleanup failure reach the loop.
 * @param activation - the activation to release.
 */
async function safeDispose(activation) {
  try {
    await activation.dispose();
  } catch {
    // A cleanup failure is already reflected in the role's settled result.
  }
}

/**
 * Choose the delegation provider.
 *
 * The chosen provider must be able to accept the request `spawnRole` will send:
 * every turn carries `maxDepth`, so the backend needs `depthLimit`, and the QA
 * Tester's turn carries an `outputSchema`. Picking a provider that merely exists
 * — or only advertises `agentPreset` — defers the failure to the first Planner
 * turn, where it surfaces as an opaque capability error instead of a clear
 * "nothing here can run this loop".
 *
 * The in-process `spawn` backend is preferred when registered because it is the
 * backend this plugin is written against.
 * @param subagents - the host's subagent service.
 * @returns the provider name.
 * @throws when no registered backend supports the request.
 */
function pickProvider(subagents) {
  const names = subagents.list();
  const supports = (name) => {
    const capabilities = subagents.getProvider(name)?.capabilities ?? {};
    return capabilities.depthLimit === true;
  };
  if (names.includes('spawn') && supports('spawn')) return 'spawn';
  const usable = names.filter(supports);
  if (usable.length > 0) return usable[0];
  const detail = names.length === 0 ? 'no provider is registered' : `registered: ${names.join(', ')}; none supports depthLimit`;
  throw new Error(`The loop needs a subagent provider that supports depth limit (${detail}).`);
}

/**
 * Resolve the Agent the roles are delegated under.
 *
 * A named session must be live. Falling back to "some root session" when it is
 * not would silently parent a caller's run to a different conversation — the
 * roles would appear in someone else's subagent list, and `hoh_status` for the
 * named session would report a run it never started. A caller that named no
 * session at all (the CLI and tool paths) still gets the root fallback.
 * @param ctx - the scoped host context.
 * @param sessionId - the session the caller named, when it named one.
 * @returns the parent Agent, or `undefined` for an unnamed session when no root exists.
 * @throws when a named session is not live.
 */
function resolveParent(ctx, sessionId) {
  if (sessionId !== undefined && sessionId !== null && sessionId !== '') {
    const agent = ctx.agents.get(sessionId);
    if (agent === undefined) {
      throw new Error(
        `Session ${sessionId} is not live on this host, so a loop cannot be parented to it. Open that session and try again.`,
      );
    }
    return agent;
  }
  const roots = ctx.agents.roots();
  return roots.length > 0 ? roots[roots.length - 1] : undefined;
}

/**
 * Create the run engine.
 * @param options - the engine's collaborators.
 * @param options.ctx - the scoped host context, with `agents` and `subagents` available.
 * @param options.config - the resolved plugin configuration.
 * @param options.fallbackProjectDirectory - the directory to offer when the panel names none.
 * @param options.pluginVersion - this plugin's version, recorded for reproducibility.
 * @returns the engine.
 */
export function createEngine({ ctx, config, fallbackProjectDirectory, pluginVersion = '0.0.0' }) {
  /** Every session's run, live or finished, newest run last. */
  const runs = new Map();

  /**
   * The role bindings of one run, shaped like the upstream `RoleBinding`.
   *
   * Two depth numbers are kept because they are genuinely different and the
   * audit records are misleading if only one is written:
   *
   * - `maxDepth` is the GRANT — the extra levels a role may itself delegate.
   * - `maxDepthEffective` is the ABSOLUTE cap the subagent service enforces,
   *   which is the parent's depth plus one plus the grant.
   *
   * {@link absoluteRoleMaxDepth} derives the cap at delegation time; passing the
   * parent in here keeps the recorded cap identical to the enforced one.
   * @param parent - the session agent the roles are delegated from, when known.
   * @returns one binding per role.
   */
  /**
   * The project directory the panel offers before a run exists.
   *
   * The value must be one `start()` will accept. The host's working-directory
   * default is `process.cwd()` (or a temp directory), and the containment guard
   * refuses both a system tree and a bare temp root — so offering that value
   * unfiltered produced a panel whose Start button failed on its own default
   * with "Refusing to run a loop over /private/tmp". Fall back to the session's
   * working directory only when it passes the same check, and report an empty
   * string (which the panel renders as "name one") when nothing usable exists.
   * @returns a directory the engine will accept, or an empty string.
   */
  function usableDefaultDir() {
    const candidate = fallbackProjectDirectory();
    if (typeof candidate !== 'string' || candidate.trim() === '') return '';
    try {
      return resolveWriteDir(candidate.trim(), { mustExist: false, label: 'The project directory' });
    } catch {
      return '';
    }
  }

  function roleBindings(parent) {
    const effective = absoluteRoleMaxDepth(config.childMaxDepth, parent);
    const bindings = {};
    for (const role of ROLES) {
      bindings[role] = {
        preset: config.enforceRolePresets ? ROLE_PRESETS[role] ?? null : null,
        workspaceAccess: role === 'developer' ? 'read-write' : 'read-only',
        maxDepth: config.childMaxDepth,
        maxDepthEffective: effective,
      };
    }
    return bindings;
  }

  /**
   * Append one line to a run's log, keeping the snapshot bounded.
   * @param record - the run record.
   * @param level - `info`, `warn`, or `error`.
   * @param text - the line.
   */
  function logLine(record, level, text) {
    record.state.log.push({ time: Date.now(), level, text: String(text).slice(0, MAX_SUMMARY_CHARS) });
    if (record.state.log.length > MAX_LOG_ENTRIES) {
      record.state.log.splice(0, record.state.log.length - MAX_LOG_ENTRIES);
    }
  }

  /**
   * Write the run's public state to its record directory.
   * @param record - the run record.
   */
  function persist(record) {
    // After `dispose()` the plugin is unloading: the run is cancelled and its
    // map entry is gone, so a loop still unwinding must not keep writing records
    // into a directory nothing now owns.
    if (record.disposed === true) return;
    try {
      writeJson(join(record.state.runDir, 'run.json'), record.state);
    } catch {
      // Persistence is best-effort: the live snapshot stays authoritative.
    }
  }

  /**
   * Append the deterministic-host receipt after a role event.
   * @param record - the run record.
   */
  function persistReceipt(record) {
    if (record.disposed === true) return;
    try {
      writeReceipt(record.state.runDir, {
        activeIteration: record.machine.activeIteration,
        testerPolicy: record.state.testerPolicy,
        maxInnerRepairs: record.state.maxInnerRepairs,
        roles: record.state.roleBindings,
        events: record.machine.events,
      });
    } catch {
      // The run record still carries the same sequence.
    }
  }

  /**
   * Write one iteration's own record beside its role artifacts.
   * @param state - the run's public state.
   * @param iteration - the iteration record.
   */
  function writeIterationRecord(state, iteration) {
    try {
      const paths = iterationPaths(state.runDir, iteration.index);
      mkdirSync(paths.dir, { recursive: true });
      writeJson(join(paths.dir, 'iteration.json'), iteration);
      const evidence = iteration.phases.filter((phase) => phase.role === 'tester' && phase.verdict !== null);
      if (evidence.length > 0) {
        writeJson(paths.structuredPath, {
          schema_version: 1,
          iteration: iteration.index,
          rounds: evidence.map((phase) => ({
            round: phase.round,
            child_session_id: phase.childId,
            verdict: phase.verdict,
          })),
        });
      }
    } catch {
      // The run record still carries the iteration.
    }
  }

  /**
   * Describe the previous iteration's artifacts for the next prompts.
   * @param state - the run's public state.
   * @param index - the iteration number being prepared.
   * @returns the carried-over artifact paths and the Developer's summary.
   */
  function previousArtifacts(state, index) {
    const previous = state.history.find((entry) => entry.index === index - 1);
    if (previous === undefined) return undefined;
    const paths = iterationPaths(state.runDir, previous.index);
    let developerSummary;
    for (const phase of previous.phases) {
      if (phase.role === 'developer' && phase.summary) developerSummary = phase.summary;
    }
    return {
      planPath: existsSync(paths.planPath) ? paths.planPath : undefined,
      evidencePath: existsSync(paths.evidencePath) ? paths.evidencePath : undefined,
      developerSummary,
    };
  }

  /**
   * Open one iteration's record.
   * @param index - the 1-based iteration number.
   * @returns the iteration record, with no role turn recorded yet.
   */
  function iterationStarted(index) {
    return { index, status: 'running', startedAt: Date.now(), endedAt: null, phases: [] };
  }

  /**
   * Await one role activation, bounded by the wall-clock ceiling and
   * interruptible by a stop.
   * @param record - the run record.
   * @param activation - the started activation.
   * @returns the settled result.
   */
  async function awaitPhase(record, activation) {
    const { signal } = record.controller;
    const timeoutMs = config.phaseTimeoutSeconds * 1000;
    const outcome = activation.result.then(
      (value) => ({ ok: true, value }),
      (error) => ({ ok: false, error }),
    );

    let onAbort;
    const aborted = new Promise((resolve) => {
      if (signal.aborted) {
        resolve(ABORTED);
        return;
      }
      onAbort = () => resolve(ABORTED);
      signal.addEventListener('abort', onAbort, { once: true });
    });

    const resolveWinner = async (settled) => {
      if (settled === ABORTED) {
        await safeDispose(activation);
        throw new Error('The run was stopped while this role was running.');
      }
      if (settled === TIMEOUT) {
        await safeDispose(activation);
        throw new Error(`The role exceeded its ${Math.round(timeoutMs / 1000)}-second wall-clock ceiling.`);
      }
      if (settled.ok) return settled.value;
      throw settled.error;
    };

    let timer;
    const timeout =
      timeoutMs <= 0
        ? undefined
        : new Promise((resolve) => {
            timer = setTimeout(() => resolve(TIMEOUT), timeoutMs);
          });

    try {
      const race = timeout === undefined ? [outcome, aborted] : [outcome, timeout, aborted];
      return await resolveWinner(await Promise.race(race));
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort !== undefined) signal.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Delegate one role turn to a fresh DSH child agent.
   *
   * A read-only role is delegated under the read-only preset, so it has no
   * file-writing tool; the QA Tester additionally receives the evidence schema
   * as its structured output contract.
   * @param record - the run record.
   * @param role - the role to delegate.
   * @param prompt - the child's self-contained task prompt.
   * @param round - the repair round inside the iteration; 0 is the first pass.
   * @returns the started activation.
   */
  async function spawnRole(record, role, prompt, round) {
    const { state, controller } = record;
    const paths = iterationPaths(state.runDir, state.currentIteration);
    mkdirSync(paths.dir, { recursive: true });

    // The parent and provider were resolved when the run was admitted. Reusing
    // them keeps the recorded `max_depth_effective` equal to the cap actually
    // sent below: re-resolving could pick a different root session mid-run.
    const { parent } = record;
    if (parent === undefined) {
      throw new Error('No live DSH session is available to parent the roles. Open a chat session and start the run from its panel.');
    }

    const { provider } = record;
    const request = {
      cwd: state.projectDir,
      prompt: [{ type: 'text', text: prompt }],
      parent,
      // `maxDepth` caps the child's ABSOLUTE depth, so the configured extra
      // levels must be offset by the depth the child itself will occupy.
      maxDepth: absoluteRoleMaxDepth(config.childMaxDepth, parent),
    };
    const rolePreset = ROLE_PRESETS[role] ?? null;
    const capabilities = ctx.subagents.getProvider(provider)?.capabilities ?? {};
    if (config.enforceRolePresets && rolePreset !== null && capabilities.agentPreset === true) {
      request.agentPreset = rolePreset;
    }
    // The structured verdict is what the loop acts on, so it is only requested
    // from a provider that advertises schema support. A provider without it
    // would reject the activation at start, so asking anyway turns a clear
    // capability mismatch into an opaque child failure. The Tester then reports
    // prose and submits no verdict — which `acceptanceOf` treats as NOT
    // accepted, so the omission surfaces as an unaccepted iteration rather than
    // a silent pass.
    if (role === 'tester' && capabilities.outputSchema === true) request.outputSchema = EVIDENCE_SCHEMA;

    return ctx.subagents.startActivation({
      provider,
      label: `HoH ${ROLE_LABELS[role]} · iteration ${state.currentIteration}${round > 0 ? ` · repair ${round}` : ''}`,
      request,
      signal: controller.signal,
      delivery: 'caller',
    });
  }

  /**
   * Record one role turn as skipped without delegating it.
   * @param record - the run record.
   * @param iteration - the iteration record.
   * @param role - the role that will not run.
   * @param reason - why it will not run.
   * @param round - the repair round it belongs to, so a turn skipped after a
   *   repair is not recorded as round 0 and contradict the Developer turn before
   *   it.
   * @returns the recorded phase.
   */
  function recordSkipped(record, iteration, role, reason, round = 0) {
    const phase = {
      role,
      round,
      status: 'skipped',
      startedAt: null,
      endedAt: Date.now(),
      childId: null,
      summary: '',
      reason,
      verdict: null,
    };
    iteration.phases.push(phase);
    try {
      record.machine.record(role, { status: 'skipped', details: { round, reason } });
    } catch {
      // A skipped turn outside a legal position is dropped from the receipt
      // rather than failing the run.
    }
    logLine(record, 'warn', `Iteration ${iteration.index}: ${ROLE_LABELS[role]} skipped. ${reason}`);
  }

  /**
   * Close an iteration whose remaining roles will not run.
   * @param record - the run record.
   * @param iteration - the iteration record.
   * @param reason - why the iteration stopped early.
   */
  function fillSkipped(record, iteration, reason) {
    let lastIndex = -1;
    for (const phase of iteration.phases) {
      const at = ROLE_ORDER.indexOf(phase.role);
      if (at > lastIndex) lastIndex = at;
    }
    for (let at = lastIndex + 1; at < ROLE_ORDER.length; at += 1) {
      recordSkipped(record, iteration, ROLE_ORDER[at], reason);
    }
  }

  /**
   * Run one role turn and record it.
   * @param record - the run record.
   * @param iteration - the iteration record.
   * @param role - the role to run.
   * @param options - the repair context, when this turn is a repair.
   * @returns the recorded phase.
   */
  async function runRole(record, iteration, role, options = {}) {
    const { state, controller } = record;
    const index = iteration.index;
    const round = options.round ?? 0;
    state.phase = role;

    const phase = {
      role,
      round,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      childId: null,
      summary: '',
      reason: null,
      verdict: null,
    };
    iteration.phases.push(phase);
    logLine(record, 'info', `Iteration ${index}: ${ROLE_LABELS[role]}${round > 0 ? ` repair ${round}` : ''} started.`);
    persist(record);

    try {
      const paths = iterationPaths(state.runDir, index);
      const prompt = rolePrompt(role, {
        iteration: index,
        iterations: state.iterations,
        goal: state.goal,
        projectDir: state.projectDir,
        runDir: state.runDir,
        planPath: paths.planPath,
        evidencePath: paths.evidencePath,
        previous: previousArtifacts(state, index),
        repair: options.repair,
      });
      const activation = await spawnRole(record, role, prompt, round);
      phase.childId = String(activation.childId ?? '');
      record.activation = activation;
      logLine(record, 'info', `Iteration ${index}: ${ROLE_LABELS[role]} is running as session ${phase.childId}.`);
      persist(record);

      const result = await awaitPhase(record, activation);
      phase.summary = clip(textOf(result));
      if (role === 'tester') phase.verdict = verdictOf(result);

      if (controller.signal.aborted) {
        phase.status = 'skipped';
        phase.reason = 'The run was stopped while this role was running.';
      } else if (result !== undefined && result !== null && result.stopReason === 'completed') {
        phase.status = 'done';
      } else {
        phase.status = 'failed';
        phase.reason = `The role stopped with reason "${String(result?.stopReason ?? 'unknown')}".`;
      }
      await safeDispose(activation);
    } catch (error) {
      if (controller.signal.aborted) {
        phase.status = 'skipped';
        phase.reason = 'The run was stopped while this role was running.';
      } else {
        phase.status = 'failed';
        phase.reason = errorMessage(error);
      }
    } finally {
      phase.endedAt = Date.now();
      record.activation = undefined;
      state.phase = null;
      try {
        record.machine.record(role, {
          status: phase.status === 'done' ? 'completed' : phase.status,
          startedAt: phase.startedAt,
          endedAt: phase.endedAt,
          details: {
            round,
            child_session_id: phase.childId,
            ...(phase.reason === null ? {} : { reason: phase.reason }),
            ...(phase.verdict === null
              ? {}
              : {
                  // `accepted` is the effective verdict: the flag alone can
                  // disagree with the gaps it was submitted alongside.
                  passed: acceptanceOf(phase.verdict).accepted,
                  reported_passed: phase.verdict.passed,
                  verified: phase.verdict.verified.length,
                  gaps: phase.verdict.gaps.length,
                  blocking_gaps: acceptanceOf(phase.verdict).blocking.length,
                }),
          },
        });
      } catch (error) {
        logLine(record, 'error', `Iteration ${index}: receipt refused ${ROLE_LABELS[role]}: ${errorMessage(error)}`);
      }
      logLine(
        record,
        phase.status === 'done' ? 'info' : phase.status === 'failed' ? 'error' : 'warn',
        `Iteration ${index}: ${ROLE_LABELS[role]} ${phase.status}.${phase.reason === null ? '' : ` ${phase.reason}`}`,
      );
      persist(record);
      persistReceipt(record);
    }

    return phase;
  }

  /**
   * Decide whether a QA verdict sends the iteration back to the Developer.
   * @param state - the run's public state.
   * @param phase - the QA Tester phase that just finished.
   * @param round - the repair round it belongs to.
   * @returns whether another repair round runs.
   */
  function wantsRepair(state, phase, round) {
    if (state.testerPolicy !== 'repair-then-next') return false;
    if (phase.status !== 'done') return false;
    if (phase.verdict === null) return false;
    if (round >= state.maxInnerRepairs) return false;
    return !acceptanceOf(phase.verdict).accepted;
  }

  /**
   * Run the loop of one admitted run.
   * @param record - the run record.
   */
  async function runLoop(record) {
    const { state, controller } = record;
    try {
      for (let index = 1; index <= state.iterations; index += 1) {
        if (controller.signal.aborted) break;
        state.currentIteration = index;
        const iteration = iterationStarted(index);
        state.history.push(iteration);
        record.machine.begin(index);
        logLine(record, 'info', `Iteration ${index}/${state.iterations} started.`);
        persist(record);

        const planner = await runRole(record, iteration, 'planner', {});
        const abandoned = planner.status === 'failed' && !controller.signal.aborted;

        if (abandoned) {
          fillSkipped(record, iteration, 'This iteration stopped because the Project Planner did not finish.');
        } else if (controller.signal.aborted) {
          fillSkipped(record, iteration, 'The run was stopped before this role ran.');
        } else {
          let round = 0;
          for (;;) {
            const repair =
              round === 0
                ? undefined
                : {
                    round,
                    limit: state.maxInnerRepairs,
                    gaps: iteration.phases.filter((phase) => phase.role === 'tester').at(-1)?.verdict?.gaps ?? [],
                  };
            const developer = await runRole(record, iteration, 'developer', { round, repair });
            if (controller.signal.aborted) break;
            if (developer.status !== 'done') {
              // The verification turn never ran. Record it as skipped so the
              // iteration says so, instead of ending at `planner, developer` and
              // leaving a reader to infer that no Tester was ever attempted.
              recordSkipped(record, iteration, 'tester', 'The Developer did not finish, so verification could not run.', round);
              break;
            }

            const tester = await runRole(record, iteration, 'tester', { round });
            if (controller.signal.aborted) break;
            if (!wantsRepair(state, tester, round)) break;
            round += 1;
            logLine(
              record,
              'warn',
              `Iteration ${index}: QA Tester reported ${tester.verdict.gaps.length} gap(s); repair ${round} of ${state.maxInnerRepairs}.`,
            );
          }
          if (controller.signal.aborted) fillSkipped(record, iteration, 'The run was stopped before this role ran.');
        }

        iteration.endedAt = Date.now();
        // A repair supersedes the verdict that triggered it, so the iteration's
        // acceptance is the last QA verdict's, not every verdict on the way. An
        // iteration with no tester verdict at all is never accepted: a missing
        // verdict is the absence of evidence, not evidence of a pass.
        const lastTester = iteration.phases.filter((phase) => phase.role === 'tester').at(-1);
        const accepted = lastTester !== undefined && acceptanceOf(lastTester.verdict).accepted;
        const complete = iteration.phases.every((phase) => phase.status === 'done') && accepted;
        iteration.status = complete ? 'done' : controller.signal.aborted ? 'stopped' : 'partial';
        try {
          record.machine.finish();
        } catch (error) {
          // `finish()` refuses an iteration whose Developer never ran, and it
          // leaves the machine's active iteration set when it refuses. Logging
          // and moving on would strand that state, and the NEXT `begin()` would
          // then throw out of the loop — one bookkeeping fault in iteration N
          // would turn the whole run into `error` during N+1. Abandoning the
          // open iteration keeps the machine usable for the rest of the run.
          logLine(record, 'error', `Iteration ${index}: ${errorMessage(error)}`);
          record.machine.abandon();
        }
        writeIterationRecord(state, iteration);
        persist(record);
        persistReceipt(record);

        if (abandoned) {
          const failed = iteration.phases.find((phase) => phase.role === 'planner');
          state.status = 'error';
          state.error = `Iteration ${index} could not start: ${failed?.reason ?? 'the Project Planner did not finish.'}`;
          logLine(record, 'error', state.error);
          break;
        }
      }

      // The run's status must not be greener than the iterations it is made of.
      // A Tester that fails every iteration used to leave `state.status` at
      // 'done' with `error: null` while every iteration was 'partial' — a run
      // that reported success with zero verified evidence, which is the same
      // fail-open class as accepting a missing verdict, one level up.
      if (state.status === 'running') {
        const unfinished = state.history.find((entry) => entry.status !== 'done');
        // An iteration that ended `partial` is a completed loop that did not
        // achieve acceptance, which is `partial` at the run level — not `error`,
        // which is reserved for a run that could not proceed.
        state.status = controller.signal.aborted
          ? 'stopped'
          : unfinished === undefined
            ? 'done'
            : unfinished.status === 'partial'
              ? 'partial'
              : 'error';
        if (!controller.signal.aborted && unfinished !== undefined) {
          state.error = unfinished.status === 'partial'
            ? `Iteration ${unfinished.index} was not accepted, so the run did not fully complete.`
            : `Iteration ${unfinished.index} ended ${unfinished.status}, so the run did not complete.`;
          logLine(record, 'warn', state.error);
        }
      }
    } catch (error) {
      state.status = 'error';
      state.error = errorMessage(error);
      logLine(record, 'error', `The run failed: ${state.error}`);
    } finally {
      state.phase = null;
      state.endedAt = Date.now();
      if (state.status === 'stopping') state.status = 'stopped';
      logLine(record, 'info', `Run ${state.id} ended with status "${state.status}".`);
      persist(record);
      persistReceipt(record);
      record.activation = undefined;
    }
  }

  return {
    /**
     * Admit a new run and start its loop in the background.
     * @param request - the run request.
     * @returns the admitted run's state.
     */
    start(request) {
      const key = keyFor(request.sessionId);
      const existing = runs.get(key);
      if (existing !== undefined && (existing.state.status === 'running' || existing.state.status === 'stopping')) {
        throw new Error('A Harness of Harness run is already active in this session. Stop it before starting another.');
      }

      const goal = typeof request.goal === 'string' ? request.goal.trim() : '';
      if (goal === '') throw new Error('Describe what the loop should build: the requirements text is empty.');
      if (goal.length > MAX_GOAL_CHARS) {
        throw new Error(`The requirements text is longer than ${MAX_GOAL_CHARS} characters.`);
      }

      const requestedDir = typeof request.projectDir === 'string' ? request.projectDir.trim() : '';
      if (requestedDir.length > MAX_DIRECTORY_CHARS) {
        throw new Error(`The project directory is longer than ${MAX_DIRECTORY_CHARS} characters.`);
      }
      const projectDir = resolveProjectDir(requestedDir || fallbackProjectDirectory());

      // A non-integer budget is a caller mistake, not a request to use the
      // default: accepting `3.5` or `"3"` silently would run a different number
      // of iterations than the caller asked for.
      const iterations = request.iterations === undefined ? config.defaultIterations : request.iterations;
      if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
        throw new Error(`The iteration budget must be a whole number from ${MIN_ITERATIONS} to ${MAX_ITERATIONS}.`);
      }

      const runId = makeRunId();
      const runDir = config.stateDir === '' ? join(projectDir, '.hoh', 'runs', runId) : join(config.stateDir, 'runs', runId);
      // Upstream refuses a run directory that already holds a receipt, so a
      // mistyped run id can never overwrite an audited run.
      if (existsSync(join(runDir, RECEIPT_FILE)) || existsSync(join(runDir, 'run.json'))) {
        throw new Error(`Run records already exist in ${runDir}; start a new run instead of reusing a run id.`);
      }

      // Resolve the two things the run cannot work without, before it is
      // admitted. `pickProvider` throws when nothing registered can accept the
      // request the loop will send; swallowing that here would admit a run that
      // cannot delegate and surface the real error as a Planner failure instead.
      //
      // Both are resolved once and reused: re-resolving inside `spawnRole` could
      // pick a different root session, which would make the recorded depth cap
      // disagree with the one actually enforced.
      const parent = resolveParent(ctx, key === '__default__' ? undefined : key);
      const provider = pickProvider(ctx.subagents);
      const bindings = roleBindings(parent);
      const startedAt = Date.now();
      const record = {
        state: {
          id: runId,
          sessionId: key === '__default__' ? null : key,
          status: 'running',
          goal,
          projectDir,
          iterations,
          currentIteration: 0,
          phase: null,
          startedAt,
          endedAt: null,
          error: null,
          runDir,
          testerPolicy: config.testerPolicy,
          maxInnerRepairs: config.maxInnerRepairs,
          roleBindings: bindings,
          history: [],
          log: [],
        },
        controller: new AbortController(),
        activation: undefined,
        machine: createRoleMachine(),
        parent,
        provider,
      };
      runs.set(key, record);

      try {
        writeJson(
          join(runDir, REPRODUCIBILITY_FILE),
          buildReproducibility({
            plugin: { name: 'dsh-plugin-harness-of-harness', version: pluginVersion },
            provider,
            projectDir,
            git: gitRevision(projectDir),
            presetId: 'harness-of-harness',
            roleBindings: bindings,
            config,
            testerPolicy: config.testerPolicy,
            maxInnerRepairs: config.maxInnerRepairs,
            startedAt,
          }),
        );
      } catch (error) {
        logLine(record, 'warn', `Could not write reproducibility.json: ${errorMessage(error)}`);
      }

      logLine(record, 'info', `Run ${runId} admitted: ${iterations} iteration(s) in ${projectDir}.`);
      persist(record);
      persistReceipt(record);
      void runLoop(record);
      return record.state;
    },

    /**
     * Stop the session's active run without waiting for it to quiesce.
     * @param request - the stop request.
     * @returns whether a run was stopped, and its state.
     */
    stop(request) {
      const record = runs.get(keyFor(request.sessionId));
      if (record === undefined || (record.state.status !== 'running' && record.state.status !== 'stopping')) {
        return { ok: false, message: 'No Harness of Harness run is active in this session.' };
      }
      record.state.status = 'stopping';
      logLine(record, 'warn', 'Stop requested: cancelling the current role and the remaining iterations.');
      persist(record);
      record.controller.abort();
      const activation = record.activation;
      if (activation !== undefined) {
        void safeDispose(activation);
      }
      return { ok: true, run: record.state };
    },

    /**
     * Read one session's run.
     * @param sessionId - the session whose slot to read.
     * @returns the run's state, or `null` when the slot is empty.
     */
    read(sessionId) {
      return runs.get(keyFor(sessionId))?.state ?? null;
    },

    /**
     * Read the newest run across every session.
     * @returns the newest run's state, or `null`.
     */
    latest() {
      let newest = null;
      for (const record of runs.values()) {
        if (newest === null || record.state.startedAt >= newest.startedAt) newest = record.state;
      }
      return newest;
    },

    /**
     * The defaults the panel offers before a run exists.
     * @returns the default project directory and iteration budget.
     */
    defaults() {
      return { projectDir: usableDefaultDir(), iterations: config.defaultIterations };
    },

    /**
     * Cancel every live run. Called when the plugin unloads or is replaced.
     */
    dispose() {
      for (const record of runs.values()) {
        if (record.state.status !== 'running' && record.state.status !== 'stopping') continue;
        record.state.status = 'stopped';
        record.state.endedAt = Date.now();
        // Mark before aborting, so the loop's own teardown writes below are the
        // last ones: the final state is recorded here, then persistence stops.
        record.controller.abort();
        const activation = record.activation;
        if (activation !== undefined) {
          void safeDispose(activation);
        }
        persist(record);
        persistReceipt(record);
        record.disposed = true;
      }
      runs.clear();
    },
  };
}
