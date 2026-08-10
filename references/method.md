# The Depth Tree, v2

Created by Leonxlnx. v1 stated the tree as arithmetic: split N layers, give
every leaf the full root budget, effort multiplies as 2^(N-1). A controlled
six-run test (see the README) measured what models actually do with that
instruction: they treat depth as a thoroughness dial and ignore the
arithmetic. tree 6 cost roughly 1.0 to 1.5 times tree 3, never 8 times.
The dial worked; the math was fiction.

v2 keeps what the tree is genuinely good at, decomposition and structure,
and moves the effort guarantee to where it can actually be enforced: per-leaf
gates and fresh per-leaf contexts.

## The rules

1. **Layer 1 is the task.** Split at natural joints, binary where natural
   joints allow, N layers deep. Leaves are the only places real work happens;
   every layer above them is decomposition and integration.

2. **A leaf is a real unit of work.** Ten or more minutes of focused effort,
   one coherent deliverable, one gates file. If splitting produces leaves
   smaller than that, you went one layer too deep; back off a layer. Depth
   follows the task's joints. It is not a number you crank for effort.

3. **Contracts before fan-out.** Interfaces, data ownership, naming, error
   conventions go into PLAN.md before any leaf starts. In orchestrated mode
   no two leaves may own the same file; if they seem to need to, the split
   is wrong or the shared thing belongs in the contract.

4. **Leaves get gates; branches get gates.** A leaf's gates prove its
   deliverable. A branch's gates prove integration: children merged,
   interfaces match, end-to-end behavior works, no sibling regressions.
   The most expensive failure of deep trees is thirty-two locally perfect
   leaves that do not compose; branch gates exist to catch exactly that.

5. **Effort per leaf comes from the leaf's gates plus the four passes**
   (implement fully, expert re-read, defect hunt, free polish). A leaf is
   finished when its gates are fully met with evidence AND a full pass finds
   nothing to improve. "Budget spent" is no longer a finish line, because
   budgets were the part models routinely re-negotiated with themselves.

## Where the effort guarantee actually lives now

| v1 said | v2 does |
|---|---|
| every leaf gets full budget T | every leaf gets a fresh context and its own gates |
| effort = 2^(N-1) x T | effort = whatever it takes to check every box with evidence |
| no report until done (prose) | stop-hook and ledger make early reports structurally visible |
| verify, do not trust yourself | CHECK commands run in the shell; parent re-runs them |

## Choosing N

- **tree 2 or 3**: a feature, a bug hunt, a document. Solo mode, one gates
  file, 2 to 4 leaves worked in sequence in one session.
- **tree 4 or 5**: a subsystem, a refactor, a serious review. Consider
  orchestrated mode; 8 to 16 leaves is past what one context holds well.
- **tree 6 or 7**: an entire project built to a high bar. Orchestrated mode,
  leaves mapped onto disjoint work units, parallelized where the harness
  allows, branch gates at every merge point.

When the user gives no depth, pick the smallest N whose leaves match the
task's natural parts. Do not go one deeper by default; go one deeper only
when a leaf fails the "real unit of work" test in the other direction, that
is, when a leaf would clearly hide multiple deliverables inside it.
