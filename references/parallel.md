# Parallel pipelines and leaves

Scopes and ownership leases coordinate cooperating unlazy processes. They prevent accidental cross-certification and refuse declared ownership overlap. They do not sandbox shell commands, enforce operating-system permissions, or stop a process that ignores the protocol from writing any file.

## Layout

```text
.unlazy/
  <scope>/
    PLAN.md
    GATES.md
    gates/
      leaf-*.md
      node-*.md
    status.log
    session
    hook-state.json
  locks/
```

Keep `.unlazy/` untracked. The legacy single-pipeline layout, `GATES.md` plus `gates/*.md` at the project root, remains available for solo work.

## Scope resolution

A scoped checker invocation selects one pipeline in this order:

1. `--scope <id>`
2. `UNLAZY_SCOPE`
3. the only scope present
4. the legacy layout when no scoped pipeline exists

The Stop hook can additionally use the current Claude Code `session_id` binding written by `--bind`. A binding associates a session with a scope; it is not authentication.

When several scopes exist and none resolves, the checker refuses instead of running every ledger. The Stop hook allows the stop with a diagnostic instead of blocking a session on an unknown pipeline.

Use scope ids that match `[A-Za-z0-9][A-Za-z0-9._-]{0,63}` and are not `.` or `..`. Do not use separators, traversal, or absolute paths.

## What a scope isolates

A scope limits unlazy's own:

- default gate discovery
- status log target
- Stop-hook resolution and progress state
- lease owner label

A scope does not limit a `CHECK:` process. Checks inherit ambient operating-system access and can read or write outside the scope. Use separate worktrees or stronger process isolation when commands themselves must be isolated.

## Ownership declarations

Declare repository-relative paths before the first gate:

```markdown
OWNS: src/api/**, tests/api/**
```

Reject absolute paths and any path containing a `..` traversal segment. Every leaf dispatched concurrently must declare all paths it may modify and claim them before work:

```text
node <skill-dir>/scripts/gate-check.mjs --scope api --leaf leaf-1.2.1 --claim
```

Claiming checks all existing leases and writes the new lease while holding one global lease lock. Two simultaneous conflicting claims cannot both succeed. A claim is all-or-nothing.

A scope/leaf label is itself exclusive while its lease exists. Repeating the same claim is refused; release that exact leaf before claiming it again. This prevents two workers dispatched with the same logical identity from both believing they own one lease.

Lock directories contain JSON owner metadata. Unlazy deliberately does not auto-break an apparently stale lock, because deleting a live owner's path can let two successors enter at once. If a process dies while holding a lock, first verify that its recorded process is no longer running and that no unlazy operation could still own the lock, then remove only that specific abandoned lock manually. Never clear the whole lock directory while work is active. Approval-record locks use the same recovery rule.

Overlap detection is deliberately conservative. It may reject two globs that a full intersection engine could prove disjoint, especially globs with mid-segment wildcards. It must not clear an uncertain pair as safe. Treat over-conflict as a prompt to use simpler disjoint paths or sequential dispatch.

Examples:

| First declaration | Second declaration | Result |
|---|---|---|
| `src/api/**` | `src/web/**` | disjoint |
| `src/shared/**` | `src/shared/util.mjs` | conflict |
| `src/a*.mjs` | `src/ab*.mjs` | conflict because intersection is possible |
| `**` | `docs/**` | conflict |

Leases cover only declared paths and only participants that honor them. They are coordination records, not write isolation.

Release a leaf or whole scope after parent verification:

```text
node <skill-dir>/scripts/gate-check.mjs --scope api --release --leaf leaf-1.2.1
node <skill-dir>/scripts/gate-check.mjs --scope api --release
```

An unknown `--leaf` is an error. The checker never silently falls back to the first ledger.

## Concurrent ledger updates

The checker serializes each gate-file update and commits it atomically. Before applying a completed check, it re-reads the ledger and confirms that the gate id and oracle fields still match what ran. If the command, expectation, working directory, or other bound oracle field changed in flight, the stale result is discarded.

Preserve the ledger's original LF or CRLF style. Insert a missing evidence line without changing unrelated content. Keep result output deterministic in gate order even when `--jobs <N>` executes checks concurrently.

The status log is append-only:

```text
node <skill-dir>/scripts/gate-check.mjs --scope api --log "leaf-1.2.1 verified"
```

Append-only logging reduces lost updates; it does not replace the live state fields in `PLAN.md`.

## Session-keyed hook state

The Stop hook keys progress state to the resolved scope and current session. Concurrent hook calls serialize their state update. Completion or disappearance of the ledger clears obsolete state. One session cannot consume another session's six no-progress blocks.

The hook may be pinned with installer `--scope` or resolve a session binding written by:

```text
node <skill-dir>/scripts/gate-check.mjs --scope api --bind <session-id>
```

Do not treat a stored session id as a secret or identity proof.

## Choose the right isolation level

- Use one working tree and several scopes for read-heavy work or leaves with simple disjoint ownership.
- Use one worktree per pipeline when worktree-local output or generated files would collide. Configure separate cache directories when cache writes can conflict; worktrees do not isolate external caches or services.
- Use operating-system or container isolation for untrusted commands. Unlazy approval and leases are not a sandbox.

Parallelism changes wall-clock time, not the evidence standard. Parent re-verification and branch integration remain required.
