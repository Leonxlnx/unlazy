#!/usr/bin/env node
// Install or remove unlazy's Claude Code Stop hook. Zero dependencies. Node 16+.

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { validateScopeId, writeAtomic } from "./lib/gates.mjs";

const HELP = `usage: install-hooks.mjs [--scope ID] [--shared | --global] [--uninstall]

  default       .claude/settings.local.json in the current project
  --shared      .claude/settings.json in the current project
  --global      ~/.claude/settings.json
  --scope ID    pin the hook to one validated .unlazy/ID pipeline
  --uninstall   remove only unlazy handlers, preserving sibling handlers`;

function usage(message) {
  console.error("install-hooks: " + message);
  console.error("run install-hooks.mjs --help for usage");
  process.exit(2);
}

const args = process.argv.slice(2);
const known = new Set(["--scope", "--shared", "--global", "--uninstall", "--help", "-h"]);
let scope = null;
let shared = false;
let global = false;
let uninstall = false;
for (let index = 0; index < args.length; index++) {
  const arg = args[index];
  if (!known.has(arg)) usage("unknown option " + arg);
  if (arg === "--help" || arg === "-h") { console.log(HELP); process.exit(0); }
  if (arg === "--scope") {
    if (scope !== null) usage("duplicate --scope");
    scope = args[++index];
    if (!scope) usage("--scope needs a pipeline id");
    continue;
  }
  if (arg === "--shared") shared = true;
  if (arg === "--global") global = true;
  if (arg === "--uninstall") uninstall = true;
}
if (shared && global) usage("--shared and --global are mutually exclusive");
if (scope) {
  const error = validateScopeId(scope);
  if (error) usage(error);
}

const script = fileURLToPath(new URL("./stop-hook.mjs", import.meta.url));
const target = global
  ? join(homedir(), ".claude", "settings.json")
  : join(process.cwd(), ".claude", shared ? "settings.json" : "settings.local.json");
const backup = target + ".unlazy.bak";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
let raw = "";
let settings = {};
if (existsSync(target)) {
  try {
    const info = lstatSync(target);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error("target must be a regular file, not a link or directory");
    raw = readFileSync(target, "utf8");
    settings = JSON.parse(raw);
  } catch (error) {
    console.error("Refusing to touch " + target + ": " + error.message);
    process.exit(1);
  }
}

function validateSettings(value) {
  if (!isObject(value)) return "settings root must be a JSON object";
  if (value.hooks !== undefined && !isObject(value.hooks)) return "hooks must be a JSON object";
  if (value.hooks && value.hooks.Stop !== undefined && !Array.isArray(value.hooks.Stop)) return "hooks.Stop must be an array";
  const groups = (value.hooks && value.hooks.Stop) || [];
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex];
    if (!isObject(group)) return "hooks.Stop[" + groupIndex + "] must be an object";
    if (!Array.isArray(group.hooks)) return "hooks.Stop[" + groupIndex + "].hooks must be an array";
    for (let hookIndex = 0; hookIndex < group.hooks.length; hookIndex++) {
      if (!isObject(group.hooks[hookIndex])) {
        return "hooks.Stop[" + groupIndex + "].hooks[" + hookIndex + "] must be an object";
      }
    }
  }
  return null;
}

const shapeError = validateSettings(settings);
if (shapeError) {
  console.error("Refusing to touch " + target + ": " + shapeError + ".");
  process.exit(1);
}

const quote = (value) => {
  if (process.platform === "win32") return '"' + String(value).replace(/"/g, '""') + '"';
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
};
const command = quote(process.execPath) + " " + quote(script) + " --unlazy" + (scope ? " --scope " + scope : "");

const isOurHandler = (handler) => {
  if (!isObject(handler) || typeof handler.command !== "string") return false;
  const value = handler.command;
  return value.includes("stop-hook.mjs") && (value.includes("--unlazy") || value.includes(script) || /[\\/]unlazy[\\/]/i.test(value));
};

const originalGroups = (settings.hooks && settings.hooks.Stop) || [];
let removed = 0;
const keptGroups = [];
for (const group of originalGroups) {
  const hooks = group.hooks.filter((handler) => {
    if (!isOurHandler(handler)) return true;
    removed++;
    return false;
  });
  if (hooks.length) keptGroups.push({ ...group, hooks });
}

function nextSettings(groups) {
  const result = { ...settings };
  const hooks = { ...(settings.hooks || {}) };
  if (groups.length) hooks.Stop = groups;
  else delete hooks.Stop;
  if (Object.keys(hooks).length) result.hooks = hooks;
  else delete result.hooks;
  return result;
}

function persist(value) {
  try {
    if (raw) writeAtomic(backup, raw);
    writeAtomic(target, JSON.stringify(value, null, 2) + "\n");
  } catch (error) {
    console.error("Could not update " + target + ": " + error.message);
    process.exit(1);
  }
}

if (uninstall) {
  if (!removed) {
    console.log("Nothing to remove: no unlazy Stop hook found in " + target);
    process.exit(0);
  }
  persist(nextSettings(keptGroups));
  console.log("Removed unlazy Stop hook (" + removed + " handler(s)) from " + target + ". Sibling handlers were preserved.");
  process.exit(0);
}

const alreadyCurrent = removed === 1 && originalGroups.some((group) =>
  group.hooks.some((handler) => isOurHandler(handler) && handler.command === command &&
    handler.type === "command" && handler.timeout === 20));
if (alreadyCurrent) {
  console.log("Already installed in " + target + " (idempotent, nothing changed).");
  process.exit(0);
}

const entry = { hooks: [{ type: "command", command, timeout: 20 }] };
persist(nextSettings([...keptGroups, entry]));
console.log("Installed unlazy Stop hook into " + target + "\n" +
  "  command: " + command + "\n" +
  "  scope:   " + (scope ? scope : "resolved per session/pipeline") + "\n" +
  "  backup:  " + (raw ? backup : "not needed for a new file") + "\n" +
  "  note:    keep .unlazy/ and .unlazy-hook-state.json ignored; they are local coordination state." +
  (shared ? "\n  warning: shared settings contain this machine's absolute Node and skill paths." : ""));
