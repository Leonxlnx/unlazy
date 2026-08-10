# Contributing

Thanks for wanting to improve unlazy. It is a small project on purpose: one skill file, a few references and three zero-dependency scripts. Contributions that keep it small are the easiest to merge.

## What is welcome

- **Research updates.** New papers or benchmarks on model laziness, underthinking, overthinking, long-horizon degradation or effort steering. Add them to the research list in the README, newest first, with a link and a one-line claim that the source actually supports.
- **Enforcement rules.** A new rule for SKILL.md needs two things: a current citation for the failure mode it counters, and wording that tells the model what to DO, not what to feel.
- **Portability fixes.** If the skill fails to load or trigger in an agent that reads SKILL.md (Claude Code, Codex, Cursor, the skills CLI), that is a bug. Include the agent name and version.
- **Wording that tightens.** Shorter and sharper beats longer and softer, everywhere in this repo.

## Ground rules

1. **Enforcement stays structural.** The v2 core rule: done is proven against gates files with runnable checks and evidence, never asserted in prose. PRs that move enforcement back into promises will be declined; that hierarchy is the project.
2. **The gate file format is a contract.** `gate-check.mjs` and `stop-hook.mjs` parse the format specified in `references/gates.md`. Format changes must update both scripts, the spec, and the templates in the same PR.
3. **Claims need sources.** Behavioral claims about models must cite research from roughly the last two years, or a reproducible measurement like the six-run test in the README. No folklore.
4. **No em dashes, no en dashes.** House style. Use hyphens, colons or sentence breaks.
5. **Frontmatter stays spec-compliant.** `name` and `description` follow the agent skills format so every supported tool keeps parsing it.
6. **Scripts stay zero-dependency.** Node 16+ standard library only, Windows and POSIX both.

## How

Open an issue for anything debatable, or a PR directly for anything obvious. There is no build step. For script changes, exercise every path by hand: a gates file with a passing check, a failing check, a regex EXPECT, a manual gate, and an ABANDON line; plus the hook's block, release-after-6, progress-reset and no-gates paths, and the installer's install, idempotence and uninstall round trip.
