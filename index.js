/**
 * dsh-plugin-harness-of-harness: Harness of Harness mode for DeepSeek Harness.
 *
 * The plugin runs the Harness-of-Harness continual-development loop natively:
 * each iteration delegates three fresh DSH child agents — Project Planner,
 * Developer, QA Tester — into one project workspace and carries the
 * development document and the evidence bundle into the next iteration.
 *
 * Two surfaces start the same run and read the same state:
 *
 * - the right-Sidebar panel, for a person, and
 * - the `hohHarnessOfHarness` service this file provides, which the
 *   preset-scoped `dsh-plugin-harness-of-harness/tools` row turns into
 *   `hoh_start`, `hoh_status`, and `hoh_stop` for a session in HoH mode.
 *
 * Every role turn is an ordinary DSH subagent of the session that started the
 * run, so the children appear in that session's subagent list and are
 * interruptible like any other delegation.
 * @module dsh-plugin-harness-of-harness
 */

import { readFileSync } from 'node:fs';

import { Config, resolveConfig } from './src/config.js';
import { createEngine } from './src/engine.js';
import { registerPanelRoutes } from './src/panel.js';
import { SERVICE_KEY, createModeService } from './src/service.js';

/** Cordis plugin name, used in loader diagnostics and log lines. */
export const name = 'harness-of-harness';

/** Services the plugin needs before it can load. */
export const inject = ['agents', 'subagents'];

/**
 * This package's version, recorded in each run's `reproducibility.json`.
 * A missing or unreadable manifest is not worth failing activation over.
 */
const PLUGIN_VERSION = (() => {
  try {
    return JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export { Config };

/**
 * Mount the plugin.
 *
 * The service is provided on this plugin's own context rather than inside a
 * child scope, so the preset-scoped tools row can consume it; preset rows are
 * siblings of this row in the same realm.
 * @param ctx - the harness context.
 * @param config - validated profile configuration.
 */
export function apply(ctx, config = {}) {
  const resolved = resolveConfig(config);
  const engine = createEngine({
    ctx,
    config: resolved,
    fallbackProjectDirectory: () => ctx.get('workingDirectory')?.defaultDirectory ?? process.cwd(),
    pluginVersion: PLUGIN_VERSION,
  });

  // Effect-scoped by Cordis: unloading the plugin unregisters the service and
  // releases its waiting consumers.
  ctx.provide(SERVICE_KEY, createModeService(engine));

  if (resolved.showPanel) registerPanelRoutes(ctx, engine, true);

  ctx.effect(() => () => engine.dispose(), 'harness-of-harness: runs');
}