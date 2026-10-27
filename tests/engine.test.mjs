/**
 * Functional tests for the Host half.
 *
 * They drive the real engine and the real panel routes against a fake
 * delegation service that follows the documented `ctx.subagents` contract, so
 * the loop's ordering, artifact hand-off, cancellation, failure handling, and
 * HTTP surface are all exercised without a live harness or a credential.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';

import { MAX_ITERATIONS } from '../src/contract.js';
import { createEngine } from '../src/engine.js';
import { registerPanelRoutes } from '../src/panel.js';

/** Busy-wait without a real timer dependency. */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The project directories this suite created, removed when it finishes. */
const scratch = [];

/** Make one throwaway project directory. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'hoh-test-'));
  scratch.push(dir);
  return dir;
}

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/**
 * Build a fake host that satisfies the engine's collaborators.
 * @param behavior - `ok`, `never`, or `planner-error`.
 */
function makeHost(behavior = 'ok') {
  const delegations = [];
  const disposed = [];
  const parent = { id: 'session-parent' };

  /**
   * Simulate the child writing the artifact its prompt names, for its own
   * iteration only.
   * @param label - the activation label carrying the iteration number.
   * @param prompt - the child's task prompt.
   */
  function writeArtifact(label, prompt) {
    const iteration = /iteration (\d+)/.exec(label)?.[1];
    if (iteration === undefined) return;
    const artifact = /Planner/.test(label) ? 'plan.md' : /Tester/.test(label) ? 'evidence.md' : undefined;
    if (artifact === undefined) return;
    const target = prompt.match(new RegExp(`\\S*iteration-${iteration}/${artifact.replace('.', '\\.')}`))?.[0];
    if (target === undefined) return;
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `# ${artifact} for iteration ${iteration}\n`, 'utf8');
  }

  const subagents = {
    list: () => ['spawn'],
    getProvider: () => ({ capabilities: { agentPreset: true } }),
    startActivation: async (spec) => {
      // Enforce `maxDepth` the way the real service does: it caps the child's
      // ABSOLUTE depth, which is the parent's depth plus one. A delegating host
      // that passed the configured recursion budget straight through would fail
      // here at the first role instead of only in a live run.
      const parentDepth = Math.max(
        parent.session?.header?.delegationDepth ?? 0,
        parent.options?.subagentDepth ?? 0,
      );
      const childDepth = parentDepth + 1;
      if (spec.request.maxDepth !== undefined && childDepth > spec.request.maxDepth) {
        throw new Error(`subagent depth ${childDepth} exceeds maxDepth ${spec.request.maxDepth}`);
      }
      delegations.push(spec);
      const childId = `child-${delegations.length}`;
      let settle;
      const result = new Promise((resolve) => {
        settle = resolve;
      });
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        settle(value);
      };
      if (behavior !== 'never') {
        if (behavior === 'planner-error' && /Planner/.test(spec.label)) {
          finish({ output: [{ type: 'text', text: 'the planner gave up' }], stopReason: 'error' });
        } else {
          writeArtifact(spec.label, spec.request.prompt[0].text);
          finish({ output: [{ type: 'text', text: `completed ${childId}` }], stopReason: 'completed' });
        }
      }
      return {
        childId,
        result,
        dispose: async () => {
          disposed.push(childId);
          finish({ output: [{ type: 'text', text: `aborted ${childId}` }], stopReason: 'aborted' });
        },
      };
    },
  };

  const agents = {
    get: (id) => (id === 'session-parent' ? parent : undefined),
    roots: () => [parent],
  };

  return { ctx: { agents, subagents }, delegations, disposed, parent };
}

/** Build an engine over a fake host. */
function makeEngine({ projectDir, behavior = 'ok', overrides = {} } = {}) {
  const host = makeHost(behavior);
  const config = {
    showPanel: true,
    stateDir: '',
    defaultIterations: 1,
    phaseTimeoutSeconds: 0,
    childMaxDepth: 0,
    ...overrides,
  };
  const engine = createEngine({
    ctx: host.ctx,
    config,
    fallbackProjectDirectory: () => projectDir ?? '',
  });
  return { engine, host };
}

/** Wait until a run stops being in flight. */
async function settled(state, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.status !== 'running' && state.status !== 'stopping') return state;
    await delay(10);
  }
  throw new Error(`run did not settle within ${timeoutMs}ms (status ${state.status})`);
}

test('one iteration delegates the three roles in order and records every artifact', async () => {
  const projectDir = project();
  const { engine, host } = makeEngine({ projectDir });

  const state = engine.start({ sessionId: 'session-parent', goal: 'Build a small tool.', iterations: 1 });
  assert.equal(state.status, 'running', 'start() must admit the run and return immediately');

  await settled(state);

  assert.equal(state.status, 'done');
  assert.equal(state.error, null);
  assert.deepEqual(
    host.delegations.map((spec) => spec.label.replace('HoH ', '').split(' ·')[0]),
    ['Project Planner', 'Developer', 'QA Tester'],
  );
  for (const spec of host.delegations) {
    assert.equal(spec.provider, 'spawn');
    assert.equal(spec.delivery, 'caller', 'a role must not post a completion notice into the conversation');
    assert.equal(spec.request.cwd, projectDir);
    assert.equal(spec.request.parent, host.delegations[0].request.parent);
    // `childMaxDepth: 0` grants a role no further delegation, which is an
    // ABSOLUTE cap of 1: the role itself. Passing 0 through verbatim is the bug
    // that failed every run at its first role with "depth 1 exceeds maxDepth 0".
    assert.equal(spec.request.maxDepth, 1);
    assert.equal(spec.request.prompt[0].type, 'text');
  }
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].status, 'done');
  assert.deepEqual(state.history[0].phases.map((phase) => phase.status), ['done', 'done', 'done']);
  assert.equal(host.disposed.length, 3, 'every activation must be released');

  const runRecord = JSON.parse(readFileSync(join(state.runDir, 'run.json'), 'utf8'));
  assert.equal(runRecord.status, 'done');
  const iterationRecord = JSON.parse(readFileSync(join(state.runDir, 'iteration-1', 'iteration.json'), 'utf8'));
  assert.equal(iterationRecord.phases.length, 3);
  assert.match(readFileSync(join(state.runDir, 'iteration-1', 'plan.md'), 'utf8'), /plan\.md for iteration 1/);
  assert.match(readFileSync(join(state.runDir, 'iteration-1', 'evidence.md'), 'utf8'), /evidence\.md for iteration 1/);

  engine.dispose();
});

test("the next iteration's Planner reads the previous development document and evidence", async () => {
  const projectDir = project();
  const { engine, host } = makeEngine({ projectDir, overrides: { defaultIterations: 2 } });

  const state = engine.start({ sessionId: 'session-parent', goal: 'Grow the tool.', iterations: 2 });
  await settled(state);

  assert.equal(state.status, 'done');
  assert.equal(host.delegations.length, 6);
  const secondPlanner = host.delegations[3].request.prompt[0].text;
  assert.match(secondPlanner, /iteration-1\/plan\.md/, "the Planner must be told the previous document's path");
  assert.match(secondPlanner, /iteration-1\/evidence\.md/, "the Planner must be told the previous evidence path");
  assert.match(secondPlanner, /completed child-2/, "the Planner must see the previous Developer summary");
  assert.match(secondPlanner, /Iteration: 2 of 2/);

  const firstPlanner = host.delegations[0].request.prompt[0].text;
  assert.match(firstPlanner, /not produced yet/, 'the first iteration has nothing carried over');

  engine.dispose();
});

test('the configured recursion budget becomes the ABSOLUTE depth cap a role is started with', async () => {
  // Regression: the engine used to forward `childMaxDepth` verbatim as
  // `request.maxDepth`, but that field caps the child's own absolute depth and
  // a delegated role is always at depth 1. With the default budget of 0 the
  // service therefore refused the Planner of every run with
  // "subagent depth 1 exceeds maxDepth 0", so no iteration could ever start.
  const nested = project();

  {
    const { engine, host } = makeEngine({ projectDir: nested });
    const state = engine.start({ sessionId: 'session-parent', goal: 'Build the tool.', iterations: 1 });
    await settled(state);
    assert.equal(state.status, 'done', 'the default budget of 0 must still admit the three roles');
    assert.equal(state.error, null);
    assert.equal(host.delegations.length, 3);
    for (const spec of host.delegations) {
      assert.equal(spec.request.maxDepth, 1, 'no extra levels granted: the cap is the role itself');
    }
    engine.dispose();
  }

  {
    const { engine, host } = makeEngine({ projectDir: nested, overrides: { childMaxDepth: 2 } });
    const state = engine.start({ sessionId: 'session-parent', goal: 'Build the tool.', iterations: 1 });
    await settled(state);
    assert.equal(state.status, 'done');
    for (const spec of host.delegations) {
      assert.equal(spec.request.maxDepth, 3, 'two extra levels on top of the role itself');
    }
    engine.dispose();
  }

  // A run started from a session that is itself a subagent must count from that
  // session's depth, not assume the parent sits at the root.
  {
    const { engine, host } = makeEngine({ projectDir: nested, overrides: { childMaxDepth: 0 } });
    host.parent.session = { header: { delegationDepth: 2 } };
    const state = engine.start({ sessionId: 'session-parent', goal: 'Build the tool.', iterations: 1 });
    await settled(state);
    assert.equal(state.status, 'done');
    for (const spec of host.delegations) {
      assert.equal(spec.request.maxDepth, 3, 'the role child sits at depth 3, so the cap is 3');
    }
    engine.dispose();
  }
});

test('stopping a run cancels the current role and skips the rest', async () => {
  const projectDir = project();
  const { engine, host } = makeEngine({ projectDir, behavior: 'never', overrides: { defaultIterations: 3 } });

  const state = engine.start({ sessionId: 'session-parent', goal: 'Long job.', iterations: 3 });
  assert.equal(host.delegations.length, 1, 'the first role starts immediately');
  assert.equal(state.phase, 'planner');

  const outcome = engine.stop({ sessionId: 'session-parent' });
  assert.equal(outcome.ok, true);
  await settled(state);

  assert.equal(state.status, 'stopped');
  assert.equal(host.delegations.length, 1, 'no further role may be delegated after a stop');
  assert.equal(state.history.length, 1);
  assert.deepEqual(
    state.history[0].phases.map((phase) => phase.status),
    ['skipped', 'skipped', 'skipped'],
  );
  assert.match(state.history[0].phases[0].reason, /stopped while this role was running/);
  assert.match(state.history[0].phases[1].reason, /stopped before this role ran/);
  assert.equal(host.disposed.length, 1, 'the interrupted role must be released');
  assert.equal(engine.stop({ sessionId: 'session-parent' }).ok, false, 'stopping a finished run is refused');

  engine.dispose();
});

test('a Planner that fails stops the run instead of developing without a document', async () => {
  const projectDir = project();
  const { engine, host } = makeEngine({ projectDir, behavior: 'planner-error', overrides: { defaultIterations: 2 } });

  const state = engine.start({ sessionId: 'session-parent', goal: 'Doomed.', iterations: 2 });
  await settled(state);

  assert.equal(state.status, 'error');
  assert.match(state.error, /Iteration 1 could not start/);
  assert.equal(host.delegations.length, 1, 'the Developer must not run without a development document');
  assert.equal(state.history[0].phases[0].status, 'failed');

  engine.dispose();
});

test('a role that outlives its wall-clock ceiling fails its phase and leaves the run usable', async () => {
  const projectDir = project();
  const host = makeHost('never');
  const engine = createEngine({
    ctx: host.ctx,
    config: {
      showPanel: true,
      stateDir: '',
      defaultIterations: 1,
      phaseTimeoutSeconds: 1,
      childMaxDepth: 0,
    },
    fallbackProjectDirectory: () => projectDir,
  });

  const state = engine.start({ sessionId: 'session-parent', goal: 'Too slow.', iterations: 1 });
  await settled(state, 10000);

  assert.equal(state.history[0].phases[0].status, 'failed');
  assert.match(state.history[0].phases[0].reason, /wall-clock ceiling/);
  assert.equal(state.status, 'error', 'a timed-out Planner stops the run');

  engine.dispose();
});

test('input validation refuses an empty goal, a bad budget, and a concurrent run', async () => {
  const projectDir = project();
  const { engine } = makeEngine({ projectDir, behavior: 'never' });

  assert.throws(() => engine.start({ sessionId: 's', goal: '   ', iterations: 1 }), /requirements text is empty/);
  assert.throws(() => engine.start({ sessionId: 's', goal: 'x', iterations: 0 }), /whole number from 1/);
  assert.throws(() => engine.start({ sessionId: 's', goal: 'x', iterations: MAX_ITERATIONS + 1 }), /whole number from 1/);

  const state = engine.start({ sessionId: 's', goal: 'first', iterations: 1 });
  assert.throws(() => engine.start({ sessionId: 's', goal: 'second', iterations: 1 }), /already active in this session/);

  engine.stop({ sessionId: 's' });
  await settled(state);

  engine.dispose();
});

/**
 * Build a fake `connection` service that collects the panel's routes.
 */
function makePanelHost() {
  const routes = new Map();
  const ctx = {
    inject: (_services, callback) => {
      callback({
        connection: {
          fetch: {
            register: (route) => {
              routes.set(route.path, route);
              return async () => {};
            },
          },
        },
      });
    },
  };
  return { ctx, routes };
}

/**
 * Dispatch one request through a registered route.
 * @param routes - the collected routes.
 * @param method - the HTTP method.
 * @param path - the route path, with any query string.
 * @param body - the JSON body, when the method carries one.
 */
async function dispatch(routes, method, path, body) {
  const [pathname, query] = path.split('?');
  const route = routes.get(pathname);
  assert.ok(route, `no route registered for ${pathname}`);
  assert.ok(route.methods.includes(method), `${pathname} must accept ${method}`);
  const url = new URL(`http://127.0.0.1${pathname}${query === undefined ? '' : `?${query}`}`);
  const request = new Request(url, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return route.fetch(request);
}

test('the panel routes expose the defaults, admit a run, and report conflicts', async () => {
  const projectDir = project();
  const { engine } = makeEngine({ projectDir, behavior: 'never' });
  const panel = makePanelHost();
  registerPanelRoutes(panel.ctx, engine, true);

  assert.equal(panel.routes.size, 4, 'the panel must register config, state, start, and stop');

  const config = await (await dispatch(panel.routes, 'GET', '/api/plugins/hoh-harness-of-harness/config')).json();
  assert.equal(config.enabled, true);
  assert.equal(config.defaults.projectDir, projectDir);
  assert.equal(config.defaults.iterations, 1);

  const empty = await dispatch(panel.routes, 'POST', '/api/plugins/hoh-harness-of-harness/start', {
    sessionId: 'session-parent',
    goal: '',
    iterations: 1,
  });
  assert.equal(empty.status, 400, 'an empty goal is a client error');
  assert.match((await empty.json()).error, /requirements text is empty/);

  const started = await dispatch(panel.routes, 'POST', '/api/plugins/hoh-harness-of-harness/start', {
    sessionId: 'session-parent',
    goal: 'Panel-driven run.',
    projectDir,
    iterations: 1,
  });
  assert.equal(started.status, 200);
  const admitted = (await started.json()).run;
  assert.equal(admitted.status, 'running');

  const conflict = await dispatch(panel.routes, 'POST', '/api/plugins/hoh-harness-of-harness/start', {
    sessionId: 'session-parent',
    goal: 'Second.',
    projectDir,
    iterations: 1,
  });
  assert.equal(conflict.status, 409, 'a concurrent run in one session is a conflict');

  const state = await (
    await dispatch(panel.routes, 'GET', '/api/plugins/hoh-harness-of-harness/state?session=session-parent')
  ).json();
  assert.equal(state.run.id, admitted.id);
  assert.equal(state.run.goal, 'Panel-driven run.');
  assert.equal(state.defaults.iterations, 1);

  const stopped = await dispatch(panel.routes, 'POST', '/api/plugins/hoh-harness-of-harness/stop', {
    sessionId: 'session-parent',
  });
  assert.equal(stopped.status, 200);
  assert.equal((await stopped.json()).ok, true);

  const missing = await dispatch(panel.routes, 'GET', '/api/plugins/hoh-harness-of-harness/state?session=other');
  assert.equal((await missing.json()).run, null, 'a session with no run reads null');

  engine.dispose();
});

test('a panel disabled by configuration still registers its routes, and reports itself off', async () => {
  const projectDir = project();
  const { engine } = makeEngine({ projectDir, behavior: 'never' });
  const panel = makePanelHost();
  registerPanelRoutes(panel.ctx, engine, false);

  const config = await (await dispatch(panel.routes, 'GET', '/api/plugins/hoh-harness-of-harness/config')).json();
  assert.equal(config.enabled, false);

  engine.dispose();
});