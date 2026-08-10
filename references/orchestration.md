# Orchestrated mode: leaves as fresh agents

For tree depth 4+ or any build clearly beyond one sitting. The core insight:
the stall-at-80-percent failure is an end-of-long-context disease. Attention,
not time, is the scarce resource, and a fresh subagent per leaf resets it.

## The driver loop

You (the main session) are the driver. You do not implement leaves; you
plan, dispatch, verify, and integrate.

1. **Plan.** Write PLAN.md (contract, tree, gates file per leaf and branch)
   from templates/PLAN.md. This is the only step where the whole task must
   fit in one head.
2. **Dispatch one leaf.** Spawn a subagent whose entire brief is:
   - the contract section of PLAN.md (not the whole file, not your history)
   - its own gates file, verbatim
   - the instruction: work the four passes until every gate is met with
     evidence, then stop; if a gate is impossible, ABANDON it with a reason.
3. **Verify, never trust.** When the leaf returns, re-run its checks
   yourself: `node <skill-dir>/scripts/gate-check.mjs --status gates/leaf-x.md`
   and rerun a spot-check of the CHECK commands. A leaf that checked its own
   boxes without evidence gets sent back with the specific unmet gates named.
   This is the layer that makes self-certification worthless.
4. **Log and advance.** Append one line to PLAN.md's status log. Dispatch the
   next leaf. When all children of a branch are verified, work the branch's
   integration gates yourself (or dispatch an integration leaf for it).
5. **Report.** Only when the root's gates are met. Paste the ledger, N of N,
   with every ABANDON line surfaced, and re-measure every number you state.

## Parallelism

Leaves whose file ownership is disjoint (the contract guarantees this) can
run concurrently if the harness supports parallel subagents. Parallelism
buys wall-clock time, not token savings; do not use it as an excuse to skip
per-leaf verification. If two leaves ever need the same file, fix the plan,
do not coordinate through hope.

## Verification hierarchy

Three layers, weakest to strongest, each catching what the layer below
misses:

1. **Leaf self-check**: gate-check run by the leaf itself. Catches honest
   incompleteness, misses self-deception.
2. **Parent re-run**: the driver re-executes the checks. Catches
   self-deception and environment differences.
3. **Stop-hook** (Claude Code, optional): structurally blocks a session from
   ending while gates are unmet. Catches the driver itself drifting into
   report mode.

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
one session, same discipline. The gates still do their job; you just skip
the dispatch machinery.
