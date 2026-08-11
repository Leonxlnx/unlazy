#!/usr/bin/env node
// stop-hook.mjs : Claude Code Stop hook for the unlazy skill (v2).
//
// Structurally blocks ending the turn while GATES.md / gates/*.md contain
// unmet gates. Zero tokens: this is a file scan, not a model call.
//
// Behavior:
//   - No gate files in cwd            -> allow (skill not active here)
//   - All gates met or abandoned      -> allow
//   - Unmet gates, progress happening -> block with a one-line reason
//   - Unmet gates, NO progress after MAX_BLOCKS consecutive blocks -> allow
//     with a warning (never traps a genuinely stuck agent; Claude Code
//     additionally force-releases after 8 consecutive blocks)
//
// Progress = the combined content of the gate files changed since last block.
// State lives in .unlazy-hook-state.json next to the gates (add to .gitignore).
//
// Contract (docs: code.claude.com/docs/en/hooks):
//   stdin  JSON with { cwd, stop_hook_active, ... }
//   stdout {"decision":"block","reason":"..."} + exit 0 to block; exit 0 silent to allow.

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const MAX_BLOCKS = 6;

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return "{}"; }
}

let payload = {};
try { payload = JSON.parse(readStdin() || "{}"); } catch { /* stay permissive */ }
const cwd = payload.cwd || process.cwd();

function gateFiles(dir) {
  const found = [];
  const top = join(dir, "GATES.md");
  if (existsSync(top)) found.push(top);
  const gdir = join(dir, "gates");
  if (existsSync(gdir)) {
    try {
      for (const f of readdirSync(gdir)) if (f.endsWith(".md")) found.push(join(gdir, f));
    } catch { /* ignore */ }
  }
  return found;
}

const files = gateFiles(cwd);
if (!files.length) process.exit(0); // no gates, nothing to enforce

const GATE_RE = /^- \[( |x|X)\] (.*)$/;
const EVIDENCE_RE = /^\s+EVIDENCE:\s?(.*)$/;
const ABANDON_RE = /^ABANDON:\s*(\S+)/;

let combined = "";
const unmet = [];

for (const file of files) {
  let text = "";
  try { text = readFileSync(file, "utf8"); } catch { continue; }
  combined += text;
  const lines = text.split(/\r?\n/);
  const abandoned = new Set(
    lines.map(l => (l.match(ABANDON_RE) || [])[1]).filter(Boolean).map(s => s.replace(/:$/, ""))
  );
  let cur = null; // { id, checked, evidence }
  const flush = () => {
    if (!cur || abandoned.has(cur.id)) { cur = null; return; }
    const pending = cur.evidence === null || /^pending$/i.test(cur.evidence);
    if (!cur.checked || pending) unmet.push(cur.id);
    cur = null;
  };
  for (const line of lines) {
    const g = line.match(GATE_RE);
    if (g) {
      flush();
      cur = {
        checked: g[1].toLowerCase() === "x",
        id: (g[2].match(/^(\S+?):/) || [null, g[2].trim().slice(0, 24)])[1],
        evidence: null,
      };
      continue;
    }
    const ev = cur && line.match(EVIDENCE_RE);
    if (ev) cur.evidence = ev[1].trim();
  }
  flush();
}

if (!unmet.length) process.exit(0); // everything met or honestly abandoned

// Progress-aware loop guard.
const statePath = join(cwd, ".unlazy-hook-state.json");
const hash = createHash("sha256").update(combined).digest("hex").slice(0, 16);
let state = { hash: "", blocks: 0 };
try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch { /* fresh */ }
if (state.hash !== hash) state = { hash, blocks: 0 }; // progress -> reset counter
state.blocks += 1;
try { writeFileSync(statePath, JSON.stringify(state)); } catch { /* non-fatal */ }

if (state.blocks > MAX_BLOCKS) {
  // No progress across MAX_BLOCKS consecutive stops: release rather than trap.
  console.log(JSON.stringify({
    systemMessage: `unlazy: releasing after ${MAX_BLOCKS} blocks without gate progress; ${unmet.length} gates remain unmet (${unmet.slice(0, 4).join(", ")}).`,
  }));
  process.exit(0);
}

const list = unmet.slice(0, 5).join(", ") + (unmet.length > 5 ? `, +${unmet.length - 5} more` : "");
console.log(JSON.stringify({
  decision: "block",
  reason: `unlazy: ${unmet.length} gate(s) unmet: ${list}. Work the next unchecked gate (run gate-check.mjs to execute CHECK lines), or add "ABANDON: <id> <reason>" if one is genuinely impossible. Done means every box checked with evidence.`,
}));
process.exit(0);
