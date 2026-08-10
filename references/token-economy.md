# Token economy

Thoroughness and cost discipline are not opposites; the six-run test that
motivated v2 measured both. The tree runs produced deeper work at 1.6 to
3.9 times the output tokens, but their input-side cost ballooned to tens of
millions of cached-context tokens because one ever-growing context carried
everything. These rules keep v2's enforcement nearly free and its deep runs
affordable.

## Enforcement should cost almost nothing

- **Checks are shell commands, not re-reading.** Every CHECK line converts
  "model re-derives whether this is true" (thousands of tokens, fallible)
  into a subprocess (zero tokens, repeatable). If you notice yourself
  re-verifying something by reading, that is a missing CHECK line.
- **The stop-hook is a regex scan, not a model call.** Blocking early stops
  costs milliseconds and zero tokens. Structural enforcement is the cheapest
  enforcement there is.
- **Evidence is capped.** The deciding tail of output, roughly five lines,
  never a full log. A gates file should stay readable in one screen per
  leaf, because it gets re-read often.

## Context hygiene for long runs

- **Lean leaf briefs.** A dispatched leaf receives the contract plus its own
  gates file. It never receives the driver's transcript, the other leaves'
  outputs, or the full PLAN.md. Measured baseline: a monolithic deep run
  consumed roughly 58 million cached input tokens; leaf isolation caps each
  context at what its work needs.
- **Append, never rewrite.** PLAN.md's status log is append-only. Rewriting
  a file's head invalidates prompt cache for everything after it; appending
  keeps the stable prefix stable. The same goes for gates files: gate-check
  edits lines in place rather than regenerating the file.
- **Progressive disclosure.** This skill keeps its core small and loads
  references only when the mode needs them. Extend it the same way: task
  documents split into a small always-loaded core and on-demand details.

## Spend where it compounds

- **Tier models by leaf type** (see orchestration.md): cheap model for
  mechanical leaves, strong model for design, integration and every
  verification pass.
- **Do not orchestrate small tasks.** Under roughly half an hour of work,
  each subagent's context re-establishment outweighs the attention gain.
  Solo mode with a gates file gives you most of the discipline at a fraction
  of the cost.
- **Depth is not a spend dial.** Measured: within one context, deeper trees
  cost about the same and redistribute effort toward verification. What
  multiplies cost is orchestration, and it should multiply it, because each
  leaf buys a fresh context. Choose depth by the leaf-size rule in
  method.md, then let the mode decision (solo vs orchestrated) set the
  budget honestly.
- **Verification is the last thing to cut.** In the motivating test, the
  cheapest run's only hard failure (content invisible in background tabs)
  was precisely a missing verification pass, and the fix cost its siblings
  a few hundred tokens of checking. Cut narration, cut recap, cut log
  pasting; never cut the check that would have caught the bug.
