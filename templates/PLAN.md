# Plan: <task>

Scope: <validated pipeline id; store this file at .unlazy/<scope>/PLAN.md>
Depth: tree <N>
Mode: orchestrated

## Contract

Decide before fan-out:

- Interfaces: <signatures, schemas, formats, integration points>
- Ownership: <one complete set of repository-relative paths per leaf; no absolute paths, traversal, or concurrent overlap>
- Dependencies: <leaf ids that must be VERIFIED first>
- Host launch mode: <Codex native subagents | Claude background Agents | Claude Dynamic Workflow | sequential fallback>
- Wave policy: <which independent READY leaves launch together and the maximum host concurrency>
- Toolchain: <runtime versions, shell, working-directory rules, test commands>
- Conventions: <naming, errors, compatibility, formatting>
- Manual review: <owner and evidence standard for consequential manual gates>

## Current contract inventory

Contract revision: 1. Before fan-out, reread the original request and current amendments. Record every independently omittable required outcome and every constraint that changes acceptance; do not copy credentials, private text, or unrelated context.

| ID | Required outcome or constraint | Owner | Observing gate or manual review | Disposition | Revision |
|---|---|---|---|---|---|
| C1 | <concise paraphrase> | <leaf/node> | <qualified gate/reviewer> | ACTIVE | 1 |

Use stable ids. On an amendment, increment the revision and reconcile every affected row before dispatch or completion credit. `ACTIVE` is complete only with a current owner and observation. `ABANDONED`, `DEFERRED`, and `OWNER_DECISION` are honest non-completion; only explicit user authority may use `REMOVED_BY_USER`.

## State vocabulary

Leaf state is exactly one of:

- WAITING: at least one id in Needs is not VERIFIED
- READY: dependencies are VERIFIED and ownership can be claimed
- IN-FLIGHT: dispatched, not yet parent-verified
- VERIFIED: parent --reverify passed and manual gates were reviewed
- ABANDONED: a required gate has a visible handoff

Branch state is exactly one of OPEN, VERIFIED, or ABANDONED. Derive root and
branch state from their ledgers; do not copy it into the topology tree.

## Tree

Use this tree only for parent-child topology and ledger paths. Use `leaf-` paths
for work leaves and `node-` paths for branch integration. Keep leaf operational
fields only in the dispatch table below; do not repeat `Owns`, `Needs`, `Tier`,
`Planned wave`, or `State` here and do not create a separate schedule.

- 1 <task> .............. GATES.md
  - 1.1 <branch> ........ gates/node-1.1.md
    - 1.1.1 <leaf> ...... gates/leaf-1.1.1.md
    - 1.1.2 <leaf> ...... gates/leaf-1.1.2.md
  - 1.2 <branch> ........ gates/node-1.2.md
    - 1.2.1 <leaf> ...... gates/leaf-1.2.1.md
    - 1.2.2 <leaf> ...... gates/leaf-1.2.2.md

## Leaf dispatch table

This is the single authoritative PLAN table for leaf operation. It is
authoritative for `Needs`, `Tier`, `Planned wave`, and `State`; `Owns` remains
visible here as the derived planning mirror described below. Keep exactly one
row per tree leaf and do not duplicate these fields in the tree or a schedule.

| Leaf | Owns | Needs | Tier | Planned wave | State |
|---|---|---|---|---|---|
| 1.1.1 | src/<a>/**, tests/<a>/** | - | mechanical | 1 | READY |
| 1.1.2 | src/<b>/**, tests/<b>/** | - | judgment | 1 | READY |
| 1.2.1 | src/<c>/**, tests/<c>/** | - | mechanical | 1 | READY |
| 1.2.2 | src/<d>/**, tests/<d>/** | 1.2.1 | judgment | 2 | WAITING |

`Owns` is a derived planning mirror of the complete glob set in the leaf ledger.
The ledger's `OWNS:` header is the command-time authority read by `--claim`.
Normalize both into sets and require equality before marking the row `READY` and
again before each claim. On disagreement, fail closed, correct and log the plan
or ledger, and recheck; never guess ownership. A successful claim does not prove
the mirror agreed with the ledger.

`Tier` is planner metadata for execution leaves. Use `judgment` when a leaf's own
artifact needs design or review, and `mechanical` only when its pattern and gates
are fixed. Map a tier through documented host-specific model or reasoning
controls only when the host exposes them. Otherwise retain the tier as a briefing
and review requirement without claiming a model choice. Driver and branch duties,
including planning, dispatch, parent verification, integration, and final audit,
remain judgment responsibilities outside this leaf field. Tier never weakens a
leaf's gates, parent re-verification, or integration standard.

`Planned wave` is the earliest intended launch group under the current contract.
Use a positive integer, put every dependency in an earlier planned wave, and let
the wave policy cap concurrency. It is a plan, not a barrier: rolling dispatch
may start a later planned wave as soon as that row's dependencies are verified,
without waiting for unrelated work. Actual starts belong in `dispatch.json` and
`status.log`; do not add a second schedule to this file.

Change `Needs`, `Owns`, `Tier`, or `Planned wave` only through a recorded plan
amendment before that row launches; do not erase a dependency when it becomes
satisfied. Update `State` in this table as work progresses. After parent
re-verification and manual review, mark a leaf `VERIFIED`, release that exact
leaf lease, and record the release. Do not promote a dependent until that exact
release is recorded. For an abandoned leaf, record the handoff and confirm its
worker has settled before releasing only that leaf; never call it
parent-verified. Release the whole scope only after every leaf is settled and
final scope verification has run. If final verification reports a handoff,
record it before release and never describe the scope as complete.

## Status log

Append events to `.unlazy/<scope>/status.log`; do not copy the event history into this file:

```text
node <skill-dir>/scripts/gate-check.mjs --scope <scope> --log "leaf-1.1.1 dispatched"
node <skill-dir>/scripts/gate-check.mjs --scope <scope> --log "leaf-1.1.1 verified"
node <skill-dir>/scripts/gate-check.mjs --scope <scope> --log "leaf-1.1.1 lease released"
```

Record contract amendments, plan changes, dispatch, parent verification, abandonment, branch integration, and lease release. Apply logged plan amendments and live State updates only in the dispatch table; keep the log append-only. Before root completion, reread the current request and review every current inventory row against its owner and observing gate or manual review.
