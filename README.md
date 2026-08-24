<div align="center">

# unlazy

**Completion discipline for substantial AI-agent work, backed by runnable gates.**

Write the acceptance ledger first. Execute reviewed checks. Reverify returned work. Report only what the evidence supports.

[Quick start](#quick-start) | [Gate contract](#the-gate-contract) | [Orchestration](#orchestration-and-parallel-work) | [Security](#security-boundary) | [Research](#research-basis)

</div>

## Version status

The current source targets `2.1.0`. It is not identified here as a tagged GitHub release. Pin an exact commit when you need an immutable installation. See [CHANGELOG.md](CHANGELOG.md) for the unreleased change set.

## Install

Use the [skills CLI](https://github.com/vercel-labs/skills) for supported agents:

```text
npx skills add Leonxlnx/unlazy
```

Add `-g` for a user-level install or `--all` for every detected agent.

Manual locations:

```text
Claude Code:  ~/.claude/skills/unlazy
Codex CLI:    ~/.codex/skills/unlazy
```

Clone the repository into the relevant directory. Invoke it as `/unlazy` where slash skills are supported, `$unlazy` in Codex, or by a natural-language trigger from the skill description.

The core is [SKILL.md](SKILL.md). The checker and optional hook require Node 16 or newer and use no third-party runtime packages.

## Quick start

Ask for substantial work with an explicit trigger:

```text
/unlazy tree 5 refactor the payment module and verify every migration path
```

For a solo task, copy [templates/gates-leaf.md](templates/gates-leaf.md) to `GATES.md`, replace every placeholder, and inspect it without executing commands:

```text
node <path-to-skill>/scripts/gate-check.mjs --status GATES.md
```

`--status` is the only mode that is always non-executing. On a new oracle with no exact approval record, a normal run prints its resolved command, expectation, working directory, shell, and `PATH` without executing it:

```text
node <path-to-skill>/scripts/gate-check.mjs GATES.md
```

Do not treat normal mode as a permanent dry run: once the exact oracle is approved, normal mode can execute it.

`CHECK:` lines are shell code. After reading every command and called script, approve and run the ledger:

```text
node <path-to-skill>/scripts/gate-check.mjs --approve GATES.md
```

Re-run all runnable gates, including gates already marked complete:

```text
node <path-to-skill>/scripts/gate-check.mjs --reverify GATES.md
```

Use `--help` for the complete current CLI.

## The gate contract

```markdown
# Gates: pricing behavior

- [ ] G1: pricing fixtures render the expected tiers
  CHECK: node scripts/verify-pricing.mjs
  EXPECT: pricing verification passed
  EVIDENCE: pending

- [ ] G2: checkout integration succeeds from its package
  CHECK: node scripts/verify-checkout.mjs
  EXPECT: checkout verification passed
  CWD: packages/checkout
  EVIDENCE: pending
```

A runnable gate passes only when its process exits `0` and `EXPECT:` matches combined output. Evidence records the resolved shell, resolved working directory, exit status, a short `PATH` fingerprint, the match result, and a SHA-256/byte-count fingerprint of successful output. Raw successful output is neither echoed nor persisted. The pre-execution transcript shows the resolved `PATH`, capped for display. Old evidence is not re-execution; parent verification uses `--reverify`.

The parser rejects zero-gate ledgers, duplicate ids, incomplete runnable gates, invalid expectations, and abandonment with a missing reason or unknown gate id. It ignores fenced examples, preserves CRLF or LF when updating, and inserts a missing evidence line when needed. A valid abandonment is terminal handoff rather than success: the checker exits `1` with `HANDOFF REQUIRED`, and Stop allows exit while reporting qualified ids.

The checker can prove only the command oracle you declare. It cannot infer that an English title and arbitrary shell code mean the same thing. Good gates therefore:

- read the artifact or service named by the outcome
- print a success-only marker after all assertions pass
- test an absence check against a known positive control
- measure supplied figures instead of copying them into `EXPECT:`
- review consequential manual outcomes with evidence proportional to risk

Use the advisory, non-executing `scripts/gate-lint.mjs` to catch mechanically weak ledger patterns; add `--strict` when warnings should fail. Full specification: [references/gates.md](references/gates.md).

## Shell and PATH

The checker uses `--shell` first, then `UNLAZY_SHELL`, then Node's platform default shell. That default is `/bin/sh` on Unix and `process.env.ComSpec` on Windows with the platform fallback. Checks inherit the launch environment, including `PATH`.

This matters on Windows: a checker launched from Git Bash can see Unix-like tools that the same checker launched from PowerShell does not. `--shell` changes the interpreter; it does not install `grep`, `tail`, `tr`, or other external programs. Portable examples call repository-owned Node scripts.

Parent re-verification should use the same declared shell and required toolchain. A shell or PATH mismatch is a failed verification to resolve, not successful evidence.

## Security boundary

Approval records live under `~/.unlazy/approved` by default. `UNLAZY_APPROVAL_DIR` may select another owner-private real directory, but its canonical target must remain outside the checked repository. Symlinked stores and linked, replaced, or non-private records fail closed. Each record is specific to the absolute ledger and gate, exact `CHECK:` and `EXPECT:`, resolved `CWD:` and shell, timeout, output and regex limits, regex worker limits, platform, and full inherited `PATH`. Editing any bound input requires approval again.

Approval is consent, not a sandbox. Approval storage is a canonical, owner-private directory outside the repository; records are accepted only as single-link private regular files. Approval does not hash called scripts, fixtures, dependencies, or other transitive inputs, and `--status`/Stop do not revalidate old evidence. Reinspect changed dependencies and run `--reverify`; see [SECURITY.md](SECURITY.md) for the bounded digest pattern when user-designed dependency identity is needed. Checks run with ambient filesystem, environment, credential, and network access. Scopes and ownership leases coordinate cooperating processes but do not restrict what a process can read or write.

## Orchestration and parallel work

For work that needs fresh contexts, create one scoped pipeline under `.unlazy/<scope>/`:

```text
.unlazy/<scope>/PLAN.md
.unlazy/<scope>/GATES.md
.unlazy/<scope>/gates/leaf-*.md
.unlazy/<scope>/gates/node-*.md
```

The driver rereads the current request and maintains a revisioned contract inventory that maps each independently required outcome or acceptance-changing constraint to an owner and observation. It fixes interfaces, dependencies, conventions, and file ownership before dispatch. Leaves use declared `WAITING`, `READY`, `IN-FLIGHT`, `VERIFIED`, or `ABANDONED` states. Branches use `OPEN`, `VERIFIED`, or `ABANDONED`.

Ready leaves may run together only after each declares complete, disjoint, repository-relative `OWNS:` paths and claims them:

```text
node <path-to-skill>/scripts/gate-check.mjs --scope api --leaf leaf-1.2.1 --claim
```

Lease matching is conservative and may reject a safe-looking pair. It is a coordination guard, not write isolation. Use separate worktrees for colliding worktree-local output, and configure separate cache locations when cache writes can conflict.

Dispatch is rolling: when a verified leaf unblocks another, start the newly ready leaf without waiting for unrelated work. Gate checks remain sequential by default. `--jobs <N>`, where `N` is an integer from 1 through 64, is an opt-in rolling limit for independent checks and keeps reporting in ledger order.

For every independent READY set, open a native launch wave, record each host agent handle, and seal before the first wait. If a partial launch cannot recover, use the audited `abandon --reason` transition; never invent a handle or delete state. Read [references/method.md](references/method.md), [references/orchestration.md](references/orchestration.md), [references/dispatch.md](references/dispatch.md), and [references/parallel.md](references/parallel.md) before parallel fan-out.

`gate-check.mjs --scope <id>` reduces the scope's ledgers and dispatch waves together. It prints `ALL MET` only when every gate is met and every wave is complete; an abandoned wave remains a non-successful `HANDOFF REQUIRED` outcome.

## Optional Claude Code Stop hook

The hook scans the current session's resolved ledger and dispatch state and returns Claude Code's documented top-level `decision: "block"` response while gates remain unmet or launch waves remain incomplete. It does not execute checks. Its own session-keyed progress guard releases after six consecutive blocks without semantic gate/dispatch progress; metadata-only edits do not reset it. Abandonment stays visible as an explicit bounded handoff in pure, mixed-blocking, and final-release messages, without echoing free-form reasons.

Install only with the user's consent:

```text
node <path-to-skill>/scripts/install-hooks.mjs
node <path-to-skill>/scripts/install-hooks.mjs --scope api
node <path-to-skill>/scripts/install-hooks.mjs --uninstall
```

Default installation writes `.claude/settings.local.json`. Keep that file, `.unlazy/`, and `.unlazy-hook-state.json` in the project's ignore rules. `--shared` writes absolute Node and hook-script paths into project settings, so it is usually not portable and can expose local directory names. `--global` writes the current user's Claude settings.

The installer preserves unrelated hooks, refuses malformed settings shapes, and identifies moved unlazy entries without depending on the install directory name. It writes settings atomically and creates `<settings-file>.unlazy.bak` beside an existing settings file before replacing it.

## What 2.1.0 changes

The unreleased `2.1.0` source integrates the useful parts of community PRs while repairing their edge cases:

- strict shared ledger parsing and explicit named-file targeting
- `--reverify`, explicit `--approve`, and fail-closed exit-plus-EXPECT success
- `--shell` and `UNLAZY_SHELL`, with pre-execution PATH disclosure and resolved shell, CWD, exit, match, and successful-output fingerprint evidence
- scoped pipelines, session routing, atomic ledger updates, and serialized lease coordination
- rolling orchestration and opt-in `--jobs`, sequential by default
- native dispatch launch waves with auditable partial-launch abandonment
- revisioned PLAN contract inventories and final request reconciliation
- advisory gate linting with opt-in strict failure
- non-successful gate abandonment that cannot promote parent completion
- bounded Windows timeout process-tree cleanup with a live nested-descendant CI regression
- session-keyed Stop-hook state and atomic settings updates with a backup
- Node 16 support, zero runtime dependencies, a package test command, and CI
- accurate security, portability, research, and reproducibility documentation

Contributor history and pull-request links are recorded in [CHANGELOG.md](CHANGELOG.md).

## Repository map

```text
SKILL.md                         core instructions and mode routing
SECURITY.md                      CHECK, shell, approval, hook, and lease threat model
agents/openai.yaml               skill UI metadata
references/gates.md              strict format, approval, shell, and authoring rules
references/method.md             Depth Tree decomposition method
references/orchestration.md      states, rolling dispatch, and verification hierarchy
references/dispatch.md           native launch waves, host adapters, and recovery
references/parallel.md           scope and lease coordination limits
references/token-economy.md      attention and verification cost discipline
research/validation-protocol.md  historical limitations and rerun protocol
templates/                       plan, leaf, and branch ledger templates
scripts/                         checker, linter, dispatch recorder, installer, and Stop hook
tests/                           deterministic behavior and regression tests
```

Run the repository's complete test command:

```text
npm test
```

## Research basis

Research supports the failure modes that motivate explicit structure; it does not prove that unlazy produces a fixed improvement.

- Detailed multi-part prompts still see partial compliance and premature truncation in tested models ([Quantifying Laziness](https://arxiv.org/abs/2512.20662)).
- Reasoning can stop exploration too early or continue beyond useful compute, depending on task and model ([Thoughts Are All Over the Place](https://arxiv.org/abs/2501.18585), [When More Thinking Hurts](https://arxiv.org/abs/2604.10739), [OptimalThinkingBench](https://arxiv.org/abs/2508.13141)).
- SlopCodeBench reports that no tested agent fully solved a problem end to end and that the best agent passed `14.8%` of checkpoints. Checkpoint success is not task completion ([SlopCodeBench](https://arxiv.org/abs/2603.24755)).
- s1's budget forcing lengthens reasoning by appending `Wait` multiple times when the model tries to stop; it is not a claim that one token always improves work ([s1](https://arxiv.org/abs/2501.19393)).
- METR's Time Horizon 1.1 reports a `196.5` day overall P50 doubling-time fit and `130.8` days for the post-2023 fit. The shorter figure must not be described as the all-years estimate ([METR Time Horizon 1.1](https://metr.org/blog/2026-1-29-time-horizon-1-1/)).
- Closed-book knowledge-intensive tasks can hallucinate more with additional test-time compute, and compute-only post-processing cannot add ground-truth information that was not present ([Test-Time Scaling in Reasoning Models Is Not Effective for Knowledge-Intensive Tasks Yet](https://arxiv.org/abs/2509.06861), COLM 2026).

Earlier README versions also cited a six-run internal comparison. The raw artifacts needed to reproduce those exact ratios and counts are not in this repository. Treat the results as historical design input, not a benchmark guarantee. The limitations and a protocol for a defensible rerun are in [research/validation-protocol.md](research/validation-protocol.md).

### Sources, newest first

Ordered by the most recent public version or publication date known on 2026-08-23. Undated material appears last.

- 2026-08-06: [Test-Time Scaling in Reasoning Models Is Not Effective for Knowledge-Intensive Tasks Yet](https://arxiv.org/abs/2509.06861), v3, COLM 2026
- 2026-07-10: [Measuring AI Ability to Complete Long Software Tasks](https://arxiv.org/abs/2503.14499), v4, NeurIPS 2025
- 2026-05-07: [SlopCodeBench: Benchmarking How Coding Agents Degrade Over Long-Horizon Iterative Tasks](https://arxiv.org/abs/2603.24755), v2
- 2026-04-13: ["Should I Give Up Now?" Investigating LLM Pitfalls in Software Engineering](https://arxiv.org/abs/2411.09916), v3
- 2026-04-12: [When More Thinking Hurts: Overthinking in LLM Test-Time Compute Scaling](https://arxiv.org/abs/2604.10739)
- 2026-01-29: [METR Time Horizon 1.1](https://metr.org/blog/2026-1-29-time-horizon-1-1/)
- 2025-12-19: [Quantifying Laziness, Decoding Suboptimality, and Context Degradation in Large Language Models](https://arxiv.org/abs/2512.20662)
- 2025-10-04: [OptimalThinkingBench: Evaluating Over and Underthinking in LLMs](https://arxiv.org/abs/2508.13141), v2
- 2025-10-03: [Context Anxiety: How AI Agents Panic About Their Perceived Context Windows](https://inkeep.com/blog/context-anxiety)
- 2025-03-01: [s1: Simple test-time scaling](https://arxiv.org/abs/2501.19393), v3
- 2025-02-18: [Thoughts Are All Over the Place: On the Underthinking of o1-Like LLMs](https://arxiv.org/abs/2501.18585), v2
- Undated page: [Unified diffs make GPT-4 Turbo 3X less lazy](https://aider.chat/docs/unified-diffs.html)

## Contributing

Issues and pull requests are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Behavioral claims need current, directly supporting sources; executable changes need regression coverage.

## License

[MIT](LICENSE)
