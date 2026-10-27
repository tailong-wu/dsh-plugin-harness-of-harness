/**
 * Tests for the upstream-alignment mechanisms added after the first release:
 * the deterministic role machine, `repair-then-next`, the audit records, and
 * the read-only role delegation.
 *
 * Each block names the upstream HoH behavior it checks, so a regression points
 * at the mechanism rather than at "a test".
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { EVIDENCE_SCHEMA, READ_ONLY_PRESET } from '../src/contract.js';
import { createEngine } from '../src/engine.js';
import { RECEIPT_FILE, REPRODUCIBILITY_FILE, configHash, gitRevision } from '../src/records.js';
import { allowedAfter, createRoleMachine } from '../src/transitions.js';

/** The project directories this suite created. */
const scratch = [];

/** Make one throwaway project directory. */
function project() {
  const dir = mkdtempSync(join(tmpdir(), 'hoh-align-'));
  scratch.push(dir);
  return dir;
}

after(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** Busy-wait without a real timer dependency. */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build a fake host whose QA Tester answers from a verdict script.
 * @param verdicts - one structured verdict per tester call; a missing entry means "no verdict".
 */
function makeHost(verdicts = []) {
  const calls = [];
  const parent = { id: 'session-parent' };

  const subagents = {
    list: () => ['spawn'],
    getProvider: () => ({ capabilities: { agentPreset: true } }),
    startActivation: async (spec) => {
      const name = spec.label;
      calls.push(spec);
      const isTester = /QA Tester/.test(name);
      const index = calls.filter((call) => /QA Tester/.test(call.label)).length - 1;
      const structured = isTester ? verdicts[index] : undefined;
      return {
        childId: `child-${calls.length}`,
        result: Promise.resolve({
          output: [{ type: 'text', text: `${name} finished` }],
          stopReason: 'completed',
          ...(structured === undefined ? {} : { structured }),
        }),
        dispose: async () => {},
      };
    },
  };

  return {
    ctx: {
      agents: { get: (id) => (id === 'session-parent' ? parent : undefined), roots: () => [parent] },
      subagents,
    },
    calls,
  };
}

/** Build an engine over a fake host. */
function makeEngine({ projectDir, verdicts = [], overrides = {} } = {}) {
  const host = makeHost(verdicts);
  const engine = createEngine({
    ctx: host.ctx,
    config: {
      showPanel: true,
      stateDir: '',
      defaultIterations: 1,
      phaseTimeoutSeconds: 0,
      childMaxDepth: 0,
      testerPolicy: 'repair-then-next',
      maxInnerRepairs: 2,
      enforceRolePresets: true,
      ...overrides,
    },
    fallbackProjectDirectory: () => projectDir,
    pluginVersion: '9.9.9-test',
  });
  return { engine, host };
}

/** Wait until a run leaves the running state. */
async function settled(state, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.status !== 'running' && state.status !== 'stopping') return state;
    await delay(10);
  }
  throw new Error(`run did not settle within ${timeoutMs}ms (status ${state.status})`);
}

test('the role machine admits only the upstream transition graph', () => {
  assert.deepEqual(allowedAfter(undefined), ['planner'], 'an iteration must open with the Planner');
  assert.deepEqual(allowedAfter('planner'), ['developer']);
  assert.deepEqual(allowedAfter('developer'), ['tester']);
  assert.deepEqual(allowedAfter('tester'), ['developer', 'tester'], 'a failing Tester hands back to the Developer');

  const machine = createRoleMachine();
  machine.begin(1);
  assert.throws(() => machine.record('developer'), /invalid role transition/, 'Developer cannot open an iteration');
  machine.record('planner');
  assert.throws(() => machine.record('tester'), /invalid role transition/, 'Planner cannot jump to the Tester');
  machine.record('developer');
  machine.record('tester');
  machine.record('developer');
  machine.record('tester');
  assert.equal(machine.events.length, 5);
  assert.deepEqual(machine.events.map((event) => event.role), [
    'planner',
    'developer',
    'tester',
    'developer',
    'tester',
  ]);
  machine.finish();
  assert.equal(machine.activeIteration, null);
});

test('the role machine refuses an iteration whose Developer never ran', () => {
  const machine = createRoleMachine();
  machine.begin(1);
  machine.record('planner');
  assert.throws(() => machine.finish(), /cannot finish before the Developer stage/);
});

test('repair-then-next runs bounded Developer repairs inside one iteration', async () => {
  const projectDir = project();
  const failing = { passed: false, verified: [], gaps: [{ gap: 'the button does nothing', severity: 'major' }] };
  const passing = { passed: true, verified: [{ claim: 'button works', evidence: 'clicked it' }], gaps: [] };
  const { engine, host } = makeEngine({ projectDir, verdicts: [failing, passing] });

  const state = engine.start({ sessionId: 'session-parent', goal: 'Build the thing.', iterations: 1 });
  await settled(state);

  assert.equal(state.status, 'done');
  assert.deepEqual(
    host.calls.map((call) => call.label.replace('HoH ', '').split(' ·')[0]),
    ['Project Planner', 'Developer', 'QA Tester', 'Developer', 'QA Tester'],
  );
  assert.deepEqual(
    state.history[0].phases.map((phase) => `${phase.role}:${phase.round}`),
    ['planner:0', 'developer:0', 'tester:0', 'developer:1', 'tester:1'],
  );
  // The repair turn is told what the Tester found.
  assert.match(host.calls[3].request.prompt[0].text, /the button does nothing/);
  assert.match(host.calls[3].label, /repair 1/);

  const evidence = JSON.parse(readFileSync(join(state.runDir, 'iteration-1', 'evidence.json'), 'utf8'));
  assert.equal(evidence.rounds.length, 2);
  assert.equal(evidence.rounds[0].verdict.passed, false);
  assert.equal(evidence.rounds[1].verdict.passed, true);

  engine.dispose();
});

test('repair rounds stop at the configured ceiling', async () => {
  const projectDir = project();
  const failing = { passed: false, verified: [], gaps: [{ gap: 'still broken', severity: 'blocker' }] };
  const { engine, host } = makeEngine({ projectDir, verdicts: [failing, failing, failing], overrides: { maxInnerRepairs: 1 } });

  const state = engine.start({ sessionId: 'session-parent', goal: 'Never passes.', iterations: 1 });
  await settled(state);

  // planner + (developer, tester) + one repair pair.
  assert.equal(host.calls.length, 5);
  assert.equal(state.history[0].phases.filter((phase) => phase.role === 'developer').length, 2);
  assert.equal(state.status, 'done');

  engine.dispose();
});

test('testerPolicy next-loop defers gaps to the next iteration instead of repairing', async () => {
  const projectDir = project();
  const failing = { passed: false, verified: [], gaps: [{ gap: 'deferred', severity: 'minor' }] };
  const { engine, host } = makeEngine({
    projectDir,
    verdicts: [failing, failing, failing],
    overrides: { testerPolicy: 'next-loop' },
  });

  const state = engine.start({ sessionId: 'session-parent', goal: 'Two iterations.', iterations: 2 });
  await settled(state);

  assert.equal(host.calls.length, 6, 'two iterations of three roles, with no repair');
  assert.equal(state.history.length, 2);

  engine.dispose();
});

test('a run writes the deterministic-host receipt and the reproducibility record', async () => {
  const projectDir = project();
  const { engine } = makeEngine({ projectDir });

  const state = engine.start({ sessionId: 'session-parent', goal: 'Audit me.', iterations: 1 });
  await settled(state);

  const receipt = JSON.parse(readFileSync(join(state.runDir, RECEIPT_FILE), 'utf8'));
  assert.equal(receipt.schema_version, 1);
  assert.equal(receipt.runtime, 'dsh-harness-of-harness');
  assert.equal(receipt.coordination, 'deterministic-host');
  assert.equal(receipt.active_iteration, null);
  assert.equal(receipt.tester_policy, 'repair-then-next');
  assert.deepEqual(receipt.events.map((event) => event.role), ['planner', 'developer', 'tester']);
  assert.deepEqual(receipt.events.map((event) => event.sequence), [1, 2, 3]);
  assert.equal(receipt.events[0].iteration_index, 1);
  assert.equal(typeof receipt.events[0].duration_seconds, 'number');
  assert.equal(receipt.roles.planner.workspace_access, 'read-only');
  assert.equal(receipt.roles.developer.workspace_access, 'read-write');
  assert.equal(receipt.roles.planner.preset, READ_ONLY_PRESET);

  const reproducibility = JSON.parse(readFileSync(join(state.runDir, REPRODUCIBILITY_FILE), 'utf8'));
  assert.equal(reproducibility.plugin.version, '9.9.9-test');
  assert.equal(reproducibility.observed.provider, 'spawn');
  assert.equal(reproducibility.project.dir, projectDir);
  assert.match(reproducibility.config_hash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(reproducibility.roles.tester.preset, READ_ONLY_PRESET);
  assert.equal(reproducibility.roles.developer.model, null, 'an unobservable field is null, not omitted');
  assert.equal(reproducibility.external_evaluator, null, 'this deployment has no external evaluator');

  engine.dispose();
});

test('the read-only roles are delegated under the read-only preset, the Developer is not', async () => {
  const projectDir = project();
  const { engine, host } = makeEngine({ projectDir });

  const state = engine.start({ sessionId: 'session-parent', goal: 'Preset check.', iterations: 1 });
  await settled(state);

  const byRole = Object.fromEntries(
    host.calls.map((call) => [call.label.replace('HoH ', '').split(' ·')[0], call.request]),
  );
  assert.equal(byRole['Project Planner'].agentPreset, READ_ONLY_PRESET);
  assert.equal(byRole['QA Tester'].agentPreset, READ_ONLY_PRESET);
  assert.equal(byRole.Developer.agentPreset, undefined, 'the Developer inherits the session preset');

  // The QA Tester is the only role with a structured output contract.
  assert.deepEqual(byRole['QA Tester'].outputSchema, EVIDENCE_SCHEMA);
  assert.equal(byRole['Project Planner'].outputSchema, undefined);

  engine.dispose();
});

test('enforceRolePresets off keeps every role on the session preset', async () => {
  const projectDir = project();
  const { engine, host } = makeEngine({ projectDir, overrides: { enforceRolePresets: false } });

  const state = engine.start({ sessionId: 'session-parent', goal: 'No role presets.', iterations: 1 });
  await settled(state);

  assert.ok(host.calls.every((call) => call.request.agentPreset === undefined));

  engine.dispose();
});

test('configHash is stable across equal configurations and changes with them', () => {
  assert.equal(configHash({ a: 1, b: 'x' }), configHash({ a: 1, b: 'x' }));
  assert.notEqual(configHash({ a: 1 }), configHash({ a: 2 }));
});

test('gitRevision reports a repository head or null outside one', () => {
  const plain = project();
  assert.equal(gitRevision(plain), null, 'a directory outside git has no revision');
  const here = gitRevision(process.cwd());
  if (here !== null) {
    assert.equal(typeof here.dirty, 'boolean');
    assert.ok(here.head === null || /^[0-9a-f]{7,40}$/.test(here.head));
  }
});
/**
 * Real runs produced a verdict that claimed `passed: true` while listing
 * `blocker` gaps. Both the repair decision and the iteration's completeness
 * must follow the gaps, not the flag alone.
 */
test('a self-contradicting verdict does not count as an acceptance', async () => {
  const projectDir = project();
  const contradictory = {
    passed: true,
    verified: [{ claim: 'page renders', evidence: 'loaded it' }],
    gaps: [{ gap: 'saving loses data', severity: 'blocker' }],
  };
  const honest = { passed: true, verified: [{ claim: 'saving works', evidence: 'round-tripped' }], gaps: [] };
  const { engine, host } = makeEngine({ projectDir, verdicts: [contradictory, honest] });

  const state = engine.start({ sessionId: 'session-parent', goal: 'Contradiction.', iterations: 1 });
  await settled(state);

  assert.equal(host.calls.length, 5, 'a blocking gap must trigger a repair pass despite passed:true');
  assert.deepEqual(
    state.history[0].phases.map((phase) => `${phase.role}:${phase.round}`),
    ['planner:0', 'developer:0', 'tester:0', 'developer:1', 'tester:1'],
  );
  assert.equal(state.history[0].status, 'done', 'the repaired iteration is complete');

  const receipt = JSON.parse(readFileSync(join(state.runDir, RECEIPT_FILE), 'utf8'));
  const first = receipt.events.find((event) => event.role === 'tester' && event.details.round === 0);
  assert.equal(first.details.passed, false, 'the effective verdict is not an acceptance');
  assert.equal(first.details.reported_passed, true, 'what the child claimed is still recorded');
  assert.equal(first.details.blocking_gaps, 1);

  engine.dispose();
});

test('an iteration with an unrepaired blocker is partial, not done', async () => {
  const projectDir = project();
  const contradictory = {
    passed: true,
    verified: [],
    gaps: [{ gap: 'still broken', severity: 'blocker' }],
  };
  const { engine } = makeEngine({ projectDir, verdicts: [contradictory, contradictory, contradictory] });

  const state = engine.start({ sessionId: 'session-parent', goal: 'Never accepted.', iterations: 1 });
  await settled(state);

  assert.equal(state.history[0].status, 'partial', 'a blocker that survived the repair ceiling leaves the iteration partial');
  engine.dispose();
});

test('only a blocker defeats a pass; lower severities are polish', async () => {
  const projectDir = project();
  const polish = {
    passed: true,
    verified: [{ claim: 'ok', evidence: 'ran it' }],
    gaps: [
      { gap: 'contrast below AA', severity: 'medium' },
      { gap: 'spacing', severity: 'low' },
      { gap: 'typo', severity: 'high' },
    ],
  };
  const { engine, host } = makeEngine({ projectDir, verdicts: [polish] });

  const state = engine.start({ sessionId: 'session-parent', goal: 'Polish only.', iterations: 1 });
  await settled(state);

  assert.equal(host.calls.length, 3, 'non-blocking gaps do not trigger a repair');
  assert.equal(state.history[0].status, 'done');
  engine.dispose();
});
