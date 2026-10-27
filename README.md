# dsh-plugin-harness-of-harness

English | [中文](README.zh.md)

**Harness of Harness mode for DeepSeek Harness.**

This plugin adds a *Harness of Harness* agent preset to DSH — a selectable session
mode whose agent runs the Planner → Developer → QA Tester continual-development
loop over one project — plus a Web panel that shows the same runs live.

It is a native implementation of the workflow described by
[Harness-of-Harness](https://github.com/Flesymeb/HarnessOfHarness)
([paper](https://arxiv.org/abs/2609.01481)): many iterations over one evolving
project workspace, with the artifact and the evidence bundle carried forward
between iterations so the project improves loop by loop.

## Two surfaces, one run engine

A run is the same object however it was started, so the choice is only about who
drives it:

| Surface | Who starts a run | How |
|---|---|---|
| **Harness of Harness preset** | the session's own agent | the `hoh_start` tool |
| **Harness of Harness panel** | a person | the panel's Start button |

Either way the panel follows the run, and either way the three roles are
delegated as fresh DSH subagents of that session.

## Installing

This is a preview release. Install it into a DSH profile by Git URL:

```sh
dsh plugin --profile web add github:tailong-wu/dsh-plugin-harness-of-harness
```

Then restart the profile so the new plugin loads:

```sh
dsh web
```

The package ships a `dsh.bundle.patch`, so installing it adds both the
**Harness of Harness** preset and the panel — no further configuration is
needed. If your profile has no `pnpm` on `PATH`, `dsh plugin` reports that
before it changes anything.

To try it without touching your working profile, use a throwaway one:

```sh
dsh plugin --profile hoh-preview add github:tailong-wu/dsh-plugin-harness-of-harness
dsh --profile hoh-preview web
```

Requires DSH `0.2.1-rc.2` (declared in `dsh.compatibility.dshReleases`) and
Node `22.5.0` or newer. An install from Git builds the Web client during
`prepare`, so the first install takes a little longer than an npm one.

## Selecting HoH mode

Pick **Harness of Harness** in the session's preset picker (the `agent-preset`
control in the conversation header). The preset supplies:

- a **persona** that states the mode: the three roles, their order, their
  access, and the rule that the agent owns the loop rather than the roles;
- the **mode tools** below; and
- a **full working toolset** — shell, files, search, skills, jobs, goal, todo,
  web, compaction, and delegation — because the three delegated roles inherit
  this preset and must be able to build and test real software.

Sessions that did not select the preset cannot see the mode tools at all; DSH's
preset scoping does the gating, not a runtime check.

## The mode's tools

| Tool | What it does |
|---|---|
| `hoh_start` | Start a run for this session: the requirements text, an optional project directory, and an optional iteration budget. Returns the run id, its record directory, and the state of the first iteration. The run continues in the background. |
| `hoh_status` | This session's run: status, the iteration in flight with each role's turn and closing summary, the iterations already finished, and the record directory. |
| `hoh_stop` | Cancel the role now running and skip the remaining iterations. |

In HoH mode the usual request is therefore a sentence, not a tool sequence:
*"Build X, five iterations"* — the agent calls `hoh_start` and reports each
iteration's outcome.

## What one iteration does

| Order | Role | Access | Writes |
|---|---|---|---|
| 1 | **Project Planner** | read-only | `iteration-<n>/plan.md` — the prioritized development document |
| 2 | **Developer** | read-write | the project itself |
| 3 | **QA Tester** | read-only | `iteration-<n>/evidence.md` — verified behavior and unresolved gaps |

Each role is a **fresh DSH subagent** of the session that started the run, so
the children appear in that session's subagent list and are interruptible like
any other delegation. The next iteration's Planner reads the previous
development document and evidence bundle, which is what makes the improvement
continual rather than repeated.

After the QA Tester, the loop may **repair inside the same iteration**: the
Tester submits a structured verdict (`passed`, `verified`, `gaps`), and under the
default `repair-then-next` policy a verdict that does not accept the iteration
sends the Developer back in to close the gaps, up to `maxInnerRepairs` rounds,
before the iteration ends. The `next-loop` policy defers gaps to the next
iteration's Planner instead.

Acceptance needs both `passed: true` *and* no `blocker` gap, because a verdict can
contradict itself and one real run did exactly that. Non-blocking gaps — the
severity set is upstream's `blocker`/`high`/`medium`/`low` — are recorded as
polish and do not trigger a repair.

The Planner and the QA Tester are delegated under a second preset,
**HoH role · read-only**, whose file tool has no write or edit operation; the
Developer keeps the session's own preset because it must change the artifact.


## The panel

The panel is the monitor, and a person's way in. It appears as a **Harness of
Harness** tab in the right Sidebar's tab picker and an **HoH** button in the
conversation header.

- With no run it collects the **requirements text**, the **project directory**,
  and the **iteration budget**, then starts the loop.
- With a live run it follows the current iteration's three roles, with elapsed
  time, the delegated child session id, and each role's closing summary, plus a
  live run log.
- When the run ends it keeps the full iteration history and every artifact path.

Starting a run returns immediately. Roles run in the background, and the panel
polls the Host while the run is live.

## Where a run writes

By default a run records itself inside the project it is developing:

```
<project>/.hoh/runs/<run-id>/
  run.json                        # the whole run: status, history, log
  runtime_receipt.json            # deterministic-host event log, rewritten per role turn
  reproducibility.json            # versions, git revision, role bindings, config hash
  iteration-1/
    plan.md                       # Project Planner's development document
    evidence.md                   # QA Tester's written evidence
    evidence.json                 # QA Tester's structured verdict, one entry per round
    iteration.json                # per-turn status, timing, child session ids
  iteration-2/ …
```

Set the `stateDir` config to keep run records somewhere else. A run never reuses
a directory that already holds records.

## Configuration

A profile selects this bundle in `dsh.profile.bundles`; override any field from
your own `cordis.patch.yml`:

```yaml
- id: hoh-harness-of-harness
  config:
    defaultIterations: 5
```

| Field | Default | Meaning |
|---|---|---|
| `showPanel` | `true` | Expose the right-Sidebar tab and the header button. When `false`, the panel's routes are not registered either. The preset and its tools stay available. |
| `stateDir` | `''` | Directory holding run records. Empty keeps them in `<project>/.hoh/runs`. |
| `defaultIterations` | `3` | Iteration budget offered by the panel and used by `hoh_start` when it omits one (1–50). |
| `phaseTimeoutSeconds` | `3600` | Wall-clock ceiling for one role turn; `0` disables it. |
| `childMaxDepth` | `0` | Extra delegation levels granted to the three role children — how much further a role may itself delegate. `0` keeps one iteration at exactly three roles. The absolute `maxDepth` handed to the subagent service is this value plus the depth the role child itself occupies (usually `1`), so `0` becomes a cap of `1`, never `0`. |
| `testerPolicy` | `repair-then-next` | `repair-then-next` hands a failing QA verdict back to the Developer inside the same iteration; `next-loop` defers the gaps to the next Planner. |
| `maxInnerRepairs` | `2` | Same-iteration Developer repairs under `repair-then-next` (0–5). |
| `enforceRolePresets` | `true` | Delegate the read-only roles under the `hoh-readonly` preset. Turn off only if that row is not mounted. |

The preset itself is the `preset-harness-of-harness` row in
[`cordis.patch.yml`](cordis.patch.yml); override that row to change the mode's
capability set.

## Requirements and limits

- A run is parented to the session that started it, so that session must be
  live. Naming a session that is not live is refused rather than quietly reusing
  another one; only a caller that names no session at all (the `hoh_start` tool)
  falls back to a single root session.
- The panel is a single-owner surface. The Host admits a caller as the local
  `owner` and does not expose a per-session identity to a route, so any
  owner-privileged client can start, stop, or read a run for a session id it
  knows. That is the Host's trust model for a local app, not a check this plugin
  can add; the routes carry no secrets and return only run state and file paths.
- The project directory must be absolute and must exist, and is refused if it
  resolves into a system tree (`/etc`, `/usr`, `/var/db`, …) or a dotfile
  directory under your home (`~/.ssh`, `~/.aws`). Symlinks are followed before
  that check, so a link cannot smuggle one of those in. This is a guard against
  accidents, not a sandbox: the Host's file policy still governs what a role may
  actually read or write.
- Every role inherits the session's model and permission roots. The read-only
  roles are delegated under a preset whose file tool cannot write, but the shell
  rows remain (the QA Tester has to build and run the project), and a shell can
  write. Upstream closes that by giving each read-only role its own isolated
  workspace and hash-checking the candidate, which this host does not offer a
  plugin — see
  [`docs/alignment-with-upstream-hoh.md`](docs/alignment-with-upstream-hoh.md).
- How this plugin relates to upstream HoH — what is aligned, where it improves
  on upstream, which defects review found and closed, and what is deliberately
  out of scope — is recorded item by item in
  [`docs/alignment-with-upstream-hoh.md`](docs/alignment-with-upstream-hoh.md).
- The HoH preset's plugin list intentionally tracks the shipped `standard`
  preset of DSH 0.2.1-rc.2, minus the isolated plan-mode group (HoH plans
  through its Planner role, and plan mode's write ban would fight the
  Developer) and minus the schedule tools. A future DSH release that renames or
  drops a mounted package makes the preset report a load diagnostic until this
  patch is updated.
- A failed Planner stops the run; a failed Developer or QA Tester is recorded,
  the iteration is marked `partial`, and the loop continues so the next Planner
  can see the gap.
- The loop delegates three roles per iteration and does not itself use the
  network beyond what the roles do.

## Development

```sh
npm install
npm run build:client   # bundles client/index.jsx -> lib/client.js
npm run smoke          # imports the Host half and parses the preset patch in Node
npm test               # drives the real engine, panel routes, service, and tools over stand-ins
```

The Host side is these modules:

| Module | Role |
|---|---|
| [`index.js`](index.js) | the Host row: builds the engine, provides the mode service, registers the panel routes |
| [`src/engine.js`](src/engine.js) | the loop: iterations, delegation, repair rounds, cancellation |
| [`src/transitions.js`](src/transitions.js) | the deterministic role machine: which role may follow which |
| [`src/records.js`](src/records.js) | `runtime_receipt.json`, `reproducibility.json`, and their fingerprints |
| [`src/config.js`](src/config.js) | the profile configuration schema and its resolution into runtime settings |
| [`src/contract.js`](src/contract.js) | constants shared by both halves: routes, roles, limits, and the evidence schema |
| [`src/prompts.js`](src/prompts.js) | the Planner, Developer, repair, and QA Tester prompts |
| [`src/panel.js`](src/panel.js) | the panel's HTTP routes |
| [`src/service.js`](src/service.js) | the `hohHarnessOfHarness` service and the model-facing run projection |
| [`tools.js`](tools.js) | the preset-scoped row: `hoh_start`, `hoh_status`, `hoh_stop` |

`npm test` needs no harness and no credentials: it substitutes a fake
`ctx.subagents` that follows the documented contract, so it covers role
ordering, the artifact hand-off between iterations, cancellation, a failed
Planner, the wall-clock ceiling, input validation, the panel's HTTP surface, the
service contract, the tool contract, and — in `tests/alignment.test.mjs` — the
role machine, `repair-then-next`, the two audit records, and the read-only role
delegation. `npm run smoke` additionally *parses* `cordis.patch.yml` and checks
both presets' rows, so a YAML slip or a dropped mode tool fails locally instead
of at installation.

What neither covers is a real DSH child accepting the delegation spec, the
presets appearing in the picker, and the rendered panel; all three need a live
harness and a browser.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the package layout and the checks a
change should pass.

## License

Apache-2.0. See [`LICENSE`](LICENSE) for the full text and [`NOTICE`](NOTICE) for
the attribution this project carries.

This port implements the loop that HoH-lite implements, and HoH-lite is
Apache-2.0 — so this package uses the same license rather than a weaker one. No
HoH-lite source file is copied here: the upstream loop is Python and this port is
JavaScript. The upstream repository's own split is worth knowing, since it is easy
to misread: its paper and demo materials at the repository root are MIT
(Copyright 2026 Hyoung Yan), while the `hoh-lite/` source tree this plugin ports
is Apache-2.0 with its own notices.