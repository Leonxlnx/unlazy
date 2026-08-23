# Security model

Unlazy executes repository-described checks. Its safety boundary is explicit review and approval, not command sandboxing.

## `CHECK:` lines are code

`gate-check.mjs` runs each `CHECK:` through a shell with the checker's user permissions and inherited environment. A command can access files, network connections, credentials, and developer tools available to that process.

Before using an inherited ledger:

1. Run `node <skill-dir>/scripts/gate-check.mjs --status <gate-file>` to parse and display status without executing checks.
2. Read every `CHECK:`, `EXPECT:`, and `CWD:`. Inspect any script called by a check, including generated or ignored files.
3. Determine the shell from `--shell`, `UNLAZY_SHELL`, or the platform default, and inspect the inherited `PATH`. For a new oracle with no exact approval, normal mode prints the resolved values without running it. Normal mode is not a universal dry run because an existing exact approval permits execution.
4. Run with `--approve` only when the complete resolved oracle is expected and understood.

Approval records live under `~/.unlazy/approved` by default. `UNLAZY_APPROVAL_DIR` may select another real directory, but the checker rejects a directory inside the repository. An approval is specific to the absolute ledger and gate, exact command and expectation, resolved working directory and shell, timeout, output and regex limits, platform, and full inherited `PATH`. A change to any bound input requires review and approval again. An approval is consent to execute; it is not evidence that the command matches the English gate title.

Approval does not snapshot files that a command invokes. If a referenced script, generated file, executable, or dependency changes while the approved command text remains the same, inspect it again before running the command.

Approval and lease locks fail closed instead of being stolen automatically. If an owning process terminates unexpectedly, verify the PID recorded in that specific lock is no longer running and that no operation can still own it before removing the abandoned lock manually. Do not bulk-delete lock directories while unlazy is active.

Do not run untrusted checks merely to learn what they do. Review them as source first. Use a disposable environment or stronger sandbox when source trust is uncertain.

## Shell and environment

Shell resolution follows `--shell`, then `UNLAZY_SHELL`, then Node's platform default. The child inherits the current environment, including `PATH`. Changing the terminal used to launch unlazy can change which external tools resolve, especially on Windows.

Prefer repository-owned Node scripts and explicit `CWD:` values. A shell override does not install missing utilities, clean the environment, or restrict command access. The execution transcript shows the resolved `PATH`, capped for display. Persisted evidence includes resolved shell, working directory, exit status, a short `PATH` fingerprint, and decisive output so environment differences remain visible without storing the full machine-specific path.

See [references/gates.md](references/gates.md) for the full shell and success contract.

## Scopes and leases are not a sandbox

Scopes limit unlazy's gate discovery, log target, hook association, and lease labels. Ownership leases coordinate tools that voluntarily use the protocol. Neither mechanism prevents a process from reading or writing another path.

Separate worktrees can reduce ordinary path contention, but they may still share external caches and services. Use operating-system, container, or virtual-machine isolation for untrusted code. See [references/parallel.md](references/parallel.md).

## Stop hook and local state

The optional Claude Code Stop hook scans ledgers and writes progress state. It does not execute `CHECK:` commands. It emits Claude Code's documented top-level block decision while the resolved session pipeline has unmet gates and releases after unlazy's own six no-progress blocks.

Runtime and binding files live under `.unlazy/` in scoped mode. Legacy mode may use `.unlazy-hook-state.json`. Keep both paths in the project's ignore rules. Session ids in bindings are routing values, not secrets or authentication tokens.

## Installer targets and privacy

The installer changes Claude Code settings only after explicit invocation:

- Default: `.claude/settings.local.json` in the current project
- `--global`: the current user's Claude Code settings
- `--shared`: `.claude/settings.json` in the project

The installed hook command contains the absolute Node executable and the absolute path to this copy of `stop-hook.mjs`. Those paths can expose local directory names. They also make `--shared` non-portable unless every collaborator has matching paths. Prefer the default local target and keep `.claude/settings.local.json` in the project's ignore rules. Review the diff before committing any Claude settings file.

Install and uninstall preserve unrelated hooks. The installer refuses malformed or unsupported settings shapes instead of replacing them. It writes atomically and creates `<settings-file>.unlazy.bak` beside an existing settings file before replacement.

## Evidence and logs

Command output can contain private paths or other sensitive text. Gate evidence is deliberately capped, but it is still written into the ledger. Design checks to emit a concise success marker and avoid printing secrets. Review ledgers and status logs before committing or sharing them.

Unlazy does not intentionally collect telemetry or send approval, gate, or hook-state records to a service. A `CHECK:` command can perform its own network or logging activity because it is arbitrary code.

## Reporting a vulnerability

For ordinary defects, open a GitHub issue with a minimal reproduction. For a vulnerability whose reproduction would expose a secret or enable abuse, use GitHub's private vulnerability reporting for this repository if it is available. If it is not available, open a minimal issue asking the maintainer for a private contact method and omit sensitive details until a private channel exists.
