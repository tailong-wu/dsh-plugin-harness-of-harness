/**
 * Values shared by both halves of the Harness of Harness plugin: the panel's
 * HTTP routes, the loop's role vocabulary, and the input limits the Host
 * enforces before a run is admitted.
 *
 * The client bundle imports this module too, so every value here must stay
 * free of Node-only imports.
 * @module dsh-plugin-harness-of-harness/contract
 */

/** Prefix of every route this plugin registers. */
export const ROUTE_PREFIX = '/api/plugins/hoh-harness-of-harness';

/** Reads whether the panel is enabled plus the defaults it offers. */
export const CONFIG_PATH = `${ROUTE_PREFIX}/config`;

/** Reads the current run for one session. */
export const STATE_PATH = `${ROUTE_PREFIX}/state`;

/** Starts a run. */
export const START_PATH = `${ROUTE_PREFIX}/start`;

/** Stops the run in progress. */
export const STOP_PATH = `${ROUTE_PREFIX}/stop`;

/** The three roles of one iteration, in execution order. */
export const ROLES = ['planner', 'developer', 'tester'];

/** Role display names used by the panel and by the delegated prompts. */
export const ROLE_LABELS = {
  planner: 'Project Planner',
  developer: 'Developer',
  tester: 'QA Tester',
};

/** Whole-run lifecycle values. */
export const RUN_STATUSES = ['running', 'stopping', 'stopped', 'done', 'error'];

/** Lifecycle values for one role's turn inside an iteration. */
export const PHASE_STATUSES = ['pending', 'running', 'done', 'failed', 'skipped'];

/** Lower bound on a run's iteration budget. */
export const MIN_ITERATIONS = 1;

/** Upper bound on a run's iteration budget. */
export const MAX_ITERATIONS = 50;

/** Upper bound on the requirements text a run accepts. */
export const MAX_GOAL_CHARS = 8000;

/** Upper bound on an accepted project directory length. */
export const MAX_DIRECTORY_CHARS = 4096;

/** How many log lines one snapshot keeps. */
export const MAX_LOG_ENTRIES = 200;

/** How many characters of a role's closing summary one snapshot keeps. */
export const MAX_SUMMARY_CHARS = 4000;

/** The locale namespace both halves register their copy under. */
export const LOCALE_NAMESPACE = 'hohPanel';

/**
 * The role a correct iteration must start with, mirroring the upstream
 * `GameLoopRuntime._validate_transition` rule that Planner always opens a loop.
 */
export const FIRST_ROLE = 'planner';

/**
 * Legal role transitions inside one iteration.
 *
 * `tester -> developer` is what makes `repair-then-next` possible: a QA Tester
 * that finds a gap hands the same iteration back to the Developer.
 * `tester -> tester` is retained because the upstream runtime admits a final
 * acceptance Tester after an acceptance Tester.
 */
export const ALLOWED_TRANSITIONS = {
  planner: ['developer'],
  developer: ['tester'],
  tester: ['developer', 'tester'],
};

/** How a QA Tester's verdict is acted on. */
export const TESTER_POLICIES = ['next-loop', 'repair-then-next'];

/**
 * The gap severities the evidence schema accepts, matching the upstream
 * `allowed_severities` set in `core/evidence.py`.
 */
export const SEVERITIES = ['blocker', 'high', 'medium', 'low'];

/**
 * The severities that make an iteration incomplete on their own, when a QA
 * verdict reports them despite its own `passed` flag. This is the plugin's own
 * guard: real runs showed a Tester marking `passed: true` while listing
 * blockers, which the `passed` field alone would wave through.
 */
export const BLOCKING_SEVERITIES = ['blocker'];

/** Upper bound on same-iteration Developer repairs. */
export const MAX_INNER_REPAIRS_LIMIT = 5;

/**
 * The agent preset each role is delegated under.
 *
 * The two read-only roles get a composition whose file tool cannot write; the
 * Developer inherits the session's own preset (`null`), because it must change
 * the artifact and needs exactly the capability set the person selected.
 */
export const ROLE_PRESETS = {
  planner: 'hoh-readonly',
  developer: null,
  tester: 'hoh-readonly',
};

/**
 * The preset that carries the read-only role toolset, as declared in the patch.
 */
export const READ_ONLY_PRESET = 'hoh-readonly';

/**
 * The canonical structured verdict a QA Tester submits.
 *
 * It is handed to the child as `request.outputSchema`, so the engine reads a
 * schema-validated value instead of parsing prose — the same role the upstream
 * evidence builders play for `build_verified_demo_claims` and
 * `build_loop_issues`.
 */
export const EVIDENCE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    passed: {
      type: 'boolean',
      description:
        'True when every requirement this iteration set out to satisfy is verified. Independent of `gaps`: a pass may still record polish observations, and the Developer is sent back only when `passed` is false.',
    },
    verified: {
      type: 'array',
      description: 'One entry per behavior you actually exercised and observed.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['claim', 'evidence'],
        properties: {
          claim: { type: 'string', description: 'The behavior that now works.' },
          evidence: { type: 'string', description: 'What you ran or inspected, and what it showed.' },
        },
      },
    },
    gaps: {
      type: 'array',
      description:
        'Every unresolved observation, most important first, whether or not it fails a requirement. Record polish and accessibility notes here too; `passed` alone decides whether they block.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['gap', 'severity'],
        properties: {
          gap: { type: 'string', description: 'What is missing or wrong, and how it was observed.' },
          severity: {
            type: 'string',
            enum: ['blocker', 'high', 'medium', 'low'],
            description: 'How much the gap costs. `blocker` and `high` mark work a repair pass must close.',
          },
        },
      },
    },
  },
  required: ['passed', 'verified', 'gaps'],
};