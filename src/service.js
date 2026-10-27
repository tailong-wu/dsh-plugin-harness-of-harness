/**
 * The Harness of Harness *mode* service.
 *
 * The engine is owned by the Host half of this bundle; this module is the
 * narrow, service-shaped face a preset-scoped plugin consumes. It exists
 * because a preset cannot mount the Host plugin itself: preset rows contribute
 * scoped tools to a session, while shared services stay in the Host
 * composition.
 *
 * Every method takes the calling session so one session's run is never
 * confused with another's.
 * @module dsh-plugin-harness-of-harness/service
 */

import { MAX_ITERATIONS, MIN_ITERATIONS, ROLES } from './contract.js';

/** The Cordis service key this plugin provides. */
export const SERVICE_KEY = 'hohHarnessOfHarness';

/**
 * Project a run's live state into the compact shape a model reads.
 *
 * The full snapshot carries bounded history and a log for the panel; a model
 * call is answered with the facts that decide its next action.
 * @param state - the run state, or `null`.
 * @returns the model-facing summary, or `null`.
 */
export function summariseRun(state) {
  if (state === null || state === undefined) return null;
  const current = Array.isArray(state.history) && state.history.length > 0
    ? state.history[state.history.length - 1]
    : undefined;
  return {
    run_id: state.id,
    status: state.status,
    goal: state.goal,
    project_dir: state.projectDir,
    run_dir: state.runDir,
    iteration: state.currentIteration,
    iterations: state.iterations,
    phase: state.phase,
    current_iteration: current === undefined
      ? null
      : {
          index: current.index,
          status: current.status,
          roles: (current.phases ?? []).map((phase) => ({
            role: phase.role,
            round: phase.round ?? 0,
            status: phase.status,
            child_session_id: phase.childId,
            elapsed_ms:
              phase.startedAt === null || phase.startedAt === undefined
                ? null
                : (phase.endedAt ?? Date.now()) - phase.startedAt,
            summary: phase.summary ?? '',
            reason: phase.reason ?? null,
            verdict:
              phase.verdict === null || phase.verdict === undefined
                ? null
                : {
                    passed: phase.verdict.passed,
                    verified: phase.verdict.verified.length,
                    gaps: phase.verdict.gaps,
                  },
          })),
        },
    completed_iterations: (state.history ?? [])
      .filter((iteration) => iteration.status !== 'running')
      .map((iteration) => ({
        index: iteration.index,
        status: iteration.status,
        roles: (iteration.phases ?? []).map((phase) => `${phase.role}:${phase.status}`),
      })),
    error: state.error ?? null,
  };
}

/**
 * Wrap one engine in the service contract.
 *
 * The wrapper adds the model-facing vocabulary — the role order, the budget
 * bounds, and the summary projection — and otherwise forwards to the engine.
 * @param engine - the run engine.
 * @returns the service value registered as {@link SERVICE_KEY}.
 */
export function createModeService(engine) {
  return {
    /** The role order of one iteration, for prompt and tool text. */
    roles: ROLES,
    /** The accepted iteration budget. */
    bounds: { min: MIN_ITERATIONS, max: MAX_ITERATIONS },

    /**
     * Admit a run for one session.
     * @param request - `sessionId`, `goal`, optional `projectDir` and `iterations`.
     * @returns the admitted run's full state.
     */
    start(request) {
      return engine.start(request);
    },

    /**
     * Stop one session's active run.
     * @param request - `sessionId`.
     * @returns whether a run was stopped, with its state.
     */
    stop(request) {
      return engine.stop(request);
    },

    /**
     * Read one session's run.
     * @param sessionId - the session whose slot to read.
     * @returns the run state, or `null`.
     */
    read(sessionId) {
      return engine.read(sessionId);
    },

    /**
     * Read the newest run across every session.
     * @returns the newest run state, or `null`.
     */
    latest() {
      return engine.latest();
    },

    /**
     * The defaults a caller offers before a run exists.
     * @returns the default project directory and iteration budget.
     */
    defaults() {
      return engine.defaults();
    },
  };
}