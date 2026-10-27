#!/usr/bin/env node
/**
 * Credential-free smoke test of the Host half.
 *
 * It imports every Host module in Node, checks the plugin's export contract,
 * and keeps the naming declaration, the bundle patch, and the route constants
 * from drifting apart. It starts no run: delegation needs a live harness.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import yaml from 'js-yaml';

const root = new URL('..', import.meta.url);

/**
 * The Loader's YAML dialect adds the `!!js` expression tag, which a plain YAML
 * parser rejects; treating it as an opaque scalar is enough to check the
 * surrounding document's structure.
 */
const patchSchema = yaml.DEFAULT_SCHEMA.extend([
  new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (value) => value }),
]);

/**
 * Flatten a preset's plugin rows, descending into `cordis:group` children.
 * @param rows - the row list of a preset, or of a group.
 * @returns every row, groups included, in declaration order.
 */
function flattenRows(rows) {
  const flat = [];
  for (const row of rows ?? []) {
    flat.push(row);
    if (Array.isArray(row.config)) flat.push(...flattenRows(row.config));
  }
  return flat;
}

/** Fail loudly with a readable reason. */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Require a call to reject.
 * @param operation - the operation that must throw.
 * @param message - the reason to report.
 */
function assertThrows(operation, message) {
  let threw = false;
  try {
    operation();
  } catch {
    threw = true;
  }
  assert(threw, message);
}

const contract = await import(new URL('src/contract.js', root).href);
const prompts = await import(new URL('src/prompts.js', root).href);
const config = await import(new URL('src/config.js', root).href);
const engineModule = await import(new URL('src/engine.js', root).href);
const serviceModule = await import(new URL('src/service.js', root).href);
const toolsModule = await import(new URL('tools.js', root).href);
const plugin = await import(new URL('index.js', root).href);

assert(plugin.name === 'harness-of-harness', `unexpected plugin name: ${String(plugin.name)}`);
assert(Array.isArray(plugin.inject), 'the plugin must declare its injected services');
assert(plugin.inject.includes('agents') && plugin.inject.includes('subagents'), 'the loop needs agents and subagents');
assert(typeof plugin.apply === 'function', 'the plugin must export apply()');
assert(plugin.Config !== undefined, 'the plugin must export its Config schema');
assert(typeof engineModule.createEngine === 'function', 'the engine factory must be exported');

const defaults = config.resolveConfig({});
assert(defaults.showPanel === true, 'the panel is on by default');
assert(defaults.defaultIterations === 3, 'the default iteration budget is 3');
assert(config.resolveConfig({ defaultIterations: 2 }).defaultIterations === 2, 'defaultIterations must be read');
assertThrows(() => config.resolveConfig({ defaultIterations: 0 }), 'a zero iteration budget must be refused');
assertThrows(() => config.resolveConfig({ childMaxDepth: -1 }), 'a negative delegation depth must be refused');

for (const role of contract.ROLES) {
  const prompt = prompts.rolePrompt(role, {
    iteration: 2,
    iterations: 4,
    goal: 'Build a thing.',
    projectDir: '/tmp/example',
    runDir: '/tmp/example/.hoh/runs/run-1',
    planPath: '/tmp/example/.hoh/runs/run-1/iteration-2/plan.md',
    evidencePath: '/tmp/example/.hoh/runs/run-1/iteration-2/evidence.md',
    previous: undefined,
  });
  assert(prompt.includes('/tmp/example/.hoh/runs/run-1'), `${role} prompt must name the run's artifact paths`);
  assert(prompt.includes('iteration 2 of 4') || prompt.includes('Iteration: 2 of 4'), `${role} prompt must state the iteration`);
}
assertThrows(() => prompts.rolePrompt('referee', {}), 'an unknown role must be refused');

const naming = JSON.parse(readFileSync(fileURLToPath(new URL('dsh-plugin.naming.json', root)), 'utf8'));
const declaredRoutes = new Set((naming.names.routes ?? []).map((route) => route.path));
for (const [key, path] of Object.entries({
  CONFIG_PATH: contract.CONFIG_PATH,
  STATE_PATH: contract.STATE_PATH,
  START_PATH: contract.START_PATH,
  STOP_PATH: contract.STOP_PATH,
})) {
  assert(path.startsWith(contract.ROUTE_PREFIX), `${key} must sit under the plugin's route prefix`);
  assert(declaredRoutes.has(path), `${key} (${path}) is missing from dsh-plugin.naming.json`);
}
assert(
  naming.names.loaderIds.includes('hoh-harness-of-harness'),
  'dsh-plugin.naming.json must declare the loader row id',
);

// The mode surface: the service the Host provides and the tools a preset
// session calls must stay in step with what the naming declaration claims.
assert(
  naming.names.services.includes(serviceModule.SERVICE_KEY),
  `${serviceModule.SERVICE_KEY} is missing from dsh-plugin.naming.json services`,
);
const modeTools = toolsModule.hohTools({ start: () => {}, stop: () => {}, read: () => null, defaults: () => ({}) });
assert(
  JSON.stringify(modeTools.map((tool) => tool.name)) === JSON.stringify(naming.names.tools),
  'dsh-plugin.naming.json tools must list exactly the tools the mode registers',
);
assert(toolsModule.apply !== undefined, 'the tools row must export apply()');
assert(
  toolsModule.inject.includes(serviceModule.SERVICE_KEY),
  'the tools row must inject the mode service it consumes',
);
assert(serviceModule.createModeService !== undefined, 'the mode service factory must be exported');
assert(serviceModule.summariseRun(null) === null, 'summariseRun must accept an absent run');

// The patch is parsed, not grepped: an indentation or quoting slip here is what
// stops the whole bundle from loading, and a substring search cannot see it.
const patchText = readFileSync(fileURLToPath(new URL('cordis.patch.yml', root)), 'utf8');
const patchDoc = yaml.load(patchText, { schema: patchSchema });
assert(Array.isArray(patchDoc), 'the bundle patch must be a patch-layer array');
const inserted = patchDoc[0]?.insert;
assert(Array.isArray(inserted), 'the bundle patch must insert its rows');
const rowsById = new Map(inserted.map((row) => [row.id, row]));
for (const id of naming.names.loaderIds) {
  assert(rowsById.has(id), `dsh-plugin.naming.json declares loader id ${id}, which the patch does not insert`);
}
for (const id of rowsById.keys()) {
  assert(naming.names.loaderIds.includes(id), `the patch inserts ${id}, which the naming declaration omits`);
}

const hostRow = rowsById.get('hoh-harness-of-harness');
assert(hostRow.name === 'dsh-plugin-harness-of-harness', 'the Host row must name this package');
assert(hostRow.config.showPanel === true, 'the panel is on by default');

const preset = rowsById.get('preset-harness-of-harness');
assert(preset.name === '@deepseek-ai/dsh-agent-preset', 'the preset row must use the preset declaration plugin');
assert(preset.config.id === 'harness-of-harness', 'the preset must declare its identity');
assert(preset.config.order === 5, 'the preset must not collide with the shipped roster orders 1-4');
assert(typeof preset.config.name === 'string' && preset.config.name !== '', 'the preset needs a roster name');
assert(
  typeof preset.config.description === 'string' && preset.config.description.length > 20,
  'the preset needs a roster description',
);
assert(Array.isArray(preset.config.plugins) && preset.config.plugins.length > 10, 'the preset needs a real plugin list');

const presetRows = flattenRows(preset.config.plugins);
const pluginIds = presetRows.map((row) => row.id);
assert(new Set(pluginIds).size === pluginIds.length, 'the preset must not repeat a plugin row id');
for (const row of presetRows) {
  assert(typeof row.id === 'string' && row.id !== '', 'every preset row needs an id');
  assert(typeof row.name === 'string' && row.name !== '', `preset row ${row.id} needs a plugin name`);
}

// Every working tool the mode needs, so a preset edit cannot silently drop one.
const mounted = presetRows.map((row) => row.name);
for (const required of [
  '@deepseek-ai/dsh-persona',
  '@deepseek-ai/dsh-agent-instructions',
  '@deepseek-ai/dsh-time-context',
  '@deepseek-ai/dsh-tool-bash',
  '@deepseek-ai/dsh-tool-pwsh',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-tool-jobs',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-command-goal',
  '@deepseek-ai/dsh-tool-goal',
  'dsh-plugin-harness-of-harness/tools',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-command-compact',
  '@deepseek-ai/dsh-compaction-tool-result-pruner',
  '@deepseek-ai/dsh-tool-subagent',
  '@deepseek-ai/dsh-tool-subagent-control',
  '@deepseek-ai/dsh-workflow-ptc',
  '@deepseek-ai/dsh-tool-workflow',
  '@deepseek-ai/dsh-tool-ask-user',
  '@deepseek-ai/dsh-tool-todo',
  '@deepseek-ai/dsh-tool-web',
  '@deepseek-ai/dsh-tool-present',
]) {
  assert(mounted.includes(required), `the HoH preset must mount ${required}`);
}
assert(
  presetRows.find((row) => row.id === 'tool-hoh').name === 'dsh-plugin-harness-of-harness/tools',
  'the mode tools row must resolve this bundle\'s subpath export',
);
assert(
  presetRows.find((row) => row.id === 'tool-bash').disabled === "process.platform === 'win32'",
  'the bash row must keep its platform guard',
);

// The persona is the mode's only always-on statement of the workflow.
const persona = presetRows.find((row) => row.id === 'persona');
for (const role of ['Project Planner', 'Developer', 'QA Tester', 'hoh_start', 'hoh_status', 'hoh_stop']) {
  assert(persona.config.prefix.includes(role), `the HoH persona must name ${role}`);
}
assert(mounted.includes('@deepseek-ai/dsh-tool-schedule') === false, 'HoH mode intentionally omits the schedule tools');

// The read-only role composition: the Planner and QA Tester are delegated under
// it, so its file tool must not be able to write.
const readonlyRow = rowsById.get('preset-hoh-readonly');
assert(readonlyRow !== undefined, 'the bundle must declare the read-only role preset');
assert(readonlyRow.name === '@deepseek-ai/dsh-agent-preset', 'the read-only role preset must use the preset plugin');
assert(readonlyRow.config.id === 'hoh-readonly', 'the read-only role preset must declare its identity');
assert(readonlyRow.config.order === 6, 'the read-only role preset must not collide with the roster');
const readonlyRows = flattenRows(readonlyRow.config.plugins);
const readonlyFs = readonlyRows.find((row) => row.name === '@deepseek-ai/dsh-tool-fs');
assert(readonlyFs !== undefined, 'the read-only role preset must mount the file tool');
assert(readonlyFs.config?.write === false, 'the read-only role preset must disable file writing');
assert(readonlyFs.config?.edit === false, 'the read-only role preset must disable file editing');
assert(readonlyFs.config?.read === true, 'the read-only role preset must keep file reading');
assert(
  readonlyRows.every((row) => row.name !== 'dsh-plugin-harness-of-harness/tools'),
  'the read-only role preset must not hand the HoH control tools to a role',
);
assert(contract.READ_ONLY_PRESET === readonlyRow.config.id, 'the code constant and the declared read-only preset id must agree');
assert(
  contract.ROLE_PRESETS.planner === readonlyRow.config.id && contract.ROLE_PRESETS.tester === readonlyRow.config.id,
  'both read-only roles must be delegated under the read-only preset',
);
assert(
  contract.ROLE_PRESETS.developer === null,
  'the Developer must inherit the session preset, because it has to write the artifact',
);

// A `@deepseek-ai/dsh-tool-todo` row whose schema marks `allowParallelInProgress`
// required has no usable default, so a row that omits it aborts the whole role
// turn at activation time — before the role can do any work. Both presets mount
// the row, so both must configure it.
for (const [label, rows] of [
  ['the HoH preset', presetRows],
  ['the read-only role preset', readonlyRows],
]) {
  for (const row of rows.filter((candidate) => candidate.name === '@deepseek-ai/dsh-tool-todo')) {
    assert(
      typeof row.config?.allowParallelInProgress === 'boolean',
      `${label} mounts ${row.id} without the required allowParallelInProgress config`,
    );
  }
}

const manifest = JSON.parse(readFileSync(fileURLToPath(new URL('package.json', root)), 'utf8'));
assert(manifest.dsh?.bundle?.patch === './cordis.patch.yml', 'the manifest must point at the bundle patch');
assert(manifest.exports['./client'] !== undefined, 'the manifest must export the client bundle');
assert(manifest.exports['./icon'] !== undefined, 'the manifest must export the icon');
assert(manifest.exports['./tools'] === './tools.js', 'the manifest must export the mode tools subpath');
assert(manifest.files.includes('tools.js'), 'the packed files must include the mode tools module');
assert(
  typeof manifest.dependencies?.['@deepseek-ai/dsh-tools'] === 'string',
  'the mode tools module imports @deepseek-ai/dsh-tools, so it must be a declared dependency',
);

console.log(
  'smoke: host contract, config, prompts, mode service, mode tools, parsed preset, naming, patch, and manifest all check out',
);