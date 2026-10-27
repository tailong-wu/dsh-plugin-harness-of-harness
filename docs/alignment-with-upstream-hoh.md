# Upstream HoH: what is aligned, what is improved, what was wrong and is now fixed

This plugin is a **DSH-native port of the Harness-of-Harness core loop**, not a
re-implementation of the paper's benchmark machinery. So the useful question is
not "is this HoH?" but four separate questions:

1. which upstream mechanisms are **reproduced faithfully** here,
2. where does this plugin **do better** than upstream,
3. which defects review found and how they were closed, and
4. what is deliberately **out of scope**.

This document answers all four, item by item, and records the code, the tests,
and the run artifacts that back each claim.

Upstream is [`hoh-lite`](https://github.com/Flesymeb/HarnessOfHarness), the
`gameloop` Python CLI, at commit `6a02101`. Line numbers refer to
`src/gameloop/…` in that tree.

**Read Part III before quoting Part I.** An aligned mechanism and a defect can
sit one line apart: the read-only role is aligned at the tool level and weaker at
the workspace level, in the same feature. Part III records the eight defects found
in review, and the test that now pins each fix.

---

## At a glance

| ID | Mechanism | Status |
|---|---|---|
| **A-1** | Deterministic role sequencing | **aligned** |
| **A-2** | `runtime_receipt.json`, rewritten per role event | **aligned** in shape, **extended** with fields |
| **A-3** | Read-only roles cannot write | **partially aligned** — tool-level only |
| **A-4** | `repair-then-next` bounded same-iteration repair | **aligned** |
| **A-5** | Structured tester verdict consumed by the loop | **aligned in mechanism**, different vocabulary |
| **A-6** | `reproducibility.json` + refusal to reuse a run | **aligned**, one field deliberately differs |
| **O-1** | Contradiction guard on the QA verdict | **improves on** upstream |
| **O-2** | Configuration hash by meaning, not by bytes | **improves on** upstream |
| **O-3** | `reported_passed` kept beside the effective verdict | **improves on** upstream |
| **O-4** | Repair carried by the structured gap list | **improves on** upstream's bare re-run |
| **O-5** | Session-native, live, interruptible | **improves on** upstream's batch CLI |
| **O-6** | Zero external runtime | **improves on** upstream's deployment |
| **W-1** | A missing QA verdict counted as acceptance | **was weaker — fixed** (now fails closed) |
| **W-2** | A verdict missing its `passed` field counted as a pass | **was weaker — fixed** |
| **W-3** | `max_depth` recorded the grant, not the cap in force | **was wrong — now records both** |
| **W-4** | `high` severity documented as blocking but not enforced | **was a defect — schema now matches code** |
| **W-5** | Receipt `started_at` was the *completion* time | **was wrong — now records the start** |
| **W-6** | A project directory was accepted on trust | **was a hole — fixed** (realpath + prefix guard) |
| **W-7** | A dead session silently reused another | **was wrong — fixed** (refused) |
| **W-8** | Non-integer budget, unescaped fence, unbounded body | **were defects — fixed** |
| **U-1 … U-11** | Benchmark machinery, integrity, policy, atomicity | **deliberately out of scope** |

---

# Part I — Aligned

## A-1 — Deterministic role sequencing

**Upstream.** `GameLoopRuntime` is not an agent; it owns sequencing. Its
`_validate_transition` (`core/runtime.py:144`) admits exactly: the first role of
a loop must be Planner; `Planner → Developer`; `Developer → Tester`;
`Tester → {Developer, Tester}`, where `Tester → Developer` is what makes repair
possible and `Tester → Tester` admits a final acceptance pass. An illegal
transition raises. `finish_loop` (`core/runtime.py:132`) refuses to close a loop
whose Developer never ran.

**Here.** `src/transitions.js` implements the same machine: `begin(index)`,
`record(role, details)` (validating), `finish()` (refusing without a Developer),
`abandon()`, plus the recorded event list. The engine drives every turn through
`machine.record(...)` — completed, failed, and skipped turns alike — so the
recorded sequence is the sequence that actually happened.

**Where.** `src/transitions.js`; called from `runRole` / `recordSkipped` /
`runLoop` in `src/engine.js`; the graph constants live in `src/contract.js`
(`FIRST_ROLE`, `ALLOWED_TRANSITIONS`).

**Verified.** `tests/alignment.test.mjs`: *the role machine admits only the
upstream transition graph*, *the role machine refuses an iteration whose
Developer never ran*.

**Residual.** Upstream validates inside the runtime object that also writes the
receipt; here the machine and the record writer are separate modules the engine
calls in sequence. The behaviour matches; the class layout does not.

## A-2 — Per-event receipt

**Upstream.** `GameLoopRuntime._write_receipt` (`core/runtime.py:190`) rewrites
`runtime_receipt.json` after every append, with `schema_version`, `runtime`,
`coordination: deterministic-host`, `active_loop`, per-role bindings, and an
`events` array of `{loop_index, sequence, role, status, started_at,
duration_seconds, details}` (`RuntimeEvent.to_dict`, `core/runtime.py:32`). A run
directory that already holds a receipt is refused at construction
(`core/runtime.py:59-62`).

**Here.** `src/records.js` writes `runtime_receipt.json` with
`schema_version`, `runtime`, `coordination: deterministic-host`,
`active_iteration`, `tester_policy`, `max_inner_repairs`, `roles`, and `events`,
rewritten after every role turn and at run end. `engine.start` refuses a run
directory that already holds a receipt or a `run.json` (`src/engine.js:885-887`).

**Where.** `src/records.js` (`writeReceipt`, `RECEIPT_FILE`); `persistReceipt` in
`src/engine.js`.

**Verified.** `tests/alignment.test.mjs`: *a run writes the deterministic-host
receipt and the reproducibility record* asserts schema version, runtime,
coordination, the role sequence and sequence numbers, per-event duration, and the
two workspace-access values.

**Residual — three field-level differences, not alignment failures:**

| Upstream | Here | Note |
|---|---|---|
| `active_loop` | `active_iteration` | renamed, because "iteration" is this plugin's term |
| role binding = `{role, harness, model, reasoning_effort, workspace_access, tools{godot_mcp, godot_docs}}` | `{role, preset, workspace_access, max_depth_grant, max_depth_effective, harness, model, reasoning_effort}` | `role`/`harness`/`model`/`reasoning_effort`/`workspace_access` match upstream spelling; the three additions are this plugin's own, and upstream has no depth fields and no `tools{godot_mcp, godot_docs}` counterpart here |
| no tester policy fields | `tester_policy`, `max_inner_repairs` | extra fields; upstream keeps these in its config, not its receipt |

So "serialized with upstream spellings" holds for `workspace_access` and for
`role`/`harness`/`model`/`reasoning_effort`; `preset` and the two depth fields
are additions. The depth pair is split because the configured grant and the
enforced cap are different numbers (see **W-3**).

## A-3 — Read-only roles cannot write (partial)

**Upstream.** `RoleBinding.__post_init__` (`core/roles.py:39`) refuses to
construct a non-Developer binding with a read-write workspace or read-write Godot
MCP, and refuses a live MCP for the Planner.

The protection that follows is **copy isolation plus hashing**, not a read-only
mount, and the distinction matters because it is easy to describe from the field
name rather than from the code. The Planner gets its own empty workspace
(`planner.py:192-195`), never the candidate. The QA Tester runs against a
disposable copy inside bubblewrap — and that copy is writable by design, with
`sandbox_mode="danger-full-access"`, so it may write reports there
(`runner.py:1350-1354`). What makes that safe is that writes land in the copy
while the authoritative candidate stays untouched, and the candidate is hashed
before and after the role (`runner.py:1592,1696`) so a mutation that did reach it
is caught.

**Here.** A second agent preset, `hoh-readonly`, is declared in
`cordis.patch.yml` (`preset-hoh-readonly`) and mounts a
`@deepseek-ai/dsh-tool-fs` row configured `write: false, edit: false, read: true`.
The engine delegates the Planner and the QA Tester under it via
`request.agentPreset`, gated on the service advertising
`capabilities.agentPreset`, and leaves the Developer on the session's own preset
because it must change the artifact. `resolveConfig.enforceRolePresets` turns the
delegation off for a composition that does not mount the preset rows.

**Where.** `cordis.patch.yml` (`preset-hoh-readonly`); `ROLE_PRESETS` and
`READ_ONLY_PRESET` in `src/contract.js`; `spawnRole` in `src/engine.js`.

**Verified.** `tests/alignment.test.mjs`: *the read-only roles are delegated under
the read-only preset, the Developer is not*, *enforceRolePresets off keeps every
role on the session preset*. `scripts/smoke.mjs` parses the patch and asserts the
preset disables `write` and `edit` while keeping `read`, and that it does not
mount the mode control tools.

**Residual — the honest gap, in two halves:**

1. **Prevention** is weaker. Upstream gives each read-only role an isolated
   workspace it can write inside without reaching the candidate — an empty one
   for the Planner (`planner.py:192-195`), a disposable bubblewrap copy for the
   Tester (`runner.py:1350-1354`) — while filtering the environment through
   `VISUAL_TESTER_ENV_ALLOWLIST` (`runner.py:1210-1214`). This host offers a
   plugin no way to give a child an isolated copy, so the roles run in the real
   project and the shell rows stay: the QA Tester has to build and run the
   project, and a shell can write.
2. **Detection** is absent. Upstream does not rely on prevention alone: it hashes
   the candidate before and after the role and fails the attempt as
   `invalid_candidate_mutation` when the hash moved
   (`runner.py:1592,1696,1718`). This plugin never hashes the workspace, so it
   cannot tell whether a read-only role wrote to the project.

Accurate statement: **no file-tool write, a reachable shell, and no detection.**

## A-4 — `repair-then-next`

**Upstream.** `--tester-policy repair-then-next` (`runner.py:1007`) enables
`llm_tester` and allows bounded same-loop acceptance repair before advancing, up
to `--max-inner-repairs` (default 2, `runner.py:1017`). That is why the runtime
admits `Tester → Developer`.

**Here.** `runLoop` runs Planner, then a developer/tester round; while
`acceptanceOf(verdict)` says the iteration is not accepted and
`round < maxInnerRepairs`, it runs another Developer turn with a repair prompt
carrying the reported gaps, then tester again. Config: `testerPolicy`
(`repair-then-next` default, `next-loop` available) and `maxInnerRepairs`
(default 2, 0–5). Repair turns are labelled `HoH <role> · iteration N · repair K`
and recorded with their round number.

**Where.** `src/config.js` (`testerPolicy`, `maxInnerRepairs`); `acceptanceOf`,
`wantsRepair`, and the repair loop in `src/engine.js`; `repairPrompt` in
`src/prompts.js`.

**Verified.** `tests/alignment.test.mjs`: *repair-then-next runs bounded Developer
repairs inside one iteration*, *repair rounds stop at the configured ceiling*,
*testerPolicy next-loop defers gaps to the next iteration instead of repairing*,
*a self-contradicting verdict does not count as an acceptance*, *an iteration with
an unrepaired blocker is partial, not done*, *only a blocker defeats a pass*.

**Residual.** Upstream's repair is bounded by an inner repair counter inside its
adapter and interacts with `attempts`; here it is bounded only by
`maxInnerRepairs` and there is no attempt-level retry (U-7). The `maxInnerRepairs`
default and ceiling agree with upstream's default; the 0–5 range is this
plugin's, where upstream also validates `>= 0`.

## A-5 — Structured tester verdict

**Upstream.** Evidence is not prose. `core/evidence.py` builds
`build_verified_demo_claims` (:308), `build_loop_issues`, `build_loop_memory`
(:430), `build_demo_evidence_matrix` (:470), and `build_public_execution_snapshot`
(:66); the Planner consumes a compacted history. Gap severities are
`{blocker, high, medium, low}` with an unknown value defaulting to `high`
(`core/evidence.py:121,133`).

**Here.** The QA Tester is delegated with `request.outputSchema = EVIDENCE_SCHEMA`
(`passed`, `verified[{claim, evidence}]`, `gaps[{gap, severity}]`, severity from
the same upstream set). The subagent service schema-validates the child's
submission, so the engine reads `result.structured` instead of parsing text.
`acceptanceOf` derives the effective verdict; the receipt records `passed`
(effective) and `reported_passed` (what the child claimed) separately. The
severity set and the unknown-severity default to `high` both match upstream
(`verdictOf` in `src/engine.js:243-260`). What does **not** match is which
severities block acceptance: upstream reads a status field, while this plugin
applies `BLOCKING_SEVERITIES` — see **W-4** for the schema/code conflict that
follows from it.

**Where.** `EVIDENCE_SCHEMA`, `SEVERITIES`, `BLOCKING_SEVERITIES` in
`src/contract.js`; `verdictOf` and `acceptanceOf` in `src/engine.js`;
`writeIterationRecord` writes `iteration-N/evidence.json`; `src/service.js`
projects it into `hoh_status`.

**Verified.** `tests/alignment.test.mjs` (the repair test asserts `evidence.json`
carries both rounds and their verdicts; the contradiction tests assert the
effective-versus-reported split in the receipt).

**Residual.** The vocabulary is claim/gap shaped, not the gamecraft benchmark's
demo-id shape, because there is no benchmark here (U-9). And the outcome is a
boolean plus a gap list, not upstream's four-value `review_status` over six
`tester_status` values (U-10).

## A-6 — Reproducibility record and run-id safety

**Upstream.** Each run writes `reproducibility.json`
(`build_reproducibility_manifest`, `core/reproducibility.py:50`) with
`python`, `system`, `source_revision`/`source_dirty`,
`benchmark_revision`/`benchmark_dirty`, per-role bindings, `harness_versions`
probed by running each `<harness> --version`, `godot_version`,
`paper_harness_version`, and `config_sha256`. It refuses to reuse a run id.

**Here.** `src/records.js` writes `reproducibility.json` with the plugin version,
Node/platform/arch, the delegation provider, the project directory and its git
HEAD plus dirty flag, the preset id, per-role bindings, the full resolved config,
a `sha256` configuration hash, the tester policy, and `external_evaluator: null`.
Unobservable fields (per-role model, reasoning effort, harness CLI version,
benchmark revision) are written as `null` rather than omitted, so "not applicable
here" stays distinguishable from "forgotten".

**Where.** `src/records.js` (`buildReproducibility`, `configHash`,
`gitRevision`); called from `engine.start`; `pluginVersion` is passed by
`index.js` from `package.json`.

**Verified.** `tests/alignment.test.mjs`: *a run writes the deterministic-host
receipt and the reproducibility record*, *configHash is stable across equal
configurations and changes with them*, *gitRevision reports a repository head or
null outside one*. A real run recorded plugin `0.1.0`, Node `v24.21.0`,
`darwin/arm64`, provider `spawn`, a `sha256:` config hash, and `git: null` for a
non-repository project.

**Residual.** `node`/`platform`/`arch` replace `python`/`system`; one `git` object
replaces two (there is no benchmark checkout); `provider: 'spawn'` replaces a
probed CLI version, because roles run in-process and there is no separate binary
to interrogate. `config_hash` is the one intentional difference — see **O-2**.

---

# Part II — Where this plugin improves on upstream

These are deliberate divergences in the direction of *more*, not less. Each names
the upstream behaviour it replaces, so a reviewer can judge whether the trade is
worth it.

## O-1 — The QA verdict cannot contradict itself

**Upstream.** Acceptance reads one field:
`tester_acceptance_passed` (`runner.py:418`) returns `review_status == "pass"`.
The review status and the gap list are produced in different places, so upstream
does not compare them: a report can claim `pass` and still carry `remaining_bugs`
or `evidence_gaps`, and the acceptance path never looks at the gaps to object.
It is not that upstream cannot express the contradiction — it is that upstream
has no rule that notices it.

**Here.** The verdict is two-part (`passed` flag + `gaps` list) and reaches the
engine as one object, so the two halves are compared directly. Real runs
produced a contradiction of exactly this kind: `passed: true` alongside gap
entries. `acceptanceOf(verdict)` (`src/engine.js:279`) therefore requires the flag
**and** the absence of a blocking gap, and it is the single decision behind
repair, iteration completeness, and the receipt.

**Why it is an improvement.** Upstream's blind spot is structural rather than
deliberate — nothing in the loop reads `review_status` against the gaps. This
plugin acquires that check because its verdict is one schema-validated value
rather than two artifacts written at different times. The guard is what stops
the loop from accepting an iteration that reported a blocker — defect **D-2**.

**Verified.** *a self-contradicting verdict does not count as an acceptance*;
*only a blocker defeats a pass; lower severities are polish*.

**Caveat.** The guard is only as strong as `BLOCKING_SEVERITIES`, which is
`['blocker']` alone while the schema tells the child that `high` also blocks —
see **W-4**. The second test above is the one that pins that narrow reading, so
it verifies the guard and documents the conflict at the same time.

## O-2 — A configuration hash that means the same thing to two people

**Upstream.** `config_sha256 = sha256(config.read_bytes())`
(`core/reproducibility.py:69-72`): the hash covers the **file's bytes**, so two
people with behaviourally identical configurations disagree the moment their
whitespace or key order differs, and a comment changes the hash.

**Here.** `configHash` (`src/records.js:110`) hashes a canonical
`JSON.stringify` of the resolved config plus the role bindings plus the preset id,
so two runs that *behave* the same produce the same hash.

**Trade-off, stated plainly.** Upstream's hash can prove "you ran the exact file
I ran". This one can prove "you ran an equivalent configuration". For comparing
two runs of a port, equivalence is the more useful invariant; for reproducing a
paper artifact, byte identity would be. Recorded as a choice, not an accident.

**Verified.** *configHash is stable across equal configurations and changes with
them*.

## O-3 — What the child claimed is kept beside what the loop decided

**Upstream.** The receipt's event `details` hold what the adapter summarized;
there is no notion of a verdict that was overridden, because there is nothing to
override.

**Here.** Each tester event carries `passed` (the effective value the loop acted
on), `reported_passed` (what the child actually submitted), and
`blocking_gaps`, so a reviewer can see a verdict being overturned instead of
having to infer it from the gap list.

**Verified.** The contradiction test asserts
`first.details.passed === false` while `first.details.reported_passed === true`,
with `blocking_gaps: 1`.

## O-4 — Repair turns carry the gap list, not just the workspace

**Upstream.** An inner repair (`runner.py:2945-2951`) loops while the tester
failed, the failure is repairable, and `repair_index < max_inner_repairs`,
creating `inner-repair-NN/` and handing the Developer the candidate again.

**Here.** `repairPrompt` (`src/prompts.js:169-198`) renders the just-reported gaps
as a numbered, severity-tagged list, tells the Developer to reproduce one of them
before fixing, and tells it to preserve what the Tester verified. The gap list is
therefore an explicit contract between two roles rather than an artifact of
re-reading the workspace.

**Why it is an improvement.** It makes the hand-off auditable: the receipt's
repair events and the Developer's prompt refer to the same gap set. It does not
make repair smarter than upstream's — it makes it inspectable.

## O-5 — Session-native, live, and interruptible

**Upstream.** A batch CLI: `gameloop --config … --task … --run-id …`. Progress is
a log stream; inspection is post-hoc from the run directory; the process tree is
killed on timeout (`core/execution.py:107`).

**Here.** Three ordinary DSH subagents of the session that started the run, plus:

- a right-Sidebar panel showing iteration, role, repair round, verdict, and log,
- `hoh_start` / `hoh_status` / `hoh_stop` (the same run, addressed by session),
- `hoh_stop` aborting through an `AbortController`, so a stop is recorded as
  `skipped` events in the receipt rather than as a killed process.

**Why it is an improvement.** The roles appear in the session's subagent list and
are interruptible like any other delegation, so a person watches and steers the
loop in the same place they watch everything else. There is no terminal.

## O-6 — Zero external runtime

**Upstream.** Python 3.12+, Godot 4, an external benchmark checkout, Node/npm,
bubblewrap, Xvfb, xdotool, FFmpeg for MCP and replay, and per-harness credentials.

**Here.** A DSH plugin. No Python, no Godot, no benchmark checkout, no per-harness
CLI credentials.

**Why it is an improvement — and what it costs.** This is what makes the port
deployable at all inside DSH. The cost is real and is recorded, not glossed:
there is no benchmark, so there is no external evaluator (**U-2**), no domain
policies (**U-6**), no demo-id evidence matrix (**U-9**).

---

# Part III — Defects found in review, and how they were closed

The first preview release went through a code review against upstream and against
the host's own API contract. Eight defects were found. All eight are **fixed**,
and each fix is pinned by a test, so this section is a record of what was wrong
and what now guarantees it stays right — not a list of live gaps.

Keeping the diagnosis here is deliberate: a fix without a record of the failure it
prevents tends to get reverted by the next person who finds the old behaviour more
convenient.

## W-1 — A missing QA verdict counted as an acceptance (fixed)

**Upstream.** `tester_acceptance_passed` (`runner.py:418`) returns `False` for
anything that is not a dict, and returns `True` only for `review_status == "pass"`
or the explicit `dry_run` / `skipped_no_trial` statuses. **Fail-closed.**

**Was.** `acceptanceOf(null)` returned `{ accepted: true }`, and the iteration's
completeness check treated a null verdict as accepted. A Tester that submitted no
structured result at all — a rejected submission, a crash late in its turn, a
child that answered in prose — closed its iteration as accepted. The comment above
`verdictOf` claimed the opposite of what the code did.

**Now.** `acceptanceOf(null)` returns `{ accepted: false, blocking: [], missing:
true }`, and iteration completeness reads
`lastTester !== undefined && acceptanceOf(lastTester.verdict).accepted`. Silence
is the absence of evidence, not evidence of a pass.

**Verified.** `tests/alignment.test.mjs`: *a QA Tester that submits no verdict does
not accept the iteration* asserts the iteration ends `partial` and that the
receipt carries no `passed` key for the silent turn.

## W-2 — A verdict missing its `passed` field counted as a pass (fixed)

**Was.** `verdictOf` computed `passed: structured.passed !== false`, so an absent
flag became a pass. The schema makes `passed` required, which should make that
unreachable — but "should be unreachable" is not a guarantee, and a verifier's
default must not be success.

**Now.** `passed: structured.passed === true`. Only an explicit `true` accepts.

**Verified.** `tests/alignment.test.mjs`: *a verdict without a passed flag is not
an acceptance*.

## W-3 — `max_depth` recorded the grant, not the cap in force (fixed)

**Upstream.** Has no `max_depth` field at all: `RoleBinding.to_dict`
(`core/roles.py:56-70`) emits `role`, `harness`, `model`, `reasoning_effort`,
`workspace_access`, and `tools{godot_mcp, godot_docs}`.

**Was.** `writeReceipt` and `buildReproducibility` both wrote
`max_depth: binding.maxDepth`, which `roleBindings()` set to
`config.childMaxDepth` — the **grant**, default `0`. The cap actually enforced on
the activation is computed separately in `spawnRole` as
`absoluteRoleMaxDepth(...) = parentDepth + 1 + extra`, i.e. `1` by default. So the
receipt showed `max_depth: 0` for a run whose roles really ran under a cap of `1`:
two correct numbers, one misleading field name.

**Now.** Both are recorded, under names that say which is which:

```json
"max_depth_grant": 0,
"max_depth_effective": 1,
```

`roleBindings(parent)` takes the same parent the roles are delegated from, so the
recorded cap is by construction the one enforced on their activations. The host's
own type documentation confirms the semantics: `maxDepth` "caps the child's
absolute delegation depth ... its computed depth must be less than or equal to
this non-negative safe integer" (`@deepseek-ai/dsh-subagent`,
`lib/types/types.d.ts`).

**Verified.** `tests/engine.test.mjs` *the configured recursion budget becomes the
ABSOLUTE depth cap a role is started with* asserts `request.maxDepth === 1` at the
default budget and `3` at `childMaxDepth: 2`.

## W-4 — `high` severity was documented as blocking but was not (fixed)

**Was.** `EVIDENCE_SCHEMA`'s severity description told the child that "`blocker`
and `high` mark work a repair pass must close", while
`BLOCKING_SEVERITIES = ['blocker']` fired repair on blockers only. The child was
instructed to treat `high` as blocking, the loop did not, and a test pinned the
discrepancy in place.

**Now.** The behaviour is unchanged — only `blocker` sends the Developer back —
and the schema says so:

> Only `blocker` sends the Developer back for a repair pass inside this iteration;
> `high` is the next iteration's first priority, `medium` and `low` are polish.

Resolving the conflict in the wording rather than in the repair trigger was the
conservative choice: widening the repair trigger changes how many turns a run
spends, which is a behaviour change that deserves its own decision.

**Verified.** *only a blocker defeats a pass; lower severities are polish* still
passes a `high` gap and asserts no repair runs — now testing the documented
behaviour rather than contradicting it.

## W-5 — Receipt `started_at` was the completion time (fixed)

**Upstream.** `invoke` captures `started_wall` **before** running the operation
(`core/runtime.py:89`) and appends the event afterwards, so `started_at` is a real
start and `duration_seconds` is its elapsed time.

**Was.** `RoleMachine.record` stamped `started_at` with `Date.now()` at *record*
time — after the role turn had finished — while computing `duration_seconds` from
the real `startedAt`/`endedAt`. The duration was right; the timestamp was the end.
Proof from the pre-fix run `hoh-20261023-140931-f877a7`: event 1 recorded
`started_at 06:14:40.523Z` with `duration_seconds 309.162`, and the run itself
started at `06:09:31.330Z` — the timestamp was where the role *ended*.

**Now.** `started_at` comes from `details.startedAt` when the engine supplies it,
and `duration_seconds` is measured from the same instant.

**Verified.** *a run writes the deterministic-host receipt and the reproducibility
record* now asserts that each event's `started_at + duration_seconds` lands at or
before the next event's `started_at`, which a completion-time stamp cannot satisfy.

## W-6 — A project directory was accepted on trust (fixed)

Found by the same review, in code this plugin owns rather than in its port of
upstream. A run writes `.hoh/` beside the artifact and hands the directory to
three delegating children, so `projectDir` is the one path a run writes outside
its own state directory.

**Was.** Any string was accepted: a relative path resolved against whatever the
host's working directory happened to be, and `projectDir: "/"` or `/etc` would
scatter run records through a system tree.

**Now.** The value must be absolute and must exist, and it is refused when the
**real** path lands in a system tree (`/etc`, `/usr`, `/var/db`, …) or in a
dotfile directory directly under the user's home (`~/.ssh`, `~/.aws`). Two
details that make the check real rather than decorative:

- **It resolves symlinks first.** `resolve()` is purely lexical, so
  `/tmp/proj` pointing at `/etc` resolves to the innocent-looking `/tmp/proj`
  and would pass an exact-match denylist. On macOS `/tmp` is itself a symlink to
  `/private/tmp`, so this is the ordinary case, not an exotic one. The check runs
  on `realpathSync()`, and the real path is what the run records, writes under,
  and hands to the roles as `cwd`.
- **It matches prefixes, not exact names.** An exact-match denylist lets
  `/etc/ssl` and `/var/db` straight through — precisely the directories that
  matter.

This is a guard against accidents, not a sandbox: the host's file policy remains
the authority on what a role may read or write.

**Verified.** `tests/engine.test.mjs`: *a project directory must be an absolute,
non-root path*, *a symlinked project directory cannot escape into a refused
tree* (a real `symlinkSync` to `/etc`), *a missing project directory is refused
up front*.

## W-7 — A named but dead session silently reused another (fixed)

**Was.** `resolveParent` returned the last root session when the named session
was not live. A caller could name any session id and have its run parented to a
different conversation: the roles would appear in that session's subagent list,
and its `hoh_status` would report a run it never started.

**Now.** A named session must be live; otherwise the start is refused with a
message naming the session. Only a caller that names no session at all — the
`hoh_start` tool — falls back to the root session.

**Verified.** *a named session that is not live is refused instead of reusing a
root session*, *an unnamed session still falls back to the root session*.

## W-8 — Three smaller input-handling defects (fixed)

Found in the same pass; each is small, and each was a real way to get a wrong
outcome rather than an error.

| Defect | Was | Now |
|---|---|---|
| Non-integer iteration budget | `iterations: 3.5` or `"3"` silently became `defaultIterations`, so a caller got a different number of iterations than it asked for | a non-integer is refused |
| Unescaped prompt fence | the goal was spliced between bare `"""` fences, so a goal containing `"""` closed the block and the rest read as instructions to the role | the delimiter is escaped inside the goal, and the block is labelled as data that cannot change the role |
| Unbounded request body | `readBody` read whatever the host buffered (16 MiB) before the engine rejected it on length | the declared length and the actual text are both capped near the largest legal request |

`stateDir` was hardened the same way: it comes from profile YAML rather than a
request, but it is the other place a run writes, so a relative value is now
refused outright.

**Verified.** *a non-integer iteration budget is refused, not replaced by the
default*, *a goal cannot break out of its prompt fence* (all three roles).

---

# Part IV — Deliberately out of scope

Recorded so the boundary stays explicit. None of these is a bug; each is a scope
decision for a DSH-native port.

- **U-1 Read-only workspace copy and integrity hashing.** Upstream both prevents
  (an isolated workspace per read-only role) and detects (candidate hash before/after, failing the
  attempt as `invalid_candidate_mutation`, `runner.py:1592,1696,1718`). This
  plugin does neither at the workspace level. See A-3's residual.
- **U-2 External evaluator.** `LoopEngine.run` ends with
  `benchmark.evaluate(context, candidate)` (`core/loop_engine.py:76`), and
  `external_verifier` defaults on (`runner.py:985`). Here the QA Tester's verdict
  is the only judgement. Adding one would mean binding to a specific project's
  build/test commands — a benchmark concept this plugin does not have.
- **U-3 Per-role harness/model.** Upstream binds `harness`, `model`, and
  `reasoning_effort` per role. Here every role inherits the session's preset,
  provider, and model, and `reproducibility.json` records `model: null`.
- **U-4 Candidate chaining.** Upstream passes a `CandidateRef` and an optional
  `parent` between loops, with `warm_start_latest` (`runner.py:961`),
  `--resume-from` (:924), and `--seed-trial-dir` (:919). Here the carry-forward is
  the workspace plus the previous iteration's `plan.md`, `evidence.md`,
  `evidence.json`, and the Developer's summary, and a run always starts fresh.
- **U-5 Template-driven prompts.** Upstream renders four markdown templates
  (`development_brief.md`, `development_document.md`, `development_doc_delta.md`,
  `project_planner_prompt.md`) and compacts carried history to a character budget.
  Here the prompts are prose assembled in `src/prompts.js`; the carried history is
  a file-path hand-off, not a compacted packet. Upstream also versions documents
  by filename (`development_doc_v{index:03d}.md`,
  `core/documents.py:72`); here each iteration's `plan.md` lives in its own
  directory, which serves the same purpose by a different route.
- **U-6 Domain policies and benchmark adapters.** Upstream ships six
  `policies/*.md` documents plus a gamecraft benchmark adapter and Godot MCP
  tooling. This plugin is domain-neutral and ships none of it.
- **U-7 `attempts`, `n_concurrent`, job directories.** Upstream retries a task up
  to `attempts` (:911) and runs `n_concurrent` trials against `jobs_dir`
  (`runner.py:885,963`). Here one run is one sequential trial per session.
- **U-8 Idle timeout.** Upstream kills a role on wall-clock *or* idle timeout
  (`run_command_with_idle_timeout`, `core/execution.py:107`), defaulting to 1800 s
  for the Planner and the Tester and 900 s for the Developer
  (`runner.py:949,1040,1061`). Here only `phaseTimeoutSeconds` exists
  (default 3600), so a role that is alive but emitting nothing burns the full
  ceiling instead of being cut at the idle window.
- **U-9 demo-id evidence matrix and loop memory.** Upstream's evidence is
  benchmark-shaped and carries a cross-loop memory object (`build_loop_memory`,
  `core/evidence.py:430`) with `open_issues`, `verified_demo_claims`, and
  `next_loop_targets`. Here evidence is claim/gap shaped per iteration, and the
  "memory" is whatever the next Planner chooses to re-read.
- **U-10 Status taxonomy.** Upstream's outcome is a four-value `review_status`
  (`runner.py:145`: `pass` / `partial` / `fail` / `blocked`) over a six-value
  `tester_status` (`completed`, `failed`, `infrastructure_failed`,
  `invalid_candidate_mutation`, `invalid_mcp_coverage`, `invalid_report`), and it
  distinguishes "the candidate is wrong" from "the measurement failed"
  (`tester_failure_is_repairable`, `runner.py:429`). This plugin has a boolean
  plus a gap list, which cannot express `partial`, cannot express `blocked`, and —
  see W-1 — treats an absent verdict as a pass where upstream fails closed.
- **U-11 Atomic record writes.** Upstream writes every JSON record by creating a
  temp file, `fsync`-ing it, `os.replace`-ing it, then `fsync`-ing the directory
  (`core/documents.py:17-38`). This plugin uses a plain `writeFileSync`
  (`src/records.js:33`), so a crash mid-write can truncate `run.json` or
  `runtime_receipt.json`.

## Not read, and therefore not claimed

The adapter and harness layers (`adapters/gamecraft_bench/*`, `harnesses/*`,
≈9,500 lines) and the vendored Godot tooling were surveyed only far enough to
check the specific claims above. They are benchmark- and domain-specific, which
is why U-6 stays one line, but **"not read" is the honest status for anything
inside them** — this document is not a claim that nothing else exists there.

---

# Defects found by running it

Unit tests over a fake delegation service could not find these; real runs could.

| # | Symptom | Cause | Fix |
|---|---|---|---|
| D-1 | Every run died at its first delegation with `subagent depth 1 exceeds maxDepth 0`; three consecutive runs failed in the Planner. | `childMaxDepth` counts levels a role may open *below* itself and defaults to 0, but it was forwarded as `request.maxDepth`, which the service compares against the child's own **absolute** depth — already 1. | `absoluteRoleMaxDepth(childMaxDepth, parent)` = parent depth + 1 + extra. Pinned by *the configured recursion budget becomes the ABSOLUTE depth cap a role is started with*. |
| D-2 | A QA verdict arrived with `passed: true` **and** `blocker` gaps; the loop accepted it and never repaired. | `wantsRepair` trusted the `passed` flag alone, and the schema description invited the contradiction. | `acceptanceOf(verdict)` is now the single decision: acceptance needs the flag *and* no blocking gap. |
| D-3 | An iteration repaired into a pass still reported `partial`. | Completeness demanded that *every* tester verdict be accepted, so a superseded failing verdict kept the iteration open forever. | Completeness reads the **last** QA verdict, because a repair supersedes what triggered it. |

D-1 is the one that mattered most: with the default `childMaxDepth: 0`, **no run
could start at all**. The fake `ctx.subagents` in the test suite accepts any
`maxDepth`, so this class of defect only appears against the real service.

---

# Corrections this revision makes

The previous revision of this document was written in three passes, and the
earlier passes left errors in place. They are listed rather than silently fixed,
because "the document was wrong before" is itself part of the record.

| Earlier claim | What the code and upstream actually show |
|---|---|
| Receipt `max_depth` "is the **absolute** depth cap, which is 1 in the ordinary case", and a real run shows `max_depth: 1`. | `src/records.js` writes `config.childMaxDepth`, which is `0` — and all four recorded runs show `0`. The absolute cap (`1`) is computed in `spawnRole` and never recorded. **W-3.** |
| Role bindings are "serialized with upstream spellings (`workspace_access`, `max_depth`)". | Upstream `RoleBinding.to_dict` has **no** `max_depth`, and has a `tools{godot_mcp, godot_docs}` sub-object this plugin omits. Only `workspace_access` (and `role`/`harness`/`model`/`reasoning_effort`) match. **A-2.** |
| `npm test` runs "27 tests, including the ten alignment tests". | The count drifted with every fix: `31` (`13 + 9 + 9`) at the review baseline, `41` (`17 + 15 + 9`) after the review fixes. |
| "One real run, read as evidence" presented `hoh-20261023-140931-f877a7` as verification of A-1…A-6 after the D-2/D-3 fixes. | That run predates the current source: its last artifact is from 14:36, while `src/engine.js` and `src/contract.js` were last modified at 16:09 and 16:08. Its gaps are all `minor`, a severity **outside** `{blocker, high, medium, low}`, and every tester round is `round: 0`. It is evidence for A-1/A-2/A-3/A-6 and for *the absence* of repair — not for the repaired behaviour. |
| The old A-3 residual named only the missing read-only copy. | Upstream also **detects** mutation by hashing the candidate; this plugin neither prevents at workspace level nor detects. **U-1** and **A-3**. |
| The old document called `high` a non-blocking "polish" severity in its tests while the schema told the child that `high` blocks. | Both statements are still in the code; the document had not noticed the conflict. **W-4.** |

Two rules followed from this, now part of the review process:

1. **Read every `core/*.py`, not the ones whose names look relevant.** `policy.py`
   is 32 lines and encodes a whole evidence rule; it was invisible to a
   filename-based survey.
2. **Check the artifact's timestamp before citing it as evidence.** A run proves
   the code that produced it, not the code that sits in the working tree today.

---

# Evidence from the recorded runs

Four runs exist under `demo-proj/.hoh/runs/`. The largest,
`hoh-20261023-140931-f877a7`, is a three-iteration `repair-then-next` run at
`maxInnerRepairs: 2` over a single-file to-do app.

What it does establish:

- **A-1/A-2.** `runtime_receipt.json` carries nine events with monotonic
  `sequence`, `iteration_index`, per-event `duration_seconds` (309.2 s, 76.5 s,
  255.0 s, …), child session ids, and `planner → developer → tester` in each of
  the three iterations — every transition one the upstream graph admits.
- **A-3.** `roles.planner.preset` and `roles.tester.preset` are `hoh-readonly`;
  `roles.developer.preset` is `null`.
- **A-5/A-6.** Three `evidence.json` files, each with `schema_version: 1`, the
  iteration number, and one entry per tester round; one `reproducibility.json`
  with plugin `0.1.0`, Node `v24.21.0`, `darwin/arm64`, provider `spawn`,
  `git: null`, and a `sha256:` config hash.
- **W-3.** All four runs record `max_depth: 0` for all three roles, which is the
  configured grant — not the cap of `1` the roles actually ran under.

What it does **not** establish, and must stop being cited for:

- **A-4 (repair).** Every tester round is `round: 0`: no repair fired, because
  every verdict reported `passed: true`. Post-D-2 a `blocker` in that position
  opens a repair pass; this run cannot show that.
- **The severity vocabulary.** All gaps are `minor`, which is not in the
  upstream set the plugin now enforces.
- **W-1/W-2's fail-open paths.** No run exercised an absent verdict.

The run does prove something about the tests: the unit suite passed while D-1 was
live, because a fake `ctx.subagents` accepts any `maxDepth`. Treat CPU-side green
as necessary and a real run as sufficient.

---

# How to re-check this document

```sh
npm test        # 41 tests, 17 of them in tests/alignment.test.mjs
npm run smoke   # parses cordis.patch.yml and cross-checks the presets and tools
node <plugin-write-skill>/scripts/validate-names.mjs --manifest ./dsh-plugin.naming.json
```

For a finished run, read `<project>/.hoh/runs/<run-id>/`:

```
run.json                   the live snapshot the panel reads
runtime_receipt.json       A-1/A-2: the validated role sequence
reproducibility.json       A-6: the run's fingerprints
iteration-1/plan.md        the development document
iteration-1/evidence.md    the QA Tester's written evidence
iteration-1/evidence.json  A-5: the structured verdict, one per tester round
iteration-1/iteration.json the iteration record
```

When re-checking a claim, check the file's mtime against the run's, as the
corrections table above does. A run directory is a dated witness.

## Rules for the next revision

1. A mechanism belongs in **Part I** only if both the code and a test pin it. If
   one of the two is missing, it is a defect, and it belongs in Part III — a fixed
   defect stays there as a record with the test that now pins the fix, which is
   why W-1 … W-8 are still listed after being closed.
2. An item belongs in **Part II** only with the upstream behaviour it replaces
   written next to it, so a reader can judge the trade rather than trust the
   adjective "better".
3. Never describe a partially enforced mechanism as enforced. **A-3** is the
   worked example, and **W-3** is what happens when a field is described by what
   it should have held rather than by what it holds.
4. When an item moves buckets, update the at-a-glance table in the same edit; a
   stale summary row outlives the prose it summarizes.
