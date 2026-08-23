# The Depth Tree

Use the tree to expose natural work boundaries and integration points. Do not treat depth as an arithmetic promise about effort or tokens.

The original v1 method claimed that each binary split multiplied effort. A small maintainer-run comparison later suggested that agents treated depth as a thoroughness cue rather than following that arithmetic. The repository does not contain the raw artifacts needed to reproduce those historical figures, so treat them as design history, not benchmark evidence. See [../research/validation-protocol.md](../research/validation-protocol.md).

## Rules

1. **Make layer 1 the requested task.** Split only at real domain, component, or verification boundaries. Binary splits are optional.
2. **Make each leaf one coherent deliverable.** Give it exact ownership, dependencies, and acceptance gates. Merge tiny adjacent leaves; split a leaf that hides several independent outcomes.
3. **Fix contracts before fan-out.** Record interfaces, formats, shared assumptions, error conventions, naming, and ownership in `PLAN.md` before a leaf starts.
4. **Give branches integration gates.** Verify child ledgers again, then test interfaces, end-to-end behavior, and regressions across the joined work.
5. **Use gates and passes as the effort control.** Finish implementation, expert reread, defect hunt, and low-cost polish. Stop only when every required gate has current evidence and another improvement pass finds nothing.

## Choose depth

- Use a shallow tree or solo ledger for a feature, contained bug hunt, or document.
- Use an orchestrated tree when several coherent deliverables benefit from fresh contexts or independent ownership.
- Use a deeper tree only when its additional branches correspond to real integration boundaries. Do not add empty hierarchy to satisfy a number.
- Honor an explicit `tree N` request while keeping leaves meaningful. If the requested depth would create filler leaves, state the mismatch and use the closest honest decomposition.

When no depth is requested, choose the smallest tree that exposes every independent deliverable and integration point.

## Contract checklist

Before dispatch, make these decisions explicit:

- exact files or relative globs each leaf owns
- interfaces and schemas shared between leaves
- dependency ids and readiness states
- toolchain, shell, and working-directory requirements
- error and compatibility conventions
- which branch gates prove integration
- who performs high-risk manual review

Do not let two concurrent leaves own the same path. If shared work cannot be separated, make it an earlier dependency or a dedicated integration leaf.

## Completion hierarchy

| Layer | Proof |
|---|---|
| Leaf | Current runnable evidence plus reviewed manual evidence |
| Branch | Reverified children plus cross-child integration checks |
| Root | Every branch integrated, regressions checked, final claims remeasured |

Local completion does not imply integration. Verify from leaves upward and report only after the root ledger is satisfied.
