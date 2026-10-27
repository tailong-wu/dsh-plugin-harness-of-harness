/**
 * The role transition state machine of one iteration.
 *
 * This mirrors the upstream `GameLoopRuntime`: a deterministic host that owns
 * sequencing rather than an agent that decides it. The upstream runtime refuses
 * an illegal transition and refuses to finish an iteration whose Developer
 * never ran; so does this one. Keeping the rule here — instead of relying on
 * the loop's `for` order — is what lets `repair-then-next` exist without
 * turning the sequence into "however the orchestrator felt like it".
 * @module dsh-plugin-harness-of-harness/transitions
 */

import { ALLOWED_TRANSITIONS, FIRST_ROLE } from './contract.js';

/**
 * Read the roles that may run after `previous`.
 * @param previous - the last recorded role, or `undefined` before the first one.
 * @returns the roles the runtime admits next.
 */
export function allowedAfter(previous) {
  if (previous === undefined) return [FIRST_ROLE];
  return ALLOWED_TRANSITIONS[previous] ?? [];
}

/**
 * Create a role machine bound to one run.
 *
 * Every role turn is recorded through {@link RoleMachine.record}, whether it
 * completed, failed, or was skipped, so the receipt shows the sequence the run
 * actually took.
 * @returns the machine.
 */
export function createRoleMachine() {
  /** The iteration the machine is inside, or `null` between iterations. */
  let active = null;
  /** Every recorded turn, in run order. */
  const events = [];

  /**
   * Report an illegal transition the way the upstream runtime does.
   * @param previous - the role it follows.
   * @param role - the role that was attempted.
   * @param iteration - the iteration in force.
   */
  function reject(previous, role, iteration) {
    const allowed = allowedAfter(previous).join(' or ') || 'nothing';
    const from = previous === undefined ? 'the start of an iteration' : previous;
    throw new Error(
      `invalid role transition in iteration ${iteration}: ${from} -> ${role} (allowed: ${allowed})`,
    );
  }

  return {
    /**
     * Open one iteration.
     * @param index - the 1-based iteration number.
     */
    begin(index) {
      if (active !== null) throw new Error(`iteration ${active} is still active`);
      if (!Number.isInteger(index) || index < 1) throw new Error('an iteration index must be a whole number >= 1');
      active = index;
    },

    /**
     * Validate and record one role turn.
     * @param role - the role that ran.
     * @param details - status, timing, and any diagnostic to keep.
     * @returns the recorded event.
     */
    record(role, details = {}) {
      if (active === null) throw new Error('begin() must run before a role is recorded');
      const current = events.filter((event) => event.iteration_index === active);
      const previous = current.length === 0 ? undefined : current[current.length - 1].role;
      if (!allowedAfter(previous).includes(role)) reject(previous, role, active);

      const startedAt = Date.now();
      const event = {
        iteration_index: active,
        sequence: events.length + 1,
        role,
        status: details.status ?? 'completed',
        started_at: new Date(startedAt).toISOString(),
        duration_seconds: Math.max(0, (details.endedAt ?? startedAt) - (details.startedAt ?? startedAt)) / 1000,
        details: details.details ?? {},
      };
      events.push({ ...event, role, iteration_index: active });
      return event;
    },

    /**
     * Close the iteration.
     *
     * An iteration whose Developer never ran is refused, exactly as upstream
     * refuses a loop that finishes before its Developer stage.
     */
    finish() {
      if (active === null) throw new Error('no active iteration');
      const current = events.filter((event) => event.iteration_index === active);
      if (!current.some((event) => event.role === 'developer')) {
        throw new Error('an iteration cannot finish before the Developer stage');
      }
      active = null;
    },

    /**
     * Drop the open iteration without closing it (used when a stop arrives
     * mid-sequence).
     */
    abandon() {
      active = null;
    },

    /** The iteration in force, or `null`. */
    get activeIteration() {
      return active;
    },

    /** Every recorded turn, in run order. */
    get events() {
      return events.map((event) => ({ ...event, details: { ...event.details } }));
    },
  };
}