#!/usr/bin/env node
// install-hooks.mjs : register (or remove) the unlazy Stop hook in Claude Code settings.
//
// Default target: <cwd>/.claude/settings.local.json  (personal, per-project,
// conventionally untracked, so the machine-specific absolute path never lands in git).
//
//   node install-hooks.mjs               install into project settings.local.json
//   node install-hooks.mjs --shared      install into project settings.json (tracked)
//   node install-hooks.mjs --global      install into ~/.claude/settings.json
//   node install-hooks.mjs --scope api   guard only the .unlazy/api/ pipeline
//   node install-hooks.mjs --uninstall   remove from the chosen target (same flags)
//
// Idempotent: running install twice changes nothing. Re-running with a
// different --scope replaces the existing entry rather than stacking a second.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const args = process.argv.slice(2);
const uninstall = args.includes("--uninstall");
const global_ = args.includes("--global");
const shared = args.includes("--shared");
const scopeIdx = args.indexOf("--scope");
const scope = scopeIdx !== -1 ? args[scopeIdx + 1] : null;
if (scopeIdx !== -1 && !scope) {
  console.error("--scope needs a pipeline id");
  process.exit(1);
}

const hookScript = join(dirname(fileURLToPath(import.meta.url)), "stop-hook.mjs");
const MARKER = "unlazy"; // passed to the hook as an ignored argv tag, so identification
                         // never depends on the skill living in a path named "unlazy"
                         // (an argument, not a shell comment: cmd.exe has no "#")

const target = global_
  ? join(homedir(), ".claude", "settings.json")
  : join(process.cwd(), ".claude", shared ? "settings.json" : "settings.local.json");

let settings = {};
if (existsSync(target)) {
  try { settings = JSON.parse(readFileSync(target, "utf8")); }
  catch (e) {
    console.error(`Refusing to touch ${target}: it exists but is not valid JSON (${e.message}).`);
    process.exit(1);
  }
}

settings.hooks = settings.hooks || {};
const stopHooks = Array.isArray(settings.hooks.Stop) ? settings.hooks.Stop : [];

const isOurs = (entry) =>
  Array.isArray(entry?.hooks) &&
  entry.hooks.some(h => typeof h?.command === "string" &&
    h.command.includes("stop-hook.mjs") &&
    // marker in the command, or, for entries written before it existed, our own path
    (h.command.toLowerCase().includes(MARKER) || h.command.includes(hookScript)));

// Ours AND still pointing at this copy of the script. An entry left behind by
// an install that has since moved is ours, but stale: it must be replaced, not
// reported as already installed, or enforcement is silently off.
const isCurrent = (entry) =>
  Array.isArray(entry?.hooks) &&
  entry.hooks.some(h => typeof h?.command === "string" && h.command.includes(hookScript));

const kept = stopHooks.filter(e => !isOurs(e));

if (uninstall) {
  if (kept.length === stopHooks.length) {
    console.log(`Nothing to remove: no unlazy Stop hook found in ${target}`);
    process.exit(0);
  }
  settings.hooks.Stop = kept;
  if (!settings.hooks.Stop.length) delete settings.hooks.Stop;
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  writeFileSync(target, JSON.stringify(settings, null, 2) + "\n");
  console.log(`Removed unlazy Stop hook from ${target}`);
  process.exit(0);
}

const command = `node "${hookScript}" --${MARKER}` + (scope ? ` --scope ${scope}` : "");
const entry = { hooks: [{ type: "command", command, timeout: 20 }] };

// isCurrent already rejects an entry left by a moved install. Comparing the
// whole command additionally requires the same --scope, so re-pinning the hook
// to a different pipeline replaces the entry instead of being reported as
// already installed and silently guarding the wrong one.
if (stopHooks.some(e => isCurrent(e) && e.hooks.some(h => h.command === command))) {
  console.log(`Already installed in ${target} (idempotent, nothing changed).`);
  process.exit(0);
}

settings.hooks.Stop = [...kept, entry];
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, JSON.stringify(settings, null, 2) + "\n");

console.log(`Installed unlazy Stop hook into ${target}
  command: ${command}
  effect:  while ${scope ? `the .unlazy/${scope}/ pipeline has` : "this session's pipeline has"} unmet gates, ending the turn is
           blocked (max 6 blocks without progress, ABANDON lines are honored
           as an honest exit). A pipeline this session does not own never
           blocks it.
  scope:   ${scope ? `pinned to ${scope}` : "resolved per run: UNLAZY_SCOPE, then the session binding in .unlazy/<id>/session, then the only pipeline present, then legacy GATES.md"}
  remove:  node "${fileURLToPath(import.meta.url)}"${global_ ? " --global" : shared ? " --shared" : ""} --uninstall
  note:    add .unlazy/ (or .unlazy-hook-state.json in legacy layout) to .gitignore`);
