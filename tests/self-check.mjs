#!/usr/bin/env node
// self-check.mjs : structural checks on the skill's own scripts.
//
//   node tests/self-check.mjs
//
// Lives in a file rather than as an inline `node -e` in GATES.md on purpose: a
// one-liner containing quotes, "^" or "!" is parsed differently by cmd.exe and
// by sh, so an inline check can pass on one platform and report a phantom
// failure on the other. A CHECK line should name a script, not embed one.
//
// Prints "self-check ok (N/N)" on success, which is what the gate matches.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = [
  "scripts/gate-check.mjs",
  "scripts/gate-lint.mjs",
  "scripts/dispatch-check.mjs",
  "scripts/stop-hook.mjs",
  "scripts/install-hooks.mjs",
  "scripts/lib/gates.mjs",
  "scripts/lib/dispatch.mjs",
  "scripts/lib/check-supervisor.mjs",
  "scripts/lib/process-tree.mjs",
  "scripts/lib/regex-worker.mjs",
  "tests/run-tests.mjs",
  "tests/dispatch-tests.mjs",
  "tests/hardening-tests.mjs",
  "tests/stress-tests.mjs",
  "tests/lint-tests.mjs",
  "tests/contract-tests.mjs",
  "tests/self-check.mjs",
];

const read = (p) => readFileSync(join(ROOT, p), "utf8");
const checks = [];
const check = (name, fn) => checks.push({ name, fn });

check("zero non-stdlib imports", () => {
  const bad = [];
  for (const p of SCRIPTS) {
    for (const m of read(p).matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)) {
      const spec = m[1];
      if (!spec.startsWith("node:") && !spec.startsWith(".")) bad.push(p + " -> " + spec);
    }
  }
  return bad.length ? "non-stdlib import: " + bad.join(", ") : null;
});

check("one shared gate parser", () => {
  // The v2.0 checker and hook each had their own GATE_RE and disagreed about a
  // gate's id when it carried no "Gn:" prefix. Parsing now lives only in the lib.
  // This file names GATE_RE to describe the rule, so it scans only scripts/.
  const owners = SCRIPTS.filter(p => p.startsWith("scripts/") && read(p).includes("GATE_RE"));
  return owners.length === 1 && owners[0] === "scripts/lib/gates.mjs"
    ? null
    : "GATE_RE should exist only in scripts/lib/gates.mjs, found in: " + owners.join(", ");
});

check("no index-arithmetic argument filtering", () => {
  // The v2.0 arg filter dropped index tIdx+1, which is 0 when --timeout is
  // absent, silently discarding the first file argument.
  return read("scripts/gate-check.mjs").includes("i !== tIdx + 1")
    ? "gate-check.mjs still filters arguments by index arithmetic"
    : null;
});

check("gate files are written atomically", () => {
  const src = read("scripts/gate-check.mjs");
  if (!src.includes("writeAtomic")) return "gate-check.mjs does not write via writeAtomic";
  if (!src.includes("withFileLock")) return "gate-check.mjs does not take a lock before writing";
  return null;
});

check("checks wait for close and cap output", () => {
  const src = read("scripts/gate-check.mjs");
  if (!src.includes('child.once("close"')) return "gate runner does not settle on stdio close";
  if (src.includes('child.once("exit"')) return "gate runner settles on exit before stdio close";
  if (!src.includes("MAX_OUTPUT_BYTES")) return "gate runner has no explicit output cap";
  return null;
});

check("approval identity binds execution semantics", () => {
  const src = read("scripts/gate-check.mjs");
  const required = [
    "check:", "expect:", "cwd", "shell", "timeoutMs", "maxOutputBytes",
    "regexTimeoutMs", "regexStartupTimeoutMs", "maxRegexWorkers", "platform", "path:",
  ];
  const missing = required.filter(token => !src.includes(token));
  return missing.length ? "approval oracle missing source tokens: " + missing.join(", ") : null;
});

check("the hook resolves a scope rather than globbing the tree", () => {
  const src = read("scripts/stop-hook.mjs");
  if (!src.includes("resolveTarget")) return "stop-hook.mjs does not resolve a scope";
  if (!src.includes("hookStatePath")) return "stop-hook.mjs does not use a per-scope state path";
  return null;
});

check("every local resource the skill names exists", () => {
  const skill = read("SKILL.md");
  const missing = [];
  const named = new Set();
  for (const m of skill.matchAll(/`((?:references|templates|scripts)\/[^`\s]+|SECURITY\.md)`/g)) named.add(m[1]);
  for (const path of named) {
    try { read(path); } catch { missing.push(path); }
  }
  return missing.length ? "SKILL.md names missing local resources: " + missing.join(", ") : null;
});

check("all executable sources retain the Node 16 floor", () => {
  const bad = SCRIPTS.filter(p => /Node 1[89]\+/.test(read(p)));
  return bad.length ? "newer runtime claim in: " + bad.join(", ") : null;
});

check("the PLAN template carries a revisioned contract denominator", () => {
  const plan = read("templates/PLAN.md");
  const required = [
    "Current contract inventory", "Contract revision", "Required outcome or constraint",
    "Owner", "Observing gate or manual review", "Disposition", "REMOVED_BY_USER",
  ];
  const missing = required.filter((token) => !plan.includes(token));
  return missing.length ? "PLAN contract inventory missing: " + missing.join(", ") : null;
});

check("request reconciliation keeps the focused solo cheap path", () => {
  const skill = read("SKILL.md");
  if (!skill.toLowerCase().includes("re-read the current request")) return "SKILL.md lacks final request reread";
  if (!skill.includes("a PLAN table is not required")) return "focused solo path was made needlessly orchestrated";
  if (!read("references/orchestration.md").includes("review every current contract row")) {
    return "orchestration guide lacks final contract reconciliation";
  }
  return null;
});

check("abandonment is terminal handoff rather than ALL MET", () => {
  const checker = read("scripts/gate-check.mjs");
  const hook = read("scripts/stop-hook.mjs");
  if (!checker.includes("HANDOFF REQUIRED") || !checker.includes("totalAbandoned === 0")) {
    return "gate checker can still classify abandonment as completion";
  }
  if (!hook.includes("HANDOFF REQUIRED") || !hook.includes("handoffs")) {
    return "Stop hook does not surface bounded abandonment handoff";
  }
  return null;
});

let passed = 0;
const failures = [];
for (const c of checks) {
  let problem;
  try { problem = c.fn(); } catch (e) { problem = e.message; }
  if (problem) { failures.push(c.name + ": " + problem); console.log("FAIL " + c.name + "\n     " + problem); }
  else { passed++; console.log("ok   " + c.name); }
}

console.log("");
if (failures.length) {
  console.log("self-check FAILED (" + passed + "/" + checks.length + ")");
  process.exit(1);
}
console.log("self-check ok (" + passed + "/" + checks.length + ")");
