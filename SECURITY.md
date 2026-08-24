# Security model

Unlazy executes repository-described checks. Its safety boundary is explicit review and approval, not command sandboxing.

## `CHECK:` lines are code

`gate-check.mjs` runs each `CHECK:` through a shell with the checker's user permissions and inherited environment. A command can access files, network connections, credentials, and developer tools available to that process.

Before using an inherited ledger:

1. Run `node <skill-dir>/scripts/gate-check.mjs --status <gate-file>` to parse and display status without executing checks.
2. Read every `CHECK:`, `EXPECT:`, and `CWD:`. Inspect any script called by a check, including generated or ignored files.
3. Determine the shell from `--shell`, `UNLAZY_SHELL`, or the platform default, and inspect the inherited `PATH`. For a new oracle with no exact approval, normal mode prints the resolved values without running it. Normal mode is not a universal dry run because an existing exact approval permits execution.
4. Run with `--approve` only when the complete resolved oracle is expected and understood.

Approval records live under `~/.unlazy/approved` by default. `UNLAZY_APPROVAL_DIR` may select another directory only when it is a real, owner-private directory whose canonical target is outside the canonical repository root. The checker rejects symlinked stores and accepts a record only through a no-follow descriptor that still names the same owner-private, single-link regular file after reading. An approval is specific to the absolute ledger and gate, exact command and expectation, resolved working directory and shell, timeout, output and regex limits, regex startup/concurrency limits, platform, and full inherited `PATH`. A change to any bound input requires review and approval again. An approval is consent to execute; it is not evidence that the command matches the English gate title.

Approval does not snapshot files that a command invokes. If a referenced script, generated file, executable, fixture, or dependency changes while the approved command text remains the same, the old approval can still authorize the changed bytes. Inspect those dependencies again before running the command. `--status` and the Stop hook report historical ledger state; neither revalidates artifacts. Run `--reverify` after dependency or input changes. When a workflow needs machine-enforced dependency currentness, put the expected dependency digests directly in approval-bound `CHECK:` text and validate them with a separately trusted tool or runtime. That remains user-designed coverage, not transitive tracing by unlazy.

Approval and lease locks fail closed instead of being stolen automatically. If an owning process terminates unexpectedly, verify the PID recorded in that specific lock is no longer running and that no operation can still own it before removing the abandoned lock manually. Do not bulk-delete lock directories while unlazy is active.

Do not run untrusted checks merely to learn what they do. Review them as source first. Use a disposable environment or stronger sandbox when source trust is uncertain.

## Shell and environment

Shell resolution follows `--shell`, then `UNLAZY_SHELL`, then Node's platform default. The child inherits the current environment, including `PATH`. Changing the terminal used to launch unlazy can change which external tools resolve, especially on Windows.

Prefer repository-owned Node scripts and explicit `CWD:` values. A shell override does not install missing utilities, clean the environment, or restrict command access. The execution transcript shows the resolved `PATH`, capped for display. Persisted evidence includes resolved shell, working directory, exit status, a short `PATH` fingerprint, the match result, and a SHA-256/byte-count fingerprint of successful output. Raw successful output is not echoed or written to the ledger. Failure diagnostics remain console-only, bounded, and stripped of terminal control and bidirectional-override characters.

Regular-expression expectations run in at most four disposable workers. A separate five-second worker-startup limit applies before the 250ms match budget begins, so high `--jobs` concurrency cannot consume the backtracking budget merely by delaying worker startup. A timed-out worker is terminated and cannot certify a gate.

See [references/gates.md](references/gates.md) for the full shell and success contract.

## Scopes and leases are not a sandbox

Scopes limit unlazy's gate discovery, log target, hook association, dispatch waves, and lease labels. Ownership leases and dispatch launch barriers coordinate tools that voluntarily use the protocol. Neither mechanism prevents a process from reading or writing another path.

Separate worktrees can reduce ordinary path contention, but they may still share external caches and services. Use operating-system, container, or virtual-machine isolation for untrusted code. See [references/parallel.md](references/parallel.md).

## Stop hook and local state

The optional Claude Code Stop hook scans ledgers and dispatch state, then writes progress state. It does not execute `CHECK:` commands, revalidate old evidence, or create agent sessions. It emits Claude Code's documented top-level block decision while the resolved session pipeline has unmet gates or incomplete dispatch waves and releases after unlazy's own six no-progress blocks. Gate or dispatch abandonment is non-successful handoff state: Stop preserves a bounded `HANDOFF REQUIRED` system message in pure, mixed-blocking, and release outcomes. Repository-derived diagnostics are control-stripped and capped, and free-form abandonment reasons are never copied into the privileged message.

Runtime, binding, dispatch, and append-only audit files live under `.unlazy/` in scoped mode. Legacy mode may use `.unlazy-hook-state.json`. State writes reject symlink directories and targets; status append also rejects multi-link files and verifies that its opened descriptor still names the same single-link regular file before writing. Keep both paths in the project's ignore rules. Session ids in bindings and native agent ids in dispatch waves are routing values, not secrets or authentication tokens.

Each check runs beneath a detached Node supervisor that remains the process-group leader until the shell and every inherited stdout/stderr descriptor close. POSIX group cleanup is attempted only while that exact supervisor is still observed live; after exit, its numeric PID/PGID is never signalled because it may have been reused. On Windows timeout cleanup, unlazy accepts only the drive-root `<drive>:\Windows\System32\taskkill.exe` when the host-provided `SystemRoot`, `WINDIR`, and `SystemDrive` values agree; arbitrary, missing, or inconsistent roots are rejected, and it never searches the check's current directory or `PATH`. These launcher environment values are a consistency boundary, not cryptographic proof of OS identity. If the location cannot be established, cleanup falls back to the already-held child handle and the checker still settles on its own bounded timer. A successful signal request is not treated as proof of process exit.

## Installer targets and privacy

The installer changes Claude Code settings only after explicit invocation:

- Default: `.claude/settings.local.json` in the current project
- `--global`: the current user's Claude Code settings
- `--shared`: `.claude/settings.json` in the project

The installed hook command contains the absolute Node executable and the absolute path to this copy of `stop-hook.mjs`. Those paths can expose local directory names. They also make `--shared` non-portable unless every collaborator has matching paths. Prefer the default local target and keep `.claude/settings.local.json` in the project's ignore rules. Review the diff before committing any Claude settings file.

Install and uninstall preserve unrelated hooks. New handlers carry an exact managed marker; legacy handlers are recognized only by an exact old marker/path shape, never a substring in an unrelated command. The installer opens existing settings without following links, verifies that the descriptor still names the same single-link regular file, and refuses malformed or unsupported settings shapes instead of replacing them. It writes atomically and creates `<settings-file>.unlazy.bak` beside an existing settings file before replacement.

## Evidence and logs

Command output can contain private paths or other sensitive text. Successful output is consumed only for matching and then represented by a digest and byte count; it is not copied into terminal success lines or gate evidence. Failure diagnostics are still visible in the local terminal, so checks must not emit secrets on either path. Dispatch state contains timestamps and opaque host handles. Never put prompts, credentials, or result bodies in a handle. Design checks to emit a concise success marker and avoid printing secrets. Review ledgers, dispatch state, and status logs before committing or sharing them.

A sealed wave proves only that the host returned a distinct native start handle for every declared leaf before Unlazy accepted a return. It does not prove exact CPU overlap, worker honesty, filesystem isolation, successful gates, or correct integration.

Unlazy does not intentionally collect telemetry or send approval, gate, or hook-state records to a service. A `CHECK:` command can perform its own network or logging activity because it is arbitrary code.

## Reporting a vulnerability

For ordinary defects, open a GitHub issue with a minimal reproduction. For a vulnerability whose reproduction would expose a secret or enable abuse, use GitHub's private vulnerability reporting for this repository if it is available. If it is not available, open a minimal issue asking the maintainer for a private contact method and omit sensitive details until a private channel exists.
