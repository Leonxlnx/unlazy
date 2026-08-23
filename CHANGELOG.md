# Changelog

## Unreleased, target 2.1.0

This section describes the current source tree. It does not claim that `2.1.0` has a Git tag or GitHub Release.

### Correctness and fail-closed behavior

- Replace positional-argument index arithmetic with a validating CLI parser. An explicitly named ledger is the only ledger targeted, regardless of option order.
- Use one strict ledger parser for the checker and Stop hook. Reject zero-gate ledgers, duplicate ids, partial runnable gates, invalid regular expressions, blank abandonment reasons, and unindented attributes. Diagnose an unknown abandonment id without resolving any gate. Validate CLI options and scope ids separately, and reject invalid `OWNS:` paths when claiming a lease.
- Ignore fenced examples, preserve CRLF or LF during updates, and insert a missing evidence line into an otherwise valid gate.
- Match CommonMark fence length, marker, indentation, and closing-line rules so nested shorter fences cannot expose example gates.
- Add `--reverify` so parent verification executes already checked runnable gates and removes completion when the oracle no longer passes.
- Require both process exit `0` and `EXPECT:` match. Include resolved shell, resolved working directory, exit status, and decisive output in evidence and diagnostics.
- Discard an in-flight result when the gate's bound oracle changes before writeback.

### Command trust and portability

- Add explicit `--approve` execution consent for ledger commands. Store approvals under `~/.unlazy/approved` by default, require any override to remain outside the repository, and bind each approval to the absolute ledger and gate, command, expectation, resolved working directory and shell, timeout, output and regex limits, platform, and inherited `PATH`.
- Add `--shell` with `UNLAZY_SHELL` fallback. Keep the platform shell as the final default and make inherited `PATH` behavior visible.
- Replace POSIX-only gate examples with repository-owned Node scripts and document Windows shell and PATH variance.
- Add [SECURITY.md](SECURITY.md) for command, environment, installer, hook, evidence, scope, and lease boundaries.

### Orchestration and concurrency

- Add scoped pipelines under `.unlazy/<scope>/`, qualified gate ids, session binding, append-only status logging, and explicit scope discovery refusal when the target is ambiguous.
- Add repository-relative `OWNS:` declarations with `--claim` and `--release`. Serialize claim discovery and creation under one lock, reject unsafe paths, and use conservative overlap detection.
- Treat a scope/leaf identity as an exclusive lease owner so duplicate workers cannot both claim and later release the same logical lease.
- Describe scopes and leases as coordination rather than filesystem or process isolation.
- Add opt-in `--jobs <N>` rolling check concurrency while retaining sequential default behavior and deterministic ledger-order reporting.
- Add declared readiness states, real `node-*` branch paths, explicit dependencies, and rolling leaf dispatch to the plan and orchestration guide.
- Key Stop-hook progress state to the session and scope, serialize state changes, and retain unlazy's own six-block no-progress release.

### Installer, package, and documentation

- Identify installed hooks by a stable marker and actual script path so moved installations are repaired and uninstall removes only unlazy handlers.
- Validate settings container shapes, preserve unrelated entries, write atomically, and create `<settings-file>.unlazy.bak` before replacing an existing settings file.
- Repair matching hook commands whose managed type or timeout fields drifted, and return the documented infrastructure exit code when approval storage fails.
- Warn that local settings and `.unlazy/` should remain untracked and that `--shared` embeds a machine-specific absolute path.
- Keep Node 16 compatibility and zero runtime dependencies. Add a package test command and cross-platform CI.
- Add valid `agents/openai.yaml` metadata and keep `SKILL.md` focused through linked references.
- Correct research titles, dates, ordering, and metric interpretation. Add a reproducibility protocol and label the historical six-run comparison's missing raw artifacts.

### Community work integrated

- [#2](https://github.com/Leonxlnx/unlazy/pull/2): re-verification, parser diagnostics, CRLF preservation, evidence insertion, fenced-example handling, and validation ideas
- [#3](https://github.com/Leonxlnx/unlazy/pull/3): the explicit-file positional fix
- [#5](https://github.com/Leonxlnx/unlazy/pull/5): rolling dispatch and bounded `--jobs`
- [#8](https://github.com/Leonxlnx/unlazy/pull/8): stable hook identification and moved-install repair
- [#9](https://github.com/Leonxlnx/unlazy/pull/9): explicit approval for executable checks
- [#10](https://github.com/Leonxlnx/unlazy/pull/10): scoped pipelines, shared parsing, ownership leases, session routing, and the first regression suite
- [#14](https://github.com/Leonxlnx/unlazy/pull/14): the COLM 2026 test-time-scaling source
- [#15](https://github.com/Leonxlnx/unlazy/pull/15): negative controls, supplied-number measurement, and manual-gate review guidance; the single-run risk observation is intentionally not generalized

## 2.0.0 source milestone, 2026-08-10

Moved completion enforcement from prose into gate files, runnable checks, evidence, and an optional Claude Code Stop hook.

- Reframed the Depth Tree as decomposition and integration rather than an arithmetic effort multiplier.
- Added rule zero: write acceptance gates before real work.
- Added the original zero-dependency checker, Stop hook, and installer.
- Added solo and orchestrated workflows, per-leaf and per-branch ledgers, parent verification guidance, and final report remeasurement.
- Split detailed method, gate, orchestration, and token guidance into references for progressive disclosure.

The exploratory six-run comparison that informed this milestone is not reproducible from the repository because its raw artifacts were not retained. See [research/validation-protocol.md](research/validation-protocol.md).

## 1.0.0 source milestone, 2026-08-10

- Added the original instruction-only Depth Tree method.
- Added behavioral rules against premature completion, silent scope reduction, and unmeasured final claims.
- Added installation and related-research documentation.
