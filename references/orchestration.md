# Orchestrated mode: leaves as fresh agents

For tree depth 4+ or any build clearly beyond one sitting. The core insight:
the stall-at-80-percent failure is an end-of-long-context disease. Attention,
not time, is the scarce resource, and a fresh subagent per leaf resets it.

## The driver loop

You (the main session) are the driver. You do not implement leaves; you
plan, dispatch, verify, and integrate.

1. **Plan.** Pick a scope id for this pipeline and write
   `.unlazy/<scope>/PLAN.md` from `templates/PLAN.md`: contract, tree, one gates
   file per leaf and branch, each leaf declaring the files it `OWNS:`. This is
   the only step where the whole task must fit in one head.
2. **Claim ownership before dispatching.**
   ```
   node gate-check.mjs --scope <id> --leaf <leaf> --claim   # per leaf
   ```
   A refused claim means two leaves want the same file: fix the split before
   dispatching anything. Everything downstream of here assumes disjoint
   ownership, so this is the step that makes the assumption true.
3. **Dispatch the leaves that are ready.** One subagent per leaf, each with a
   brief that is only:
   - the contract section of PLAN.md (not the whole file, not your history)
   - its own gates file, verbatim
   - `UNLAZY_SCOPE=<id>` and the exact `gate-check` invocation to use
   - the instruction: work the four passes until every gate is met with
     evidence, then stop; if a gate is impossible, ABANDON it with a reason.

   Leaves dispatched together own disjoint files by construction, so they
   cannot conflict. Where the harness offers per-agent worktree isolation, use
   it: it also stops parallel builds from contending over one target directory.
4. **Verify, never trust.** As each leaf returns, re-run *its* checks yourself:
   ```
   node gate-check.mjs --scope <id> .unlazy/<id>/gates/leaf-x.md --status
   ```
   and spot-check a CHECK command by hand. A leaf that checked its own boxes
   without evidence gets sent back with the specific unmet gates named, in
   qualified form (`leaf-1.2.1:G3`). This is the layer that makes
   self-certification worthless. Verification is per leaf, so it starts the
   moment a leaf returns. Do not wait for the others.
5. **Log and advance.**
   ```
   node gate-check.mjs --scope <id> --log "leaf-1.2.1 verified, 7/7"
   ```
   Dispatch whatever the returned leaf unblocks. When all children of a branch
   are verified, work the branch's integration gates yourself (or dispatch an
   integration leaf).
6. **Report.** Only when the root's gates are met. Release the leases
   (`--release`), paste the ledger, N of N, with every ABANDON line surfaced,
   and re-measure every number you state.

## Parallelism

Leaves whose `OWNS:` globs are disjoint can be dispatched at the same time, and
the lease check is what turns that from an assumption into a fact. This file
does not decide how many run at once: that is the dispatcher's business.

Parallelism buys wall-clock time, not token savings, and never excuses skipping
per-leaf verification. Running several pipelines at once, as opposed to several
leaves of one pipeline, is a scope-per-pipeline question; see
[parallel.md](parallel.md).

## Verification hierarchy

Three layers, weakest to strongest, each catching what the layer below
misses:

1. **Leaf self-check**: gate-check run by the leaf itself, scoped to its own
   gates file. Catches honest incompleteness, misses self-deception.
2. **Parent re-run**: the driver re-executes the checks. Catches
   self-deception and environment differences.
3. **Stop-hook** (Claude Code, optional): structurally blocks a session from
   ending while *this pipeline's* gates are unmet. Catches the driver itself
   drifting into report mode. Install it with `--scope <id>` so it guards the
   pipeline this session owns and no other.

Prose discipline is layer zero and it is the weakest; that is the lesson v2
is built on. Prefer moving any repeated judgment call up this hierarchy:
if you find yourself re-checking the same thing twice by reading, write a
CHECK command for it.

## Model and effort tiering

Where the harness allows choosing a model or reasoning effort per subagent,
tier by leaf type. Mechanical leaves (rename sweeps, fixture generation,
applying a decided pattern across files) go to a cheaper model or lower
effort. Design leaves, integration branches, and every verification pass
stay on the strong model. The driver stays on the strong model always; a
weak driver invalidates every verification above layer one.

## When NOT to orchestrate

Below roughly half an hour of real work, subagent overhead (context
re-establishment per leaf) costs more than it buys. Stay solo: one GATES.md,
one session, same discipline, no `.unlazy/` directory needed. The gates still do
their job; you just skip the dispatch machinery.
