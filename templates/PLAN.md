# Plan: <task>

Depth: tree <N>   Mode: orchestrated
Budget note: <what a competent single pass would take; context, not arithmetic>

## Contract

Decided BEFORE fan-out. Everything a leaf could get wrong about its neighbors:

- Interfaces: <function signatures, file formats, API shapes>
- Data ownership: <which leaf owns which files; no two leaves share a file>
- Naming and conventions: <casing, folder layout, error handling style>

## Tree

State is one of READY, IN-FLIGHT, VERIFIED, ABANDONED. Update it in-place as
the driver dispatches and verifies; the status log below is append-only but
the State column here is mutable so the driver can scan readiness at a glance.

Needs lists the leaf ids that must be Verified before this leaf can dispatch.
Leave empty (or "-") for independent leaves; dependencies are the exception,
not the rule — prefer zero.

- 1 <task>
  - 1.1 <branch> .......... gates/leaf-1.1.md          Needs: -          State: READY
    - 1.1.1 <leaf> ........ gates/leaf-1.1.1.md        Needs: -          State: READY
    - 1.1.2 <leaf> ........ gates/leaf-1.1.2.md        Needs: -          State: READY
  - 1.2 <branch> .......... gates/leaf-1.2.md          Needs: -          State: READY
    - 1.2.1 <leaf> ........ gates/leaf-1.2.1.md        Needs: -          State: READY
    - 1.2.2 <leaf> ........ gates/leaf-1.2.2.md        Needs: 1.2.1      State: BLOCKED

## Status log

Append-only. One line per event. The State column above is the live snapshot;
this log is the history, so you can reconstruct what happened and when.

Mandated events to log:
- leaf dispatched:  "<step> <leaf-id> dispatched"
- leaf verified:   "<step> <leaf-id> verified (<N>/<N> gates met)"
- leaf abandoned:   "<step> <leaf-id> abandoned: <which gates, why>"
- branch integrated: "<step> <branch-id> integration gates met"

Never rewrite lines above; appending keeps the file cheap to re-read and diff.
The step counter is monotonic (starts at 1, steps every event regardless of
which leaf) so any two log lines can be compared for ordering.

- 1 plan written, contract fixed
