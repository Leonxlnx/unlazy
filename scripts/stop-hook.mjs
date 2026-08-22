#!/usr/bin/env node
// stop-hook.mjs : Claude Code Stop hook for the unlazy skill (v2.1).
//
// Structurally blocks ending the turn while THIS pipeline's gates are unmet.
// Zero tokens: a file scan, not a model call.
//
// Usage in a Stop hook command:
//   node stop-hook.mjs                  guard whichever pipeline this session owns
//   node stop-hook.mjs --scope api      guard .unlazy/api/ specifically
//
// Only --scope is read. Any other argument is ignored, including the "--unlazy"
// tag the installer appends so its own entries stay identifiable in settings
// without depending on the install path.
//
// Scope resolution, in order: --scope, UNLAZY_SCOPE, the session binding in
// .unlazy/<scope>/session, the only pipeline present, else the legacy
// GATES.md + gates/*.md layout under cwd.
//
// Behavior:
//   - No gate files                       -> allow (skill not active here)
//   - Scope cannot be resolved            -> allow, with a note. A session is
//     never blocked by a pipeline it does not own; that is the whole point of
//     scoping, and blocking on someone else's work is unactionable.
//   - All gates met or abandoned          -> allow
//   - Unmet gates, progress happening     -> block, naming file-qualified ids
//   - Unmet gates, no progress after MAX_BLOCKS consecutive blocks -> allow
//     with a warning (never traps a genuinely stuck agent; Claude Code also
//     force-releases after 8 consecutive blocks)
//
// Progress = this scope's gate files changed since the last block. The counter
// lives in .unlazy/<scope>/hook-state.json, one per pipeline, so pipelines
// cannot reset or exhaust each other's loop guard.
//
// Contract (docs: code.claude.com/docs/en/hooks):
//   stdin  JSON with { cwd, session_id, stop_hook_active, ... }
//   stdout {"decision":"block","reason":"..."} + exit 0 to block;
//          exit 0 with no output to allow.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  parseGates, qualify, gateState, resolveTarget, hookStatePath, UNLAZY_DIR,
} from "./lib/gates.mjs";

const MAX_BLOCKS = 6;

const args = process.argv.slice(2);
const scopeArg = (() => {
  const i = args.indexOf("--scope");
  return i !== -1 ? args[i + 1] : null;
})();

let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8") || "{}"); } catch { /* stay permissive */ }
const root = payload.cwd || process.cwd();
const sessionId = payload.session_id || payload.sessionId || null;

const allow = (msg) => {
  if (msg) console.log(JSON.stringify({ systemMessage: msg }));
  process.exit(0);
};

const target = resolveTarget({ root, scope: scopeArg, sessionId });

if (target.ambiguous) {
  allow("unlazy: " + target.ambiguous.length + " pipelines under " + UNLAZY_DIR +
    "/ (" + target.ambiguous.join(", ") + ") and none bound to this session; " +
    "not blocking. Bind one with UNLAZY_SCOPE or install the hook with --scope <id>.");
}
if (target.error || !target.files.length) allow(null);

let combined = "";
const unmet = [];

for (const file of target.files) {
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  combined += text;
  const doc = parseGates(text);
  for (const g of doc.gates) {
    const st = gateState(g, doc.abandoned);
    // Qualified ids: "G1" alone is ambiguous the moment a tree has more than
    // one gate file, which makes an otherwise correct block unactionable.
    if (st === "unmet" || st === "unmet-no-evidence") unmet.push(qualify(file, g.id));
  }
}

if (!unmet.length) process.exit(0); // everything met or honestly abandoned

// Progress-aware loop guard, per pipeline.
const statePath = hookStatePath(root, target.scope);
const hash = createHash("sha256").update(combined).digest("hex").slice(0, 16);
let state = { hash: "", blocks: 0 };
try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch { /* fresh */ }
if (state.hash !== hash) state = { hash, blocks: 0 }; // progress -> reset counter
state.blocks += 1;
try { writeFileSync(statePath, JSON.stringify(state)); } catch { /* non-fatal */ }

const where = target.scope ? " [scope " + target.scope + "]" : "";

if (state.blocks > MAX_BLOCKS) {
  allow("unlazy: releasing after " + MAX_BLOCKS + " blocks without gate progress" +
    where + "; " + unmet.length + " gates remain unmet (" + unmet.slice(0, 4).join(", ") + ").");
}

const list = unmet.slice(0, 5).join(", ") +
  (unmet.length > 5 ? ", +" + (unmet.length - 5) + " more" : "");
console.log(JSON.stringify({
  decision: "block",
  reason: "unlazy" + where + ": " + unmet.length + " gate(s) unmet: " + list +
    '. Work the next unchecked gate (run gate-check.mjs' +
    (target.scope ? " --scope " + target.scope : "") +
    ' to execute CHECK lines), or add "ABANDON: <id> <reason>" if one is ' +
    "genuinely impossible. Done means every box checked with evidence.",
}));
process.exit(0);
