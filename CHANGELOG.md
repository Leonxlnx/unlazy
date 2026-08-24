# Changelog

## Unreleased, target 2.1.0

This section describes the current source tree. It does not claim that `2.1.0` has a Git tag or GitHub Release.

### Gate authoring

- Add `scripts/gate-lint.mjs`, a non-executing advisory audit of ledger quality. Warn on whole fixed-output commands, weak success vocabulary, shared-parser path ambiguity, activity titles, unmeasured manual numbers, and mostly manual ledgers without pretending to shell-parse chains or argv. Default warnings retain a `LINT OK` marker and exit `0`; `--strict` makes them fail. Reject unknown short and long options.

### Correctness and fail-closed behavior

- Replace positional-argument index arithmetic with a validating CLI parser. An explicitly named ledger is the only ledger targeted, regardless of option order.
- Use one strict ledger parser for the checker and Stop hook. Reject zero-gate ledgers, duplicate ids, partial runnable gates, invalid regular expressions, blank abandonment reasons, unknown abandonment ids, and unindented attributes. Validate CLI options and scope ids separately, and reject invalid `OWNS:` paths when claiming a lease.
- Ignore fenced examples, preserve CRLF or LF during updates, and insert a missing evidence line into an otherwise valid gate.
- Match CommonMark fence length, marker, indentation, and closing-line rules so nested shorter fences cannot expose example gates.
- Add `--reverify` so parent verification executes already checked runnable gates and removes completion when the oracle no longer passes.
- Require both process exit `0` and `EXPECT:` match. Include resolved shell, resolved working directory, exit status, match state, and a SHA-256/byte-count output fingerprint in persisted evidence; keep bounded raw diagnostics terminal-only on failure.
- Discard an in-flight result when the gate's bound oracle changes before writeback.
- Diagnose an indented `ABANDON:` instead of ignoring it. Attributes must be indented and `ABANDON:` must not be, so the natural formatting mistake previously left a gate unmet and the honest exit unexplained.
- Warn when a slash-wrapped `EXPECT:` containing an unescaped inner slash is read as a regular expression. A literal path silently became a pattern whose dots matched any character, and the wrapping slashes leave no way to express the literal.
- Treat gate abandonment as terminal handoff rather than successful completion. Checker modes now exit `1` with `HANDOFF REQUIRED`, parent `ALL MET` promotion cannot accept an abandoned child, and Stop allows exit with a bounded qualified-id message.
- Include scoped dispatch state in the primary gate reduction, so open, sealed, or abandoned waves can never coexist with `ALL MET`. Reject fabricated terminal histories, non-string handles/reasons, missing lifecycle timestamps, and impossible timestamp order.
- Sanitize repository-controlled dispatch diagnostics before they reach a host hook message, retain qualified abandonment handoffs in mixed block/release outcomes, and discard malformed per-session hook entries instead of failing open.
- Refuse status-log symlinks and swapped/non-regular targets before appending, including automatic dispatch audit events.
- Strip terminal controls and bidirectional overrides from repository-controlled checker diagnostics.
- Separate regular-expression worker startup from the 250ms match budget and cap concurrent match workers at four, so high `--jobs` values remain fail-closed without startup-induced false failures.

### Command trust and portability

- Add explicit `--approve` execution consent for ledger commands. Store approvals under `~/.unlazy/approved` by default, require the canonical owner-private store to remain outside the repository, reject linked/replaced/non-private records, and bind each approval to the absolute ledger and gate, command, expectation, resolved working directory and shell, timeout, output and regex limits, regex worker limits, platform, and inherited `PATH`.
- Add `--shell` with `UNLAZY_SHELL` fallback. Keep the platform shell as the final default and make inherited `PATH` behavior visible.
- Replace POSIX-only gate examples with repository-owned Node scripts and document Windows shell and PATH variance.
- On Windows timeouts, terminate an active `cmd.exe` tree with the drive-root `<drive>:\Windows\System32\taskkill.exe` only when `SystemRoot`, `WINDIR`, and `SystemDrive` agree. Bound the helper itself to one second, inspect every result, and fall back to the direct child without PATH lookup. Skip numeric-PID cleanup when Node has already observed leader exit, and independently settle after cleanup even when descendants retain pipes. The Windows CI path launches and reaps a real shell plus nested Node descendant.
- Keep a detached Node supervisor alive until each shell and inherited output stream closes. POSIX cleanup signals the group only while that exact supervisor still owns its PID/PGID, preventing a reused numeric group from being targeted without regressing descendant cleanup.
- Add [SECURITY.md](SECURITY.md) for command, environment, installer, hook, evidence, scope, and lease boundaries.
- Clarify that approval binds declared oracle text/environment, not called scripts or other transitive files, while `--status` and Stop report historical evidence until explicit `--reverify`.

### Orchestration and concurrency

- Add scoped pipelines under `.unlazy/<scope>/`, qualified gate ids, session binding, append-only status logging, and explicit scope discovery refusal when the target is ambiguous.
- Add repository-relative `OWNS:` declarations with `--claim` and `--release`. Serialize claim discovery and creation under one lock, reject unsafe paths, and use conservative overlap detection.
- Treat a scope/leaf identity as an exclusive lease owner so duplicate workers cannot both claim and later release the same logical lease.
- Describe scopes and leases as coordination rather than filesystem or process isolation.
- Add opt-in `--jobs <N>` rolling check concurrency while retaining sequential default behavior and deterministic ledger-order reporting.
- Add declared readiness states, real `node-*` branch paths, explicit dependencies, and rolling leaf dispatch to the plan and orchestration guide.
- Add atomic native dispatch waves that require every independent leaf to receive a distinct host start handle before the first return is accepted.
- Add auditable dispatch abandonment for irrecoverable partial launches. Preserve the reason and timestamps in state, make status non-successful, and keep abandoned waves visible without permanently blocking Stop.
- Make scoped `gate-check` the aggregate completion oracle for both ledgers and dispatch waves; per-wave status and the optional Stop hook are no longer required to prevent a false completion certificate.
- Add Codex and Claude Code launch adapters, incomplete-wave Stop-hook enforcement, and a measured worker-overlap regression without adding a model subprocess runner.
- Key Stop-hook progress state to the session and scope, serialize state changes, and retain unlazy's own six-block no-progress release.
- Compare resolved gate state between stops rather than raw ledger bytes. A comment, a reflowed line, or a rewritten evidence line no longer counts as progress, so the six-block release can fire for an agent that is editing without advancing.
- Compare canonical dispatch state and counts in the same guard, so timestamps and metadata do not impersonate launch progress.

### Installer, package, and documentation

- Identify installed hooks by an exact stable marker and constrained legacy script path so moved installations are repaired without claiming unrelated marker substrings. Verify an existing settings file through a no-follow descriptor before reading or backing it up.
- Validate settings container shapes, preserve unrelated entries, write atomically, and create `<settings-file>.unlazy.bak` before replacing an existing settings file.
- Repair matching hook commands whose managed type or timeout fields drifted, and return the documented infrastructure exit code when approval storage fails.
- Warn that local settings and `.unlazy/` should remain untracked and that `--shared` embeds a machine-specific absolute path.
- Keep Node 16 compatibility and zero runtime dependencies. Add a package test command and cross-platform CI.
- Add valid `agents/openai.yaml` metadata and keep `SKILL.md` focused through linked references.
- Add a revisioned PLAN contract inventory that maps every independently omittable required outcome and acceptance-changing constraint to an owner and observation, plus request rereads before fan-out and root completion.
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
- [#17](https://github.com/Leonxlnx/unlazy/pull/17): the read-only gate-quality linter, JSON output, strict mode, documentation, and regression harness by Daz Alderson
- [#18](https://github.com/Leonxlnx/unlazy/pull/18): atomic native dispatch waves, launch adapters, durable state, Stop integration, documentation, and tests by hangloose50
- [#20](https://github.com/Leonxlnx/unlazy/pull/20): the Windows process-tree timeout diagnosis and `taskkill /t` direction by Praveen Bishnoi
- [#24](https://github.com/Leonxlnx/unlazy/pull/24): fail-closed diagnosis of an indented `ABANDON:` by Daz Alderson
- [#25](https://github.com/Leonxlnx/unlazy/pull/25): semantic Stop-hook progress hashing by Daz Alderson
- [#26](https://github.com/Leonxlnx/unlazy/pull/26): shared-parser warning for ambiguous path-shaped EXPECT regexes by Daz Alderson
- [#21](https://github.com/Leonxlnx/unlazy/issues/21) and [#23](https://github.com/Leonxlnx/unlazy/issues/23): abandonment-promotion and contract-omission reports and reproducers by theislampill

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
