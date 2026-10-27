/**
 * dsh-plugin-harness-of-harness/tools: the Harness of Harness mode's own verbs.
 *
 * A preset mounts this row, so the three tools below exist only for sessions
 * that selected the Harness of Harness preset. They drive the same run engine
 * the side panel starts, which is why a panel run and an agent-started run are
 * the same kind of run and appear in the same place.
 *
 * The row contributes no service of its own: it consumes the Host plugin's
 * `hohHarnessOfHarness` service, and the calling Agent decides which session's
 * run every call addresses.
 * @module dsh-plugin-harness-of-harness/tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools';

import { SERVICE_KEY, summariseRun } from './src/service.js';

/** Cordis plugin name for the preset-scoped tool row. */
export const name = 'harness-of-harness-tools';

/** The tool registry, plus the run service the Host half provides. */
export const inject = ['tools', SERVICE_KEY];

/**
 * Render one canonical value as JSON text.
 * @param value - the tool's canonical value.
 * @returns one text block.
 */
function renderJSON(value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

/**
 * Read the session a call runs for.
 * @param exec - the tool execution context.
 * @returns the session id, or `undefined` outside an Agent.
 */
function sessionOf(exec) {
  const agent = exec?.agent;
  return agent === undefined || agent === null ? undefined : String(agent.id);
}

/**
 * Build the mode's tool definitions.
 * @param service - the run service.
 * @returns the definitions, ready to register.
 */
export function hohTools(service) {
  return [
    defineTool({
      name: 'hoh_start',
      description:
        'Start a Harness of Harness run for a project: iterations of Project Planner, Developer, then QA Tester, ' +
        'each iteration carrying its development document and evidence into the next until the artifact meets the ' +
        'requirements. Returns the run id, its record directory, and the state of the first iteration. The run ' +
        'continues in the background; hoh_status follows it and hoh_stop cancels it.',
      parameters: {
        goal: {
          type: 'string',
          required: true,
          description:
            'What the project should become, as requirements the Planner writes against and the QA Tester verifies. ' +
            'The loop reads this text every iteration, so state observable goals rather than a one-off task.',
        },
        project_dir: {
          type: 'string',
          description: 'Absolute directory holding the artifact. Omit for the working directory the roles inherit.',
        },
        iterations: {
          type: 'integer',
          description: 'Iterations to run, 1 to 50. Omit for the profile default; each role runs once per iteration.',
        },
      },
      output: { schema: { type: 'json' }, render: (_args, value) => renderJSON(value) },
      async execute(args, exec) {
        const state = service.start({
          sessionId: sessionOf(exec),
          goal: args.goal,
          projectDir: args.project_dir,
          iterations: args.iterations,
        });
        return {
          ok: true,
          run: summariseRun(state),
          note: 'The run continues in the background. Call hoh_status to follow its iterations.',
        };
      },
    }),

    defineTool({
      name: 'hoh_status',
      description:
        "This session's Harness of Harness run: status, the iteration in flight with each role's turn and closing " +
        'summary, the iterations already finished, and the directory holding the development documents and evidence ' +
        'bundles. Use it after hoh_start and while a run is live.',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_args, value) => renderJSON(value) },
      isConcurrencySafe: () => true,
      async execute(_args, exec) {
        const state = service.read(sessionOf(exec));
        if (state === null || state === undefined) {
          return {
            run: null,
            message: 'No Harness of Harness run is recorded for this session.',
            defaults: service.defaults(),
          };
        }
        return { run: summariseRun(state) };
      },
    }),

    defineTool({
      name: 'hoh_stop',
      description:
        "Stop this session's active Harness of Harness run: the role now running is cancelled and the remaining " +
        'iterations are skipped. Returns whether a run was stopped, with its final state.',
      parameters: {},
      output: { schema: { type: 'json' }, render: (_args, value) => renderJSON(value) },
      async execute(_args, exec) {
        const outcome = service.stop({ sessionId: sessionOf(exec) });
        if (!outcome.ok) {
          return { ok: false, run: null, message: outcome.message };
        }
        return {
          ok: true,
          run: summariseRun(outcome.run ?? null),
          message: 'Stopping: the running role is cancelled and the remaining iterations are skipped.',
        };
      },
    }),
  ];
}

/**
 * Register the mode's tools for the sessions that selected this preset.
 * @param ctx - the preset-scoped context.
 */
export function apply(ctx) {
  const service = ctx[SERVICE_KEY];
  for (const tool of hohTools(service)) ctx.tools.register(tool);
}