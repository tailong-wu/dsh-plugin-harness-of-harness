# Contributing

## Layout

```
index.js                 Host half: apply(), name, inject, Config; builds the engine,
                         provides the hohHarnessOfHarness service, registers panel routes
tools.js                 preset-scoped row: hoh_start, hoh_status, hoh_stop
src/contract.js          route paths, roles, transition graph, evidence schema, limits
src/config.js            Schemastery Config and its resolution
src/engine.js            the run engine: iterations, delegation, repair rounds, run records
src/transitions.js       the deterministic role machine (which role may follow which)
src/records.js           runtime_receipt.json, reproducibility.json, and fingerprints
src/service.js           the mode service and the model-facing run projection
src/prompts.js           the Planner, Developer, repair, and QA Tester prompts
src/panel.js             Host Fetch routes under /api/plugins/hoh-harness-of-harness
client/index.jsx         Client half: tab type, panel body, header toggle
client/app.jsx           the panel component
client/data.js           browser-side calls to the Host routes
client/locale.js         panel copy (zh, en)
client/styles.js         panel stylesheet, theme-token based
cordis.patch.yml         the Host row, the HoH mode preset, and the read-only role preset
docs/alignment-with-upstream-hoh.md  alignment, improvements, and known gaps against upstream HoH
scripts/build-client.mjs bundles client/index.jsx into lib/client.js
scripts/smoke.mjs        credential-free Host-half checks and patch parsing
tests/engine.test.mjs    loop and panel-route tests over a fake delegation service
tests/tools.test.mjs     service and mode-tool tests over a recording service
tests/alignment.test.mjs role machine, repair-then-next, audit records, read-only roles
```

The Host half is plain ESM JavaScript and is loaded by the harness directly. The
client half is TypeScript-free JSX bundled by esbuild; `lib/client.js` is a
build artifact and must be rebuilt with `npm run build:client`.

## Checks a change should pass

```sh
node <plugin-write-skill>/scripts/validate-names.mjs --manifest ./dsh-plugin.naming.json
npm run build:client
npm run smoke
npm test
```

Then install the bundle in a profile and exercise it in the Web UI.

Adding or renaming a public surface — a route, a tool, a service key, a preset
identity, an exported plugin name — means updating `dsh-plugin.naming.json`,
`cordis.patch.yml` where applicable, and `README.md` in the same change.
`scripts/smoke.mjs` checks that the routes, the tool names, the service key, the
Loader row ids, and the patch's rows stay in step with that declaration, and it
parses the patch so a YAML slip fails locally instead of at installation.

## Conventions

- Register every resource inside `apply` through `ctx.effect` with a disposer,
  so an unload leaves no listener, timer, route, service, or running run behind.
- Keep tunable values in `Config`; do not hard-code them.
- A role prompt must stand alone, because every role runs in a fresh child whose
  conversation starts empty.
- Keep the model-visible surface honest: the Planner and QA Tester are told they
  are read-only, and the code must not claim an enforcement it does not have.
- A preset's `plugins` list is that mode's complete capability set and the
  capability set its delegated roles inherit. When changing it, keep the
  working toolset complete and say in `README.md` what differs from the shipped
  `standard` preset.
- Prefer the preset scope over a runtime check when gating a model-facing tool:
  `tools.js` is mounted only by the HoH preset, which is why a session in
  another mode has no `hoh_*` tool.
- A tool description states behavior and returns, not implementation; parameter
  defaults, ranges, and when-to-set rules belong on the parameter.
- An upstream-parity change is not finished until it is recorded in
  `docs/alignment-with-upstream-hoh.md` under the right bucket: **Part I
  (aligned)** needs upstream behaviour, what this plugin does, and how it is
  verified; **Part II (improves on upstream)** needs the upstream behaviour it
  replaces written next to it, so the trade can be judged; **Part III (weaker)**
  needs the concrete gap and, where one exists, the fix. If a mechanism is only
  partially enforced, write that — do not round it up. When an alignment is
  dropped or regressed, move it to Part III in the same change, and update the
  at-a-glance table while you are there.