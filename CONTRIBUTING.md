# Contributing

Thanks for wanting to improve unlazy. It is a small project on purpose: one skill file, one README. Contributions that keep it small are the easiest to merge.

## What is welcome

- **Research updates.** New papers or benchmarks on model laziness, underthinking, overthinking, long-horizon degradation or effort steering. Add them to the research list in the README, newest first, with a link and a one-line claim that the source actually supports.
- **Enforcement rules.** A new rule for SKILL.md needs two things: a current citation for the failure mode it counters, and wording that tells the model what to DO, not what to feel.
- **Portability fixes.** If the skill fails to load or trigger in an agent that reads SKILL.md (Claude Code, Codex, Cursor, the skills CLI), that is a bug. Include the agent name and version.
- **Wording that tightens.** Shorter and sharper beats longer and softer, everywhere in this repo.

## Ground rules

1. **The Depth Tree semantics are fixed.** Estimate T once at the root, binary split, every leaf gets the full T, no per-leaf re-estimation. PRs that weaken the multiplication will be declined; that rule is the project.
2. **Claims need sources.** Behavioral claims about models must cite research from roughly the last two years. No folklore.
3. **No em dashes, no en dashes.** House style. Use hyphens, colons or sentence breaks.
4. **Frontmatter stays spec-compliant.** `name` and `description` follow the agent skills format so every supported tool keeps parsing it.

## How

Open an issue for anything debatable, or a PR directly for anything obvious. There is no build step and no test suite: the review is a human reading the diff.
