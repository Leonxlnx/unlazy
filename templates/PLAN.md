# Plan: <task>

Scope: <validated pipeline id; store this file at .unlazy/<scope>/PLAN.md>
Depth: tree <N>
Mode: orchestrated

## Contract

Decide before fan-out:

- Interfaces: <signatures, schemas, formats, integration points>
- Ownership: <one complete set of repository-relative paths per leaf; no absolute paths, traversal, or concurrent overlap>
- Dependencies: <leaf ids that must be VERIFIED first>
- Toolchain: <runtime versions, shell, working-directory rules, test commands>
- Conventions: <naming, errors, compatibility, formatting>
- Manual review: <owner and evidence standard for consequential manual gates>

## State vocabulary

Leaf state is exactly one of:

- WAITING: at least one id in Needs is not VERIFIED
- READY: dependencies are VERIFIED and ownership can be claimed
- IN-FLIGHT: dispatched, not yet parent-verified
- VERIFIED: parent --reverify passed and manual gates were reviewed
- ABANDONED: a required gate has a visible handoff

Branch state is exactly one of OPEN, VERIFIED, or ABANDONED.

## Tree

Use `leaf-` paths for work leaves and `node-` paths for branch integration.

- 1 <task> .............. GATES.md ..................... State: OPEN
  - 1.1 <branch> ........ gates/node-1.1.md ............ State: OPEN
    - 1.1.1 <leaf> ...... gates/leaf-1.1.1.md .......... Needs: - ...... State: READY
    - 1.1.2 <leaf> ...... gates/leaf-1.1.2.md .......... Needs: - ...... State: READY
  - 1.2 <branch> ........ gates/node-1.2.md ............ State: OPEN
    - 1.2.1 <leaf> ...... gates/leaf-1.2.1.md .......... Needs: - ...... State: READY
    - 1.2.2 <leaf> ...... gates/leaf-1.2.2.md .......... Needs: 1.2.1 .. State: WAITING

Every leaf repeats its complete ownership as an `OWNS:` header in its ledger. Claim each concurrently dispatched leaf with `--claim` before changing its state to IN-FLIGHT.

## Status log

Append events to `.unlazy/<scope>/status.log`; do not copy the event history into this file:

```text
node <skill-dir>/scripts/gate-check.mjs --scope <scope> --log "leaf-1.1.1 dispatched"
node <skill-dir>/scripts/gate-check.mjs --scope <scope> --log "leaf-1.1.1 verified"
```

Record plan changes, dispatch, parent verification, abandonment, branch integration, and lease release. Update the live State and Needs fields above when state changes; keep the log append-only.
