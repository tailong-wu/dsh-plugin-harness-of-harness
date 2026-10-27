/**
 * Tests for the Harness of Harness mode surface: the service the Host half
 * provides and the three tools a session in HoH mode calls.
 *
 * They use a recording stand-in for the run service, so the tool contract —
 * parameter rules, session routing, result shape — is checked without a live
 * harness.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { apply, hohTools, inject as toolsInject, name as toolsName } from '../tools.js';
import { SERVICE_KEY, createModeService, summariseRun } from '../src/service.js';

/** A run state shaped like the engine's, used to check the projection. */
function sampleState(overrides = {}) {
  return {
    id: 'hoh-20261023-101010-abcdef',
    sessionId: 'session-1',
    status: 'running',
    goal: 'Grow the tool.',
    projectDir: '/tmp/project',
    iterations: 2,
    currentIteration: 1,
    phase: 'developer',
    startedAt: 1000,
    endedAt: null,
    error: null,
    runDir: '/tmp/project/.hoh/runs/hoh-20261023-101010-abcdef',
    history: [
      {
        index: 1,
        status: 'running',
        startedAt: 1000,
        endedAt: null,
        phases: [
          {
            role: 'planner',
            status: 'done',
            startedAt: 1000,
            endedAt: 1200,
            childId: 'child-1',
            summary: 'priorities set',
            reason: null,
          },
          {
            role: 'developer',
            status: 'running',
            startedAt: 1200,
            endedAt: null,
            childId: 'child-2',
            summary: '',
            reason: null,
          },
        ],
      },
    ],
    log: [],
    ...overrides,
  };
}

/** A run service that records every call. */
function makeRecordingService(state = sampleState()) {
  const calls = [];
  return {
    calls,
    state,
    roles: ['planner', 'developer', 'tester'],
    bounds: { min: 1, max: 50 },
    start(request) {
      calls.push({ method: 'start', request });
      return state;
    },
    stop(request) {
      calls.push({ method: 'stop', request });
      return { ok: true, run: state };
    },
    read(sessionId) {
      calls.push({ method: 'read', sessionId });
      return state;
    },
    latest() {
      calls.push({ method: 'latest' });
      return state;
    },
    defaults() {
      calls.push({ method: 'defaults' });
      return { projectDir: '/tmp/project', iterations: 3 };
    },
  };
}

/** Run one tool as a given session would. */
function run(tool, args, agentId = 'session-1') {
  return tool.execute(args, { agent: agentId === undefined ? undefined : { id: agentId }, signal: new AbortController().signal });
}

test('the mode registers exactly the three documented tools', () => {
  const service = makeRecordingService();
  const tools = hohTools(service);

  assert.deepEqual(tools.map((tool) => tool.name), ['hoh_start', 'hoh_status', 'hoh_stop']);
  for (const tool of tools) {
    assert.ok(tool.description.length > 40, `${tool.name} needs a real description`);
    assert.equal(typeof tool.output.schema, 'object');
    assert.ok(tool.output.schema !== null, `${tool.name} must declare a canonical output schema`);
    assert.equal(typeof tool.execute, 'function');
    assert.equal(typeof tool.output.render, 'function');
  }

  // Only the read-only tool may join a parallel group: starting and stopping a
  // run both mutate the session's run slot.
  const [start, status, stop] = tools;
  assert.equal(start.isConcurrencySafe, undefined);
  assert.equal(stop.isConcurrencySafe, undefined);
  assert.equal(status.isConcurrencySafe({}), true);

  // The goal is the one required parameter; the other two fall back to the
  // engine's own defaults.
  assert.deepEqual(start.parameters.required, ['goal']);
  assert.deepEqual(Object.keys(start.parameters.properties), ['goal', 'project_dir', 'iterations']);
  assert.deepEqual(status.parameters.properties, {});
  assert.deepEqual(stop.parameters.properties, {});

  assert.equal(toolsName, 'harness-of-harness-tools');
  assert.deepEqual(toolsInject, ['tools', SERVICE_KEY]);
});

test('apply registers every mode tool on the preset-scoped registry', () => {
  const registered = [];
  const ctx = {
    tools: {
      register: (definition) => {
        registered.push(definition);
        return () => {};
      },
    },
    [SERVICE_KEY]: makeRecordingService(),
  };

  apply(ctx);

  assert.deepEqual(registered.map((tool) => tool.name), ['hoh_start', 'hoh_status', 'hoh_stop']);
});

test('hoh_start forwards the goal, directory, and budget for the calling session', async () => {
  const service = makeRecordingService();
  const [start] = hohTools(service);

  const value = await run(start, { goal: 'Grow the tool.', project_dir: '/tmp/other', iterations: 4 });

  assert.deepEqual(service.calls[0], {
    method: 'start',
    request: { sessionId: 'session-1', goal: 'Grow the tool.', projectDir: '/tmp/other', iterations: 4 },
  });
  assert.equal(value.ok, true);
  assert.equal(value.run.run_id, 'hoh-20261023-101010-abcdef');
  assert.equal(value.run.phase, 'developer');
  assert.match(value.note, /background/);
});

test('hoh_start omits an unspecified directory so the engine default applies', async () => {
  const service = makeRecordingService();
  const [start] = hohTools(service);

  await run(start, { goal: 'Only the goal.' });

  assert.deepEqual(service.calls[0].request, {
    sessionId: 'session-1',
    goal: 'Only the goal.',
    projectDir: undefined,
    iterations: undefined,
  });
});

test('hoh_status reports the run in flight and the defaults when none exists', async () => {
  const service = makeRecordingService();
  const status = hohTools(service)[1];

  const value = await run(status, {});
  assert.deepEqual(service.calls[0], { method: 'read', sessionId: 'session-1' });
  assert.equal(value.run.status, 'running');
  assert.equal(value.run.current_iteration.roles.length, 2);
  assert.equal(value.run.current_iteration.roles[1].role, 'developer');
  assert.equal(value.run.current_iteration.roles[1].status, 'running');
  assert.equal(typeof value.run.current_iteration.roles[1].elapsed_ms, 'number');
  assert.deepEqual(value.run.completed_iterations, []);

  const empty = makeRecordingService(null);
  const emptyStatus = hohTools(empty)[1];
  const emptyValue = await run(emptyStatus, {});
  assert.equal(emptyValue.run, null);
  assert.match(emptyValue.message, /No Harness of Harness run/);
  assert.deepEqual(emptyValue.defaults, { projectDir: '/tmp/project', iterations: 3 });
});

test('hoh_stop reports both a stopped run and an idle session', async () => {
  const service = makeRecordingService();
  const stop = hohTools(service)[2];

  const value = await run(stop, {});
  assert.deepEqual(service.calls[0], { method: 'stop', request: { sessionId: 'session-1' } });
  assert.equal(value.ok, true);
  assert.match(value.message, /remaining iterations are skipped/);

  const idle = {
    ...makeRecordingService(),
    stop: () => ({ ok: false, message: 'No Harness of Harness run is active in this session.' }),
  };
  const idleValue = await run(hohTools(idle)[2], {});
  assert.equal(idleValue.ok, false);
  assert.equal(idleValue.run, null);
  assert.match(idleValue.message, /No Harness of Harness run/);
});

test('a refused start surfaces as a tool failure rather than a false success', async () => {
  const refusing = {
    ...makeRecordingService(),
    start: () => {
      throw new Error('A Harness of Harness run is already active in this session.');
    },
  };
  const [start] = hohTools(refusing);

  await assert.rejects(() => run(start, { goal: 'Again.' }), /already active/);
});

test('the mode service forwards the engine and exposes the loop vocabulary', () => {
  const calls = [];
  const engine = {
    start: (request) => {
      calls.push(['start', request]);
      return sampleState();
    },
    stop: (request) => {
      calls.push(['stop', request]);
      return { ok: true, run: sampleState() };
    },
    read: (sessionId) => {
      calls.push(['read', sessionId]);
      return null;
    },
    latest: () => {
      calls.push(['latest']);
      return sampleState();
    },
    defaults: () => {
      calls.push(['defaults']);
      return { projectDir: '/tmp/project', iterations: 3 };
    },
  };

  const service = createModeService(engine);
  assert.deepEqual(service.roles, ['planner', 'developer', 'tester']);
  assert.deepEqual(service.bounds, { min: 1, max: 50 });

  const request = { sessionId: 'session-1', goal: 'g' };
  assert.equal(service.start(request).id, 'hoh-20261023-101010-abcdef');
  assert.equal(service.stop(request).ok, true);
  assert.equal(service.read('session-1'), null);
  assert.equal(service.latest().status, 'running');
  assert.deepEqual(service.defaults(), { projectDir: '/tmp/project', iterations: 3 });
  assert.deepEqual(calls.map(([method]) => method), ['start', 'stop', 'read', 'latest', 'defaults']);
});

test('summariseRun bounds what a model reads back', () => {
  const summary = summariseRun(sampleState());

  assert.deepEqual(Object.keys(summary), [
    'run_id',
    'status',
    'goal',
    'project_dir',
    'run_dir',
    'iteration',
    'iterations',
    'phase',
    'current_iteration',
    'completed_iterations',
    'error',
  ]);
  assert.equal(summary.iterations, 2);
  assert.equal(summary.current_iteration.index, 1);
  assert.equal(summariseRun(null), null);
  assert.equal(summariseRun(undefined), null);

  const finished = summariseRun(
    sampleState({
      status: 'done',
      history: [{ ...sampleState().history[0], status: 'done' }],
    }),
  );
  assert.deepEqual(finished.completed_iterations, [
    { index: 1, status: 'done', roles: ['planner:done', 'developer:running'] },
  ]);
});