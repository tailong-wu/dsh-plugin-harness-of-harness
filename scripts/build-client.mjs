#!/usr/bin/env node
/**
 * Build `lib/client.js` in the harness's lazy-CJS module format.
 *
 * Client plugins are plain browser scripts that register one factory with
 * `window.__ModuleLoader__`; the harness's module system resolves the factory's
 * `require` calls against a frozen platform table (React, Cordis, the UI
 * primitives) and calls the factory lazily on first use. esbuild produces the
 * CommonJS body; this script supplies the registration wrapper.
 */
import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const PACKAGE_ID = 'dsh-plugin-harness-of-harness';
const OUTPUT = 'lib/client.js';
const ENTRY = 'client/index.jsx';

/** Modules the browser shell already provides; they must never be bundled. */
const PLATFORM_EXTERNALS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
];

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  write: false,
  format: 'cjs',
  platform: 'browser',
  target: ['es2022'],
  jsx: 'automatic',
  charset: 'utf8',
  legalComments: 'none',
  logLevel: 'warning',
  external: [...PLATFORM_EXTERNALS, '@deepseek-ai/*'],
});

const [file] = result.outputFiles;
if (file === undefined) throw new Error('esbuild produced no output');

const body = file.text;
const wrapped = `window.__ModuleLoader__.load({
	id: ${JSON.stringify(PACKAGE_ID)},
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
${body}
		return module.exports;
	}
});
`;

await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, wrapped, 'utf8');
console.log(`built ${OUTPUT} (${(wrapped.length / 1024).toFixed(1)} kB)`);