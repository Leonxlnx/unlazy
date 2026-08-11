<div align="center">

# unlazy

**An anti-laziness skill for AI agents. v2: enforced, not requested.**

v1 told the model to work harder. v2 makes half-done structurally visible:
acceptance gates live in files, checks run as commands, and an optional hook
blocks the agent from declaring victory while gates are unmet.

You do not promise you are done. You prove it against a ledger.

Works with Claude Code, OpenAI Codex, Cursor and anything else that reads `SKILL.md`.
Hard enforcement (the Stop hook) is Claude Code only; everything else is plain markdown and Node.

[Use it](#use-it) · [What changed in v2](#what-changed-in-v2-and-why) · [How it works](#how-it-works) · [The method](#the-depth-tree-v2) · [Costs](#what-it-costs) · [Research](#the-research)

</div>

---

## Use it

Install once, then invoke it in plain language. The skill also triggers on its own when your request matches its description.

```
/unlazy tree 5 refactor the payment module
```

```
tree 3 build the landing page and do not stop until every gate is checked
```

`tree N` picks how deep the task gets decomposed. Leaves are units of real work, each finished against its own gates. `tree 2-3` for a feature or bug hunt, `tree 4-5` for a subsystem, `tree 6-7` for a whole project built leaf by leaf with fresh-context subagents.

### Install

**Any agent, via the [skills CLI](https://github.com/vercel-labs/skills)** (Claude Code, Codex, Cursor and more; it detects what you have):

```bash
npx skills add Leonxlnx/unlazy
```

Add `-g` for a user-level install or `--all` for every detected agent, non-interactively.

**Claude Code, manually:**

```bash
git clone https://github.com/Leonxlnx/unlazy ~/.claude/skills/unlazy
```

**OpenAI Codex CLI, manually** (invoke with `$unlazy` or let it trigger on the description):

```bash
git clone https://github.com/Leonxlnx/unlazy ~/.codex/skills/unlazy
```

**Everything else:** [SKILL.md](SKILL.md) is a plain markdown file. Paste it as a system prompt, a Cursor rule, or a preamble. Gates and scripts need only Node 16+.

### Hard mode (Claude Code, optional)

The skill works everywhere as discipline. In Claude Code it can also work as a wall: a Stop hook that structurally blocks ending the turn while gates are unmet.

```bash
node <path-to-skill>/scripts/install-hooks.mjs            # this project only (settings.local.json)
node <path-to-skill>/scripts/install-hooks.mjs --global   # every project
node <path-to-skill>/scripts/install-hooks.mjs --uninstall
```

It is a millisecond file scan, zero tokens per check. If the agent makes no gate progress across six consecutive blocked stops, the hook releases it with a warning instead of trapping it, and an `ABANDON: <gate> <reason>` line is always honored as an honest exit. Add `.unlazy-hook-state.json` to your `.gitignore`.

### Or let your agent install it

Paste this to Claude Code, Codex, Cursor or any agent with shell access:

```
Install the "unlazy" skill from https://github.com/Leonxlnx/unlazy so it is
available to you in future sessions.

Try `npx skills add Leonxlnx/unlazy -y` first. If that is unavailable, clone
the repo into your own skills directory instead: ~/.claude/skills/unlazy for
Claude Code, ~/.codex/skills/unlazy for Codex CLI, or the equivalent path for
whatever agent you are.

Then confirm it worked: show me the installed path and the first line of the
skill's description. Do not tell me it is installed unless you have actually
verified the file is on disk.
```

## What changed in v2, and why

The original single-file skill is preserved unchanged on the [v1 branch](https://github.com/Leonxlnx/unlazy/tree/v1) if you want the instructions-only version with zero moving parts.

v1 was instructions. To find out what instructions actually buy, the method was put through a controlled test: two build-from-scratch tasks (a marketing site and a three.js solar system), three conditions each (no skill, tree 3, tree 6), one fresh folder and fresh session per run, same model, same prompt body. Every output was code-reviewed by independent agents, adversarially re-verified, and live-tested in a browser.

What the test found, in five lines:

| Finding | Consequence for v2 |
|---|---|
| Baseline already ships zero placeholders, zero console errors | The banned-list was fighting a solved problem; v2 aims at what actually failed |
| The skill raised effort 1.6-3.9x and fixed 4-10 self-found defects pre-delivery | The passes and gates discipline demonstrably work; they stay |
| tree 6 cost about 1.0-1.5x tree 3, never the promised 8x | The 2^(N-1) arithmetic was fiction; depth is now decomposition, not multiplication |
| The only hard live failure was a baseline build, and its report claimed the case was handled | Claims need runnable checks, not confidence; hence CHECK/EXPECT gates |
| Every skill run's final report contained 1-3 wrong numbers; baselines had zero | Hence the report audit rule: re-measure every number at report time |

The deeper lesson: prose cannot enforce prose. A model that under-executes instructions also under-executes the instruction not to under-execute. So v2 moves enforcement down a hierarchy, each layer catching what the one above misses:

1. **Discipline** (SKILL.md): weakest layer, works in any agent.
2. **Gates files** (`GATES.md`, `gates/*.md`): intentions written at minute 2 stay sharp at minute 90.
3. **Runnable checks** (`scripts/gate-check.mjs`): a CHECK command decides, not a feeling of completion.
4. **Parent re-verification** (orchestrated mode): the dispatcher re-runs each leaf's checks; self-certification is worthless.
5. **The Stop hook** (`scripts/stop-hook.mjs`): ending the turn with unmet gates is blocked, mechanically.

## How it works

Before real work starts, the agent writes its acceptance gates to a file:

```markdown
# Gates: pricing section

- [ ] G1: three tiers render with real copy
  CHECK: node check.js pricing --tiers
  EXPECT: 3/3 tiers ok
  EVIDENCE: pending

- [ ] G2: annual toggle changes both price and label
  CHECK: node check.js pricing --toggle
  EXPECT: toggle ok
  EVIDENCE: pending
```

`gate-check.mjs` runs the CHECK commands, flips boxes only when EXPECT matches, and records the deciding output lines as evidence. A checked box whose evidence still reads `pending` counts as unmet; a checkbox is a claim, evidence is the proof. Done means the ledger is full, and the final report pastes it, N of N, with every number re-measured at report time.

For big builds (tree 4+), the tree becomes a real plan: `PLAN.md` holds the contract (interfaces, file ownership, naming, fixed before fan-out), every leaf and branch gets its own gates file, and each leaf runs as a fresh subagent. Fresh context per leaf is the point: the stall-at-80-percent failure is an end-of-long-context disease, and attention, not time, was always the scarce resource.

## The Depth Tree, v2

Created by [Leonxlnx](https://github.com/Leonxlnx).

1. **Split at natural joints, N layers deep.** Leaves are where work happens; branches are decomposition and integration.
2. **A leaf is a real unit of work**: ten or more minutes, one deliverable, one gates file. Smaller leaves mean you went too deep.
3. **Contracts before fan-out.** Interfaces and file ownership are fixed in PLAN.md before any leaf starts.
4. **Branches get integration gates.** Thirty-two locally perfect leaves can still be a broken product; branch gates catch exactly that.
5. **Effort per leaf comes from its gates.** Finished means every box checked with evidence and an improvement pass that finds nothing, whichever is later.

Full method: [references/method.md](references/method.md) · gate format spec: [references/gates.md](references/gates.md) · orchestration: [references/orchestration.md](references/orchestration.md)

## What it costs

Measured, not guessed (details in [references/token-economy.md](references/token-economy.md)):

- Discipline alone (solo mode, gates file, no hook) costs a few hundred tokens of overhead and roughly 1.5-4x baseline output on tasks the model would otherwise treat lightly. That multiple bought committed design, robustness sweeps and pre-delivery bug hunts in testing.
- The hook costs zero tokens; it is a file scan.
- Orchestrated mode multiplies cost with leaf count, deliberately, and is worth it only for real builds. Below roughly half an hour of work, stay solo.
- Checks-as-commands is the quiet saver: every CHECK line replaces thousands of tokens of the model re-reading its own work with a free subprocess.

## What is in the repo

```
SKILL.md                       the skill: rule zero, modes, tree v2, report audit
references/
  method.md                    the Depth Tree v2 in full
  gates.md                     gate file format spec and writing guide
  orchestration.md             leaves as fresh agents, verification hierarchy
  token-economy.md             cost discipline, measured
templates/
  PLAN.md                      contract + tree + append-only status log
  gates-leaf.md                per-leaf gates
  gates-node.md                per-branch integration gates
scripts/
  gate-check.mjs               runs CHECK commands, flips boxes, records evidence
  stop-hook.mjs                Claude Code Stop hook: blocks stop while gates unmet
  install-hooks.mjs            idempotent hook install/uninstall
```

All scripts are zero-dependency Node 16+, tested on Windows and POSIX shells.

## The problem: model laziness is real and measured

"Laziness" sounds like a vibe. It is not. Recent work defines and measures it directly:

- A December 2025 paper defines LLM laziness as **premature truncation of responses and partial compliance with multi-part requests**, and finds widespread compliance failures on detailed multi-part instructions even under explicit prompting ([Quantifying Laziness, arXiv 2512.20662](https://arxiv.org/abs/2512.20662)).
- Reasoning models **abandon promising lines of thought prematurely**, a failure named underthinking ([Thoughts Are All Over the Place, arXiv 2501.18585](https://arxiv.org/abs/2501.18585)). The inverse also exists: models burn compute deliberating instead of acting ([When More Thinking Hurts, arXiv 2604.10739](https://arxiv.org/abs/2604.10739)), and ICLR 2026 ships a benchmark that scores both at once ([OptimalThinkingBench, arXiv 2508.13141](https://arxiv.org/abs/2508.13141)).
- Coding agents **degrade over long-horizon iterative work**: on SlopCodeBench the best agent solves 14.8 percent, with verbosity and code erosion growing several times faster than in human repositories ([arXiv 2603.24755](https://arxiv.org/abs/2603.24755)).
- Agents take shortcuts when they believe resources are running out. Cognition found Claude Sonnet 4.5 **underestimated its remaining context and wrapped up early**, a behavior now called context anxiety ([Inkeep's writeup](https://inkeep.com/blog/context-anxiety)).
- The failure is mainstream enough that business press covers it: advanced models showing signs of laziness is a named risk for companies betting on agents ([Fortune, July 2026](https://fortune.com/2026/07/28/advanced-ai-models-laziness-open-ai-anthropic/)).

And the v2-specific finding from this project's own controlled test: on a frontier model the visible failures (stubs, placeholders) are gone, while the invisible ones remain, premature done reports and confidently wrong numbers in final summaries. Those two are exactly what gates and the report audit target.

The upside is equally well measured. Effort is steerable. Appending a single "Wait" token and suppressing the end of thinking, called budget forcing, lifts competition math scores by double digits ([s1: Simple test-time scaling, arXiv 2501.19393](https://arxiv.org/abs/2501.19393)). Aider cut lazy coding threefold just by changing the edit format ([unified diffs](https://aider.chat/docs/unified-diffs.html)). And the ceiling keeps rising fast: METR measures the length of task agents can complete at 50 percent reliability doubling roughly every four months ([Time Horizon 1.1, January 2026](https://metr.org/blog/2026-1-29-time-horizon-1-1/)).

So: models default to minimum effort, effort responds to structure, and structure that lives in files and hooks beats structure that lives in prose. That is v2.

## The research

Everything cited, newest first:

- [Fortune: Advanced AI is showing signs of laziness](https://fortune.com/2026/07/28/advanced-ai-models-laziness-open-ai-anthropic/) (July 2026)
- [When More Thinking Hurts: Overthinking in LLM Test-Time Compute Scaling](https://arxiv.org/abs/2604.10739) (April 2026)
- [SlopCodeBench: How Coding Agents Degrade Over Long-Horizon Iterative Tasks](https://arxiv.org/abs/2603.24755) (March 2026)
- [METR Time Horizon 1.1](https://metr.org/blog/2026-1-29-time-horizon-1-1/) (January 2026)
- [Quantifying Laziness, Decoding Suboptimality, and Context Degradation in LLMs](https://arxiv.org/abs/2512.20662) (December 2025)
- [OptimalThinkingBench: Evaluating Over and Underthinking in LLMs](https://arxiv.org/abs/2508.13141) (ICLR 2026, August 2025)
- [Context Anxiety: How AI Agents Panic About Their Perceived Context Windows](https://inkeep.com/blog/context-anxiety) (2025)
- [Measuring AI Ability to Complete Long Tasks](https://arxiv.org/abs/2503.14499) (METR, March 2025)
- [Thoughts Are All Over the Place: On the Underthinking of o1-Like LLMs](https://arxiv.org/abs/2501.18585) (January 2025)
- [s1: Simple test-time scaling](https://arxiv.org/abs/2501.19393) (January 2025)
- ["Should I Give Up Now?" Investigating LLM Pitfalls in Software Engineering](https://arxiv.org/abs/2411.09916) (2024, updated 2025)
- [Unified diffs make GPT-4 Turbo 3x less lazy](https://aider.chat/docs/unified-diffs.html) (aider)

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md): cite current research for behavioral claims, keep enforcement structural, and keep it small.

## License

[MIT](LICENSE)
