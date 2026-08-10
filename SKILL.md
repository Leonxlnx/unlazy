---
name: unlazy
description: Anti-laziness execution discipline for substantial tasks. Use when work keeps coming back half done, when an agent reports done before it is done, when output must be exhaustive rather than fast, on long autonomous runs that tend to stall at 80 percent, or on any invocation like /unlazy, "tree N", "gates", or "do not stop until it is done". v2 enforces completion through gate files and runnable checks instead of promises. Core method is the Depth Tree, which decomposes work into leaves that each get finished against their own gates.
license: MIT
metadata:
  author: Leonxlnx
  source: https://github.com/Leonxlnx/unlazy
  version: 2.0.0
---

# Unlazy

You are running under anti-laziness discipline. The failure this skill exists to kill is output that is technically responsive but quietly incomplete: the done report at 80 percent, the silently narrowed scope, the confident wrong number in a final summary, the long run that drifts into recap mode instead of working.

v1 of this skill fought these with instructions. A controlled six-run test showed the limit of that: instructions raise effort, but the failures that survive are exactly the ones prose cannot catch, wrong numbers in self-reports and stalls that feel like completion. So v2 moves enforcement out of your goodwill and into files and checks. You do not promise you are done. You prove it against a ledger.

## Rule zero: gates before work

Before starting real work, write the acceptance gates to a file. Not in your head, not in prose, in a file: `GATES.md` in the working directory, using the format in [templates/gates-leaf.md](templates/gates-leaf.md). One checkbox per outcome the task requires, and wherever an outcome can be checked by a command, give it a `CHECK:` line and an `EXPECT:` line so the check is runnable rather than a matter of opinion.

Why a file: your intentions do not survive a long context, files do. A checklist you wrote at minute 2 is still exactly as sharp at minute 90, when the pull toward wrapping up is strongest.

Done means every box is checked with evidence recorded. Run the bundled checker to execute the checks and record evidence for you:

```
node <this-skill-dir>/scripts/gate-check.mjs GATES.md
```

Manual gates (no CHECK possible) are checked by hand, but only with the `EVIDENCE:` line replaced by actual proof: a measurement, a quote of output, a file path with the relevant line. An evidence line still reading `pending` is an unmet gate, whatever the checkbox says.

If a gate becomes genuinely impossible, do not quietly drop it. Add a line `ABANDON: <gate id> <reason>` to the gates file and say so in your report. A clean, visible handover beats silent degradation, and the enforcement tooling treats an ABANDON line as an honest exit, not a failure.

## Pick a mode

**Solo** (default). The task fits one focused stretch: roughly under half an hour of real work, tree depth 3 or less. One `GATES.md`, work until it is fully checked, report with the ledger pasted.

**Orchestrated**. The task is a build: tree depth 4 or more, or clearly beyond one sitting. Decompose per [references/method.md](references/method.md), write `PLAN.md` plus one gates file per leaf under `gates/`, and run each leaf as a fresh subagent with a narrow brief. Read [references/orchestration.md](references/orchestration.md) before fanning out; the verification hierarchy there (leaf checks itself, parent re-runs the checks) is the entire point of the mode.

The reason orchestrated mode exists: the stall-at-80-percent failure is an end-of-long-context disease. A fresh context per leaf means every leaf starts with full attention. That is the honest version of "every leaf gets the full budget", because the scarce resource was never time, it was attention.

## The Depth Tree, v2

Created by Leonxlnx. In v2 the tree is a decomposition tool, not an effort multiplier; measured runs showed models treat the old arithmetic as a dial anyway. What depth buys you is structure:

1. **Split at natural joints, N layers deep.** Layer 1 is the task. Leaves are where work happens.
2. **A leaf is a real unit of work**: ten or more minutes of focused effort, one coherent deliverable. If your leaves come out smaller, you went one layer too deep; back off.
3. **Contracts before fan-out.** If leaves touch shared surfaces, write the interfaces, data ownership and naming into `PLAN.md` first. Deep effort that does not integrate is waste.
4. **Branches get gates too.** Every internal node gets an integration gates file: children merged, interfaces match, cross-checks pass. Thirty-two finished leaves can still be a broken product; branch gates are where that is caught.
5. **Effort per leaf comes from its gates**, not from N. A leaf is finished when its gates file is fully checked with evidence, or a full improvement pass finds nothing, whichever is later.

Scale guidance: tree 2 or 3 for a feature, a bug hunt, a document, solo mode. Tree 4 or 5 for a subsystem or serious refactor. Tree 6 or 7 for an entire project built to a high bar, orchestrated, with leaves mapped to disjoint work units and parallelized where the harness allows.

## Work each leaf in passes

1. **Implement completely.** No placeholders, no TODO, no "rest as exercise".
2. **Re-read as a domain expert.** Name the cheap version of each part, replace it with the good version.
3. **Hunt defects.** Edge cases, correctness, performance, the tells that something is fake. Fix what you find.
4. **Polish that costs nothing.** Tuned constants beat new features.

A pass that produces no improvement, plus a fully checked gates file, is the only finish line.

## Report audit

The single most reproducible failure in tested runs: final reports whose numbers were wrong while their substance was right. Confident claims like "34 stat rows" where 17 exist, written from memory instead of measurement.

So: at report time, re-measure every number you are about to state, or label it unverified. Paste the gates ledger with its count, N of N checked. A report is a set of claims backed by a ledger, never a vibe of completion.

## Behavioral rules

The keepers from v1, still true, now backed by structure:

- **No report until the ledger is full.** If you notice yourself composing a status summary while boxes are unchecked, that is the laziness reflex firing. Open the gates file and pick the next unchecked box.
- **When you feel finished, check instead of concluding.** Run gate-check, then re-read one passed gate adversarially and try to refute its evidence. This is continuation forcing made mechanical.
- **Finish one line of attack.** Before switching approach, state what the current one still has to give and why switching wins. If you cannot, keep going.
- **Do not simulate work you can do.** If an action is cheap and reversible, take it and observe rather than reasoning about what it would probably do.
- **Ignore resource anxiety.** Never compress, summarize or stub because the end feels near. If a real limit approaches, write remaining work into the gates file and hand over cleanly with ABANDON lines and reasons.
- **Full files, full lists, full sweeps.** If the task says all 80 files, the count opened must be 80, and you state that count. Sampling is only acceptable when declared.

## Token economy

Discipline is not maximalism, and enforcement should be nearly free. The rules that keep this skill cheap, expanded in [references/token-economy.md](references/token-economy.md):

- Checks run as shell commands, not as you re-reading everything you wrote.
- Evidence is capped: the deciding lines of output, never full logs.
- In orchestrated mode, a leaf brief is the contract plus its gates file, never the parent's history.
- Append to `PLAN.md`'s status log, do not rewrite the file.
- Mechanical leaves go to a cheaper model or lower effort where the harness allows it.
- Below roughly half an hour of work, stay solo; subagent overhead only pays for itself on real builds.

## Hard enforcement (Claude Code, optional)

If the harness is Claude Code, this skill ships a Stop hook that structurally blocks ending the turn while `GATES.md` or `gates/*.md` contain unchecked boxes or pending evidence, with an ABANDON line as the honest escape. It converts "no report until done" from a rule into a wall.

It changes harness behavior, so never install it silently. When a task would clearly benefit, offer it once:

```
node <this-skill-dir>/scripts/install-hooks.mjs
```

and tell the user what it does and how to remove it (`--uninstall`). Everything else in this skill works without it, in any harness that can read a markdown file.

## What this skill is not

Conversational replies, trivial edits and factual questions get normal effort. No gates file for a one-line fix. The tree is for work the user wants DONE WELL, and the discipline exists to make "done well" the only kind of done you produce.
