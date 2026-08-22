# Parallel pipelines

v2.0 could only run one pipeline at a time, and its tooling assumed so
implicitly rather than saying so. Every gate file in the working directory was
discovered by one glob, so any `gate-check` run touched every leaf in the tree:
concurrent leaves executed each other's CHECK commands, wrote each other's
evidence, and flipped each other's boxes. A leaf could certify a sibling it had
never looked at. The Stop hook had the mirror problem, blocking a finished
session because an unrelated pipeline's gates were unmet, and naming the
offending gate `G1`, an id that is only unique inside one file.

v2.1 gives every pipeline a **scope**. A scope is the unit of isolation: its own
gates, its own status log, its own loop-guard counter, its own file ownership
leases. Nothing in one scope can read, write or block another.

## Layout

```
.unlazy/
  <scope>/
    PLAN.md            contract + tree for this pipeline
    GATES.md           root and branch gates
    gates/leaf-*.md    one file per leaf
    status.log         append-only, this pipeline's events
    session            optional: the Claude Code session id that owns this scope
    hook-state.json    this pipeline's loop-guard counter
  locks/
    *.lease            file-ownership claims, across all scopes
    *.filelock         short-lived write locks
```

Add `.unlazy/` to `.gitignore`. The legacy layout (`GATES.md` and `gates/*.md`
directly in the working directory) still works unchanged for solo mode; you only
need `.unlazy/` once a second pipeline exists.

## Choosing the scope

Every tool call resolves exactly one scope, in this order:

1. `--scope <id>` on the command line.
2. `UNLAZY_SCOPE` in the environment. Set this once per dispatched pipeline and
   every call inside it is scoped without further thought.
3. The session binding: the id in `.unlazy/<scope>/session`, matched against the
   `session_id` a Stop hook receives. Write it with
   `gate-check.mjs --scope <id> --bind <session-id>`.
4. The only pipeline present, when there is exactly one.
5. The legacy layout, when `.unlazy/` does not exist.

**When several pipelines exist and none of the above resolves one, the tools
refuse rather than guess.** `gate-check` exits 2 with the list of candidates;
the Stop hook allows the stop and says why. Both are deliberate: silently
running every pipeline's checks is the bug this design exists to remove, and
blocking a session over gates it does not own is unactionable noise.

## Two ways to run pipelines side by side

**Separate worktrees, one pipeline each.** The default choice, and the only one
that also solves build contention. One `git worktree` per pipeline, each with
its own `.unlazy/<scope>/`, each with the Stop hook installed as
`--scope <id>`. Independent working copies mean parallel `npm run build` or
`cargo check` do not fight over one target directory, which on an I/O-bound
tree is the difference between real parallelism and two builds serialising on a
lock while both look busy.

**One working copy, several scopes.** Cheaper to set up, and correct as long as
leaves own disjoint files. Use it when the pipelines are mostly independent
reads or touch clearly separate directories. Claim ownership explicitly (below)
so "disjoint" is checked rather than assumed.

## File ownership as a lease, not a promise

`PLAN.md` has always said no two leaves may own the same file. Declare it in the
leaf's gates file and the claim becomes checkable:

```markdown
OWNS: src/api/**, tests/api/*.test.ts
```

```
node gate-check.mjs --scope api --leaf leaf-1.2.1 --claim
```

A claim that overlaps a lease held by any other leaf, in any scope, is refused
with exit 3 and names the holder:

```
CONFLICT src/shared/util.ts overlaps src/shared/** held by web/leaf-1
CLAIM REFUSED (1 conflict(s))
```

Overlap is decided on each glob's literal prefix, so `src/a/**` and `src/b/**`
are disjoint while `src/shared/**` and `src/shared/util.ts` are not. The test is
deliberately conservative: it can report a conflict a full glob intersection
would clear, never the reverse. A refused claim means the plan is wrong: fix
the split. Do not coordinate through hope.

Release at the end of a pipeline with `--release` (whole scope) or
`--release --leaf <name>` (one leaf).

## How many run at once is not this file's business

Ownership leases say which leaves *may* run together. They do not say how many
do, or in what order, and nothing here tries to: a dispatcher that launches
every ready leaf and starts whatever a returning leaf unblocks is strictly
better than any fixed batching this file could impose, and concurrent execution
of one leaf's own checks is a separate concern again. What the leases give that
layer is the guarantee it needs, which is that two leaves running at the same
time cannot be writing the same file.

## Writes are safe under concurrency

`gate-check` no longer writes back a whole-file snapshot taken before the checks
ran. It re-reads the file under a lock, applies only the gates *that run*
resolved, and replaces the file by atomic rename. A gate hand-edited by someone
else while checks were in flight survives; a reader never sees a half-written
file. Locks are created with `open(..., "wx")`, which is atomic on NTFS and
POSIX alike, and any lock older than five minutes is broken so a killed process
cannot wedge a pipeline.

The status log is appended with `appendFileSync`, never rewritten, so
concurrent leaves cannot lose each other's lines:

```
node gate-check.mjs --scope api --log "leaf-1.2.1 verified, 7/7 gates"
```

## What is still your job

- **Gate ids are unique per file, not per tree.** Tools report them qualified
  (`leaf-1.2.1:G3`), and that is the form to use in a report. Inside a file,
  `ABANDON: G3` still refers to that file's G3.
- **Ownership overlap is only checked for what you declare.** A leaf with no
  `OWNS:` header claims nothing and is trusted with everything.
- **Verification does not become optional because leaves ran concurrently.**
  Parallelism buys wall clock, nothing else. The parent still re-runs every
  leaf's checks; three layers of the hierarchy, unchanged.
