# Validation findings: unlazy v2.0.0

Validated 2026-08-16, at commit `ed9e8d2` (main). Method: every script
exercised empirically in sandboxes (pass, fail, regex, manual, ABANDON,
forged evidence, loop guard, installer round trip); SKILL.md checked
against the official Claude Code skills and hooks documentation; all 12
README research citations followed to their primary sources. Reproduction
commands are inline. House style (hyphens, no em dashes) respected.

## Verdict

The skill is substantially what it claims. The enforcement scripts work
as documented in every behavior their own CONTRIBUTING test matrix
covers, the README's research base is real and accurately characterized
(12 of 12 citations resolve, claims match sources), and the SKILL.md
follows agent-skills conventions with genuine progressive disclosure.
Three findings matter beyond cosmetics: one real argument-parsing bug in
`gate-check.mjs`, one enforcement gap (forged evidence passes every
layer) that undercuts the README's "self-certification is worthless"
claim, and one security consideration (gate files are executable content)
that deserves a documented threat model.

## 1. Empirical script testing

### 1.1 gate-check.mjs: works as specified

Verified on a fixture covering every documented path: substring EXPECT
pass, substring EXPECT fail, regex EXPECT (`/total: \d+ items/`) pass,
no-EXPECT gates decided by exit code (both directions), checked-box-with-
pending-evidence recovered by re-run, checked-with-evidence left alone,
manual gate without CHECK, ABANDON honored (counted abandoned, not unmet),
exit codes 0/1/2, evidence capped to the tail two lines at 200 chars,
second run re-runs only unmet gates. `--timeout 1` against `sleep 5`
fails cleanly with `ETIMEDOUT`. All as documented in
[references/gates.md](../references/gates.md) and the script header.

### 1.2 BUG (P1): positional file argument at index 0 is silently dropped

`scripts/gate-check.mjs:23`:

```js
const fileArgs = args.filter((a, i) => !a.startsWith("--") && i !== tIdx + 1);
```

When `--timeout` is absent, `tIdx` is -1, so `tIdx + 1` is 0 and the
filter drops `argv` position 0 unconditionally. Reproduced:

```
$ node gate-check.mjs elsewhere/custom-gates.md
gate-check: no gate files found (GATES.md or gates/*.md)   # exit 2
$ node gate-check.mjs --status elsewhere/custom-gates.md
  UNMET X1 (unchecked): explicit file arg                    # works
```

Impact: `gate-check.mjs gates/leaf-x.md` (single positional arg, no
leading flag) silently ignores the named file and falls back to defaults.
In an orchestrated cwd that means checking every leaf's gates instead of
one leaf; in a bare cwd it means a spurious exit 2. The documented
orchestration commands happen to put `--status` first, which is why this
survived the project's own manual test matrix, which never exercises the
no-flag positional form. Fix: apply the index exclusion only when
`tIdx !== -1`, e.g. `i !== (tIdx === -1 ? -2 : tIdx + 1)`.

### 1.3 GAP (P2): forged evidence passes every enforcement layer

A leaf that hand-checks its boxes and hand-writes `EVIDENCE:` lines
passes `--status` AND a plain re-run, because gates are only re-executed
when unchecked or evidence-pending (`gate-check.mjs:118`). Reproduced
with a "lying leaf" file: both invocations report `ALL MET`, exit 0.

This matters because
[references/orchestration.md](../references/orchestration.md) step 3
tells the driver to verify via `gate-check.mjs --status gates/leaf-x.md`,
and the README sells layer 4 of the enforcement hierarchy as "the
dispatcher re-runs each leaf's checks; self-certification is worthless."
As shipped, the parent has no mechanical way to re-run a satisfied
leaf's CHECK commands; it must spot-check by hand, which is prose
discipline again, the exact thing v2 claims to have moved past. A
`--reverify` flag that re-executes CHECK commands for all gates
regardless of checkbox state would close this and make the parent layer
mechanical. The stop hook has the same property by design (it scans, it
does not execute), so hard enforcement is hard against laziness but soft
against deception. That is consistent with the skill's stated threat
model (quiet incompleteness, not adversarial lying), but the
orchestration docs overpromise.

### 1.4 Minor parser observations

- Unindented `CHECK:` / `EXPECT:` lines are silently ignored and the gate
  degrades to manual. A stderr warning would catch format slips.
- The two parsers use different fallback IDs for gates lacking an `ID:`
  prefix (`line<N>` in gate-check vs first 24 title chars in stop-hook),
  so an ABANDON line naming a fallback id can be honored by one tool and
  not the other. Edge case; only bites id-less gates.
- `gate-check.mjs:155` rejoins with `\n`, silently normalizing CRLF
  files to LF on first write. Cosmetic given the Windows claim in the
  README.
- Static review of the imports and syntax (optional chaining, no recent
  APIs) is consistent with the Node 16+ claim; not verified on a Node 16
  runtime.

### 1.5 stop-hook.mjs: works as specified

Simulated stdin payloads against sandboxes: no gate files allows silently;
unmet gates emit `{"decision":"block","reason":...}` with exit 0; checked-
but-pending-evidence counts as unmet; ABANDON lines allow; all-met allows;
malformed stdin stays permissive (allow). The progress-aware loop guard
behaves exactly as documented: state hash over combined gate-file content,
six consecutive no-progress blocks, seventh stop releases with a
`systemMessage` warning naming the unmet gates. Gate-file edits reset the
counter. State file `.unlazy-hook-state.json` is written to cwd (README
says gitignore it).

Contract check against the official hooks reference
([code.claude.com/docs/en/hooks][hooksref], [hooks guide][hooksguide]):
stdin `cwd` confirmed; structured stdout with `decision`/`reason` plus
exit 0 is the documented block mechanism; `systemMessage` is a valid
universal output field; the settings shape written by the installer
(`hooks.Stop[].hooks[]{type:"command",command,timeout}`) matches the
documented schema, no matcher needed for Stop, and `timeout` is per-hook
seconds (20 set vs 600 default, conservative).

Two deviations from documented best practice, both defensible but worth
knowing:

- The docs state "Stop hooks receive `stop_hook_active`. The
  `stop_hook_active` field is true when Claude Code is already continuing
  as a result of a stop hook" and the common pattern is to allow when it
  is true. This script ignores it in favor of its own progress-aware
  counter. That is strictly more capable than the standard one-block
  pattern (it buys up to six productive blocks), and its own cap bounds
  the loop, so this is a reasonable design choice, not a bug.
- The script comment claims "Claude Code additionally force-releases
  after 8 consecutive blocks". The docs confirm a consecutive-block cap
  exists ("ends the turn with a warning that the Stop hook blocked too
  many consecutive times" in the guide) but no number appears in the
  documentation I could find. Treat "8" as unverified.

### 1.6 install-hooks.mjs: works as specified

Install into `.claude/settings.local.json`, idempotent second run
(changes nothing), uninstall removes the entry and cleans up empty
`hooks`/`Stop` keys, leaving `{}`. Refuses to touch invalid JSON. The
`--global` / `--shared` / default targets are as documented. Output
tells the user what it does and how to remove it, matching the
"never install silently" rule in SKILL.md.

## 2. SKILL.md spec compliance

Against [code.claude.com/docs/en/skills][skillsdocs]:

- `name: unlazy` valid; `description` is 538 characters, well under the
  1,536-character listing truncation, written as what-it-does plus
  when-to-use with trigger phrases ("/unlazy", "tree N", "gates"),
  exactly the documented style. `license` accepted; `metadata` is a
  free-form map so `author`/`source`/`version` are valid, and the
  frontmatter set is compatible with the stricter six-field packaging
  subset.
- Body is 105 lines against the documented "keep SKILL.md under 500
  lines" guidance; roughly 2.2k tokens. References are 600-900 tokens
  each and are linked from the core with what/when context, which is the
  documented progressive-disclosure pattern. The token-economy claims in
  the skill are consistent with its actual file sizes.
- One improvement: the docs recommend `${CLAUDE_SKILL_DIR}` when
  referencing bundled scripts so they resolve and run without permission
  prompts. SKILL.md uses a `<this-skill-dir>` prose placeholder instead,
  leaving the agent to infer the absolute path at invocation time.
  Swapping the placeholder for the variable in the two command examples
  would make them copy-paste runnable in Claude Code.
- The README's install instructions via the skills CLI are accurate:
  `npx skills add <owner>/<repo>` with `-g` and `--all` flags is the
  documented syntax of [vercel-labs/skills][skillcli], which discovers
  skills by SKILL.md.

## 3. Citation audit (12 of 12 resolve; claims match)

| README claim | Source | Verdict |
|---|---|---|
| Laziness = premature truncation + partial compliance, failures persist under explicit prompting | [arXiv 2512.20662][q-lazy] | Accurate; Dec 19 2025, abstract matches nearly verbatim |
| Underthinking = abandoning promising lines of thought | [arXiv 2501.18585][underthink] | Accurate; Jan 30 2025 |
| Overthinking exists; more thinking can hurt | [arXiv 2604.10739][overthink] | Accurate; Apr 12 2026 |
| Benchmark scoring both at once, "ICLR 2026" | [arXiv 2508.13141][otb] | Paper real and matches; the ICLR 2026 venue is not stated on the arXiv page, unverified |
| Best agent 14.8%, degradation faster than human repos | [arXiv 2603.24755][slopcode] | Accurate; also: explicit quality guidance cuts verbosity/erosion by a third, which supports this skill's premise |
| 50%-reliability horizon doubling roughly every four months | [METR Time Horizon 1.1][metr11] | Accurate; Jan 29 2026, 130.8 days ~ 4.3 months (post-2023) |
| "Measuring AI Ability to Complete Long Tasks" | [arXiv 2503.14499][metrarxiv] | Paper real; exact title is "...Complete Long **Software** Tasks", and the doubling time there is ~7 months since 2019 (the README's four-month figure comes from the newer 1.1 post, so no contradiction, just an imprecise title) |
| Budget forcing, "Wait" tokens, double-digit math gains | [arXiv 2501.19393][s1] | Accurate; up to 27% over o1-preview, AIME24 50 to 57 percent |
| LLM pitfalls incl. premature abandonment | [arXiv 2411.09916][giveup] | Accurate; v3 revised Apr 13 2026 |
| Unified diffs make GPT-4 Turbo 3x less lazy | [aider.chat][aider] | Accurate; 4 vs 12 lazy-comment tasks |
| Context anxiety; Cognition's Claude Sonnet 4.5 wrapped up early | [Inkeep][inkeep] | Accurate; Oct 3 2025 writeup of Cognition's Devin rebuild |
| Business press covers model laziness | [Fortune, Jul 28 2026][fortune] | Accurate; headline matches |

A detail worth noticing: the Fortune article's centerpiece anecdote is a
Claude Code session that "claimed to have processed 80 files when it had
only opened 11". SKILL.md's "Full files, full lists, full sweeps" rule
("if the task says all 80 files, the count opened must be 80") reads as
the direct countermeasure to that exact public incident.

## 4. Security considerations

- **Gate files are executable content.** `gate-check.mjs` runs CHECK
  lines through a shell (`gate-check.mjs:120`, `shell: true`). In the
  intended flow the agent writes its own gates, so this is fine. But a
  foreign repository can ship a `GATES.md` or `gates/*.md`, and the
  moment a user runs `/unlazy` in that repo the agent will execute
  whatever those CHECK lines contain, with the user's privileges,
  before any human review. The stop hook is scan-only by design (good
  separation), but the docs never tell the user that inherited gate
  files should be treated like postinstall scripts: read before the
  first gate-check run in any repo you did not create gates in. This
  deserves a paragraph in the README's hard-mode section.
- The hook state file is fail-open (unreadable, corrupt, or hostile JSON
  all result in allow-or-normal behavior), which is the right failure
  direction for a productivity hook.
- The installer writes only deterministic JSON via `JSON.stringify`
  (no injection surface) and refuses malformed targets.

## 5. Insights

1. **The core design bet is sound and correctly aimed.** The v2 thesis,
   enforcement in files and subprocesses rather than prose, targets
   exactly the failures the literature measures: partial compliance
   under explicit prompting ([arXiv 2512.20662][q-lazy]), long-horizon
   erosion ([arXiv 2603.24755][slopcode]), and premature wrap-up under
   perceived context pressure ([Inkeep][inkeep]). The stop hook is the
   same move as budget forcing ([arXiv 2501.19393][s1]) at the harness
   layer: suppress the stop signal and the model keeps working.
2. **The five-layer hierarchy is honest except at layer 4.** Layers 1-3
   and 5 are mechanical as claimed. Layer 4 (parent re-verification) is
   half mechanical: the parent can see status but cannot force re-
   execution, so against a deceptive leaf it degrades to spot-checking
   by hand. A `--reverify` flag is the single highest-leverage change
   to make the README's strongest claim true.
3. **The failure the skill is best at is the one it measured.** The
   report-audit rule (re-measure every number) plus CHECK-measured
   numbers for anything that appears in a report attacks the "1-3 wrong
   numbers per report" finding directly, and the Fortune anecdote shows
   the failure class is publicly documented, not folklore.
4. **SlopCodeBench quietly validates the gates format itself.** Its
   finding that explicit quality guidance cut verbosity and erosion by
   up to a third without stopping degradation is evidence that prose
   helps but does not hold, which is precisely the v1-to-v2 lesson the
   repo derives from its own six-run test. External and internal
   evidence agree.
5. **Token economy claims check out on inspection.** Core at ~2.2k
   tokens, references loaded on demand, checks as subprocesses, capped
   evidence, append-only logs, and a scan-only hook are all real
   properties of the artifact, not just documentation claims.
6. **What I would ship next**, in order: fix the arg off-by-one (1.2);
  add `--reverify` (1.3); use `${CLAUDE_SKILL_DIR}` in the script
  invocations (section 2); document the untrusted-gates threat model
  (section 4); warn on unindented attributes and align the fallback-ID
  logic between the two parsers (1.4); soften or source the "8
  consecutive blocks" comment (1.5).

Postscript: five of the six items above shipped as v2.1.0 on 2026-08-16,
along with CRLF preservation, deterministic (sorted) gate-file reads for
the hook's progress hash, fenced-example immunity in both parsers, CLI
usage validation, evidence insertion for gates missing an EVIDENCE line,
and `scripts/verify.mjs` as the regression harness (33 checks, all
passing at ship time). Item 3 (`${CLAUDE_SKILL_DIR}`) was implemented and
then reverted by maintainer preference: the skill's prose stays
harness-neutral with the original `<skill-dir>` placeholders, at a small
cost in Claude Code convenience (the agent resolves the path itself
instead of the harness substituting it). See the CHANGELOG.

## Sources

- [Claude Code hooks reference][hooksref]
- [Claude Code hooks guide][hooksguide]
- [Claude Code skills documentation][skillsdocs]
- [vercel-labs/skills CLI][skillcli]
- [arXiv 2512.20662, Quantifying Laziness][q-lazy]
- [arXiv 2501.18585, Thoughts Are All Over the Place][underthink]
- [arXiv 2604.10739, When More Thinking Hurts][overthink]
- [arXiv 2508.13141, OptimalThinkingBench][otb]
- [arXiv 2603.24755, SlopCodeBench][slopcode]
- [METR Time Horizon 1.1, Jan 2026][metr11]
- [arXiv 2503.14499, Measuring AI Ability to Complete Long Software Tasks][metrarxiv]
- [arXiv 2501.19393, s1: Simple test-time scaling][s1]
- [arXiv 2411.09916, "Should I Give Up Now?"][giveup]
- [aider.chat, unified diffs][aider]
- [Inkeep, Context Anxiety][inkeep]
- [Fortune, Advanced AI models are showing signs of laziness][fortune]

[hooksref]: https://code.claude.com/docs/en/hooks
[hooksguide]: https://code.claude.com/docs/en/hooks-guide
[skillsdocs]: https://code.claude.com/docs/en/skills
[skillcli]: https://github.com/vercel-labs/skills
[q-lazy]: https://arxiv.org/abs/2512.20662
[underthink]: https://arxiv.org/abs/2501.18585
[overthink]: https://arxiv.org/abs/2604.10739
[otb]: https://arxiv.org/abs/2508.13141
[slopcode]: https://arxiv.org/abs/2603.24755
[metr11]: https://metr.org/blog/2026-1-29-time-horizon-1-1/
[metrarxiv]: https://arxiv.org/abs/2503.14499
[s1]: https://arxiv.org/abs/2501.19393
[giveup]: https://arxiv.org/abs/2411.09916
[aider]: https://aider.chat/docs/unified-diffs.html
[inkeep]: https://inkeep.com/blog/context-anxiety
[fortune]: https://fortune.com/2026/07/28/advanced-ai-models-laziness-open-ai-anthropic/
