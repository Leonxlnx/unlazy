# Orchestrated mode: leaves as fresh agents

For tree depth 4+ or any build clearly beyond one sitting. The core insight:
the stall-at-80-percent failure is an end-of-long-context disease. Attention,
not time, is the scarce resource, and a fresh subagent per leaf resets it.

## The driver loop (rolling dispatch)

You (the main session) are the driver. You do not implement leaves; you
plan, dispatch, verify, and integrate. The loop is rolling, not lockstep:
leaves with no unmet dependencies are launched together, and each leaf that
returns and passes verification gates the dispatch of whatever it unblocks.

The contract in PLAN.md guarantees disjoint file ownership, so ready leaves
never contend on shared files. If two leaves ever need the same file, fix
the plan, do not coordinate through hope.

1. **Plan.** Write PLAN.md (contract, tree, gates file per leaf and branch)
   from templates/PLAN.md. This is the only step where the whole task must
   fit in one head. Mark every leaf's initial State as READY (or BLOCKED
   with the leaf it waits on in the Needs field) before dispatch begins.

2. **Dispatch all ready leaves.** A leaf is ready when its State is READY
   and every leaf in its Needs field is already Verified. Launch a subagent
   for *each* ready leaf, not just one. Each subagent's entire brief is:
   - the contract section of PLAN.md (not the whole file, not your history)
   - its own gates file, verbatim
   - the instruction: work the four passes until every gate is met with
     evidence, then stop; if a gate is impossible, ABANDON it with a reason.

   Update each dispatched leaf's State from READY to IN-FLIGHT in PLAN.md.

3. **Verify each leaf on return, never trust.** As each leaf returns, re-run
   its checks yourself against its specific file (scoped, not the whole tree):
   ```
   node <skill-dir>/scripts/gate-check.mjs --status gates/leaf-x.md
   ```
   For faster verification when several leaves return around the same time,
   pass multiple files and raise concurrency:
   ```
   node <skill-dir>/scripts/gate-check.mjs --jobs 4 --status gates/leaf-a.md gates/leaf-b.md
   ```
   Also rerun a spot-check of the CHECK commands by hand. A leaf that checked
   its own boxes without evidence gets sent back with the specific unmet
   gates named. This is the layer that makes self-certification worthless.

4. **Log and advance.** Append one line to PLAN.md's status log for the
   returned leaf. Flip its State to VERIFIED (or ABANDONED). Then look at
   every remaining BLOCKED leaf: if all the leaves in its Needs field are
   now VERIFIED, flip it to READY and immediately dispatch it (step 2). Do
   not wait for the rest of the in-flight batch. When all children of a
   branch are verified, work the branch's integration gates yourself (or
   dispatch an integration leaf for it).

5. **Report.** Only when the root's gates are met. Paste the ledger, N of N,
   with every ABANDON line surfaced, and re-measure every number you state.

## The rolling loop, as a loop

Read steps 2-4 as a loop, not a sequence you finish once:

```
while unverified leaves remain:
    dispatch every READY leaf you have not yet launched
    wait for the next leaf to return
    verify it (scoped gate-check, --jobs for batch returns)
    log the result; set its State in PLAN.md
    scan BLOCKED leaves; promote any now-unblocked to READY
    -> back to while-condition
```

The point: the wall-clock cost of a leaf that finishes early should not be
paid waiting for a sibling that finishes late. A leaf that returns and
unblocks a dependent should get that dependent running before you finish
your coffee, not after the rest of the batch.

## Parallelism and dependencies

Leaves whose file ownership is disjoint (the contract guarantees this) run
concurrently — that is now the default behavior of the dispatch step, not
an optional mode you have to remember to enable. Parallelism buys
wall-clock time, not token savings; do not use it as an excuse to skip
per-leaf verification. If two leaves ever need the same file, fix the plan,
do not coordinate through hope.

Dependencies are the exception to "launch all ready leaves now": a leaf is
not ready until every leaf named in its Needs field is Verified. Encode
dependencies in PLAN.md at plan time, not at dispatch time. Prefer zero
dependencies (split so leaves are independent); when a dependency is
unavoidable, make it a single-leaf dependency, never a chain longer than
two, because every link in a chain is an earlier wall-clock finish you give
up to sequentiality.

## Verification hierarchy

Three layers, weakest to strongest, each catching what the layer below
misses:

1. **Leaf self-check**: gate-check run by the leaf itself. Catches honest
   incompleteness, misses self-deception.
2. **Parent re-run**: the driver re-executes the checks, scoped to the
   leaf's own gates file. Catches self-deception and environment
   differences.
3. **Stop-hook** (Claude Code, optional): structurally blocks a session from
   ending while gates are unmet. Catches the driver itself drifting into
   report mode. It scans all gate files globally — correct for an exit
   gate, even though per-leaf verification is scoped.

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
