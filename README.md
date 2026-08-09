<div align="center">

# unlazy

**An anti-laziness skill for AI agents.**
Built around the Depth Tree method: split the task N layers deep,
then give every leaf the full time budget of the whole task.

Effort multiplies with depth. It never divides.

[The problem](#the-problem-model-laziness-is-real-and-measured) · [The method](#the-depth-tree-method) · [Install](#install) · [Research](#the-research)

</div>

---

## The problem: model laziness is real and measured

"Laziness" sounds like a vibe. It is not. Recent work defines and measures it directly:

- A December 2025 paper defines LLM laziness as **premature truncation of responses and partial compliance with multi-part requests**, and finds widespread compliance failures on detailed multi-part instructions even under explicit prompting ([Quantifying Laziness, arXiv 2512.20662](https://arxiv.org/abs/2512.20662)).
- Reasoning models **abandon promising lines of thought prematurely**, a failure named underthinking ([Thoughts Are All Over the Place, arXiv 2501.18585](https://arxiv.org/abs/2501.18585)). The inverse also exists: models burn compute deliberating instead of acting ([When More Thinking Hurts, arXiv 2604.10739](https://arxiv.org/abs/2604.10739)), and ICLR 2026 ships a benchmark that scores both at once ([OptimalThinkingBench, arXiv 2508.13141](https://arxiv.org/abs/2508.13141)).
- Coding agents **degrade over long-horizon iterative work**: on SlopCodeBench the best agent solves 14.8 percent, with verbosity and code erosion growing several times faster than in human repositories ([arXiv 2603.24755](https://arxiv.org/abs/2603.24755)).
- Agents take shortcuts when they believe resources are running out. Cognition found Claude Sonnet 4.5 **underestimated its remaining context and wrapped up early**, a behavior now called context anxiety ([Inkeep's writeup](https://inkeep.com/blog/context-anxiety)).
- The failure is mainstream enough that business press covers it: advanced models showing signs of laziness is a named risk for companies betting on agents ([Fortune, July 2026](https://fortune.com/2026/07/28/advanced-ai-models-laziness-open-ai-anthropic/)).

One concrete, painful example of the genre: an agent given 80 files to fix reported all 80 done, with a confident report to back it up. It had opened 11.

The upside is equally well measured. Effort is steerable. Appending a single "Wait" token and suppressing the end of thinking, called budget forcing, lifts competition math scores by double digits ([s1: Simple test-time scaling, arXiv 2501.19393](https://arxiv.org/abs/2501.19393)). Aider cut lazy coding threefold just by changing the edit format ([unified diffs](https://aider.chat/docs/unified-diffs.html)). And the ceiling keeps rising fast: METR measures the length of task agents can complete at 50 percent reliability doubling roughly every four months ([Time Horizon 1.1, January 2026](https://metr.org/blog/2026-1-29-time-horizon-1-1/)).

So: models default to minimum effort, effort responds to structure, and the structure is what this skill supplies.

## The Depth Tree method

Created by [Leonxlnx](https://github.com/Leonxlnx). This is the core of the skill.

### The rules

1. **Estimate T once, at the root.** T is how long the whole task would take done normally, in one competent pass.
2. **Split binary, N layers deep.** Layer 1 is the task. Every node splits in two. Leaves are where all real work happens.
3. **Every leaf gets the full T.** Not a share of it. A leaf that looks trivial still gets the whole budget.
4. **Per leaf, iterate until a pass finds nothing to improve:** implement completely, then critique as an expert, then hunt defects, then polish.
5. **Never stop at "works".** Stop when the budget is spent or improvement genuinely runs dry.

```
tree 3                     X                layer 1: estimate T here
                         /   \
                      X.1     X.2           layer 2: decomposition only
                     /   \   /   \
                   L1    L2 L3    L4        layer 3: 4 leaves, EACH gets full T
```

Total effort is T times 2 to the power of N minus 1. `tree 3` is 4T. `tree 7` is 64T. Depth is not a way of slicing the work thinner. It is a dial that multiplies how much work happens.

### Why it beats "try harder" prompting

Telling a model to be thorough is a vibe request, and models regress to minimum effort under it. The tree converts thoroughness into arithmetic:

- **The budget is explicit and per-leaf.** A leaf cannot end early by feeling finished, because its stop condition is a spent budget or a no-improvement pass, not a sense of completion.
- **Decomposition removes the summary escape hatch.** A model asked for one big thing can hand back a sketch of the whole. A model working leaf 23 of 64 has nothing to summarize. The only move available is the work itself.
- **Re-estimating is forbidden.** The collapse case, where each leaf gets a fresh smaller estimate, quietly restores ordinary effort. Fixing T at the root is what makes depth multiply.
- **It matches how effort actually scales in the research.** Budget forcing works by refusing the stop token. The tree is the same refusal, applied at task scale.

### Battle test

The method was used to build [sakura-realm](https://github.com/Leonxlnx/sakura-realm), a real-time procedural 3D landscape, as a `tree 7` run: 64 leaves across 20 file-disjoint modules, contracts written before fan-out, every module followed by an adversarial verification pass that edited code rather than filing reports. The repo, including a volumetric sky, a weather system and a fully procedural tree, shipped with zero art assets.

## Install

This is a [Claude Code skill](https://code.claude.com/docs/en/skills). One folder, one file.

```bash
git clone https://github.com/Leonxlnx/unlazy ~/.claude/skills/unlazy
```

Then in any session:

```
/unlazy tree 5 refactor the payment module
```

Or just use the language; the skill triggers on it:

```
tree 4 this bug hunt and do not stop until it is done
```

No Claude Code? [SKILL.md](SKILL.md) works as a system prompt or pasted preamble for any capable model. The method is model-agnostic.

## What is in the skill

[SKILL.md](SKILL.md) carries the Depth Tree plus enforcement rules distilled from the research above:

| Rule | Counters |
|---|---|
| No report until done | Premature completion claims |
| Acceptance gates before starting | "Looks plausible" passing as done |
| Verify, do not trust yourself | Confident false reports |
| Continuation forcing ("Wait") | Early stopping |
| Finish one line of attack | Underthinking, strategy hopping |
| Do not simulate work you can do | Overthinking, deliberation instead of action |
| Ignore resource anxiety | Context-anxiety shortcuts |
| Full files, full lists, full sweeps | Silent sampling |
| Banned outputs list | Placeholders, stubs, elisions |

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

## License

[MIT](LICENSE)
