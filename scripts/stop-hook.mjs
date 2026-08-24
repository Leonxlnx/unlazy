#!/usr/bin/env node
// Claude Code Stop hook for one unlazy pipeline. Zero dependencies. Node 16+.

import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import {
  UNLAZY_DIR, gateState, hookStatePath, parseGates, qualify, resolveTarget,
  sha256, validateScopeId, withFileLock, writeAtomic,
} from "./lib/gates.mjs";
import { dispatchStatus } from "./lib/dispatch.mjs";

const MAX_BLOCKS = 6;
const safeHostText = (value, max = 500) => String(value)
  .replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, " ")
  .replace(/\s+/g, " ")
  .trim()
  .slice(0, max);

function normalizeHookState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schema !== 1 ||
      !value.sessions || typeof value.sessions !== "object" || Array.isArray(value.sessions)) {
    return { schema: 1, sessions: {} };
  }
  const sessions = {};
  for (const [key, current] of Object.entries(value.sessions)) {
    if (!/^[a-f0-9]{24}$/.test(key) || !current || typeof current !== "object" || Array.isArray(current) ||
        !/^[a-f0-9]{24}$/.test(String(current.hash || "")) ||
        !Number.isInteger(current.blocks) || current.blocks < 0 ||
        typeof current.updatedAt !== "string" || Number.isNaN(Date.parse(current.updatedAt))) continue;
    sessions[key] = current;
  }
  return { schema: 1, sessions };
}

const args = process.argv.slice(2);
const scopeIndex = args.indexOf("--scope");
const scopeArg = scopeIndex === -1 ? null : args[scopeIndex + 1];

const allow = (message) => {
  if (message) console.log(JSON.stringify({ systemMessage: message }));
  process.exit(0);
};

if (scopeIndex !== -1 && (!scopeArg || validateScopeId(scopeArg))) {
  allow("unlazy: installed hook has an invalid --scope value; not blocking.");
}

let payload = {};
try { payload = JSON.parse(readFileSync(0, "utf8") || "{}"); }
catch { allow(null); }

const root = resolve(typeof payload.cwd === "string" && payload.cwd ? payload.cwd : process.cwd());
const sessionId = payload.session_id || payload.sessionId || "anonymous";
const sessionKey = sha256(String(sessionId)).slice(0, 24);
const target = resolveTarget({ root, scope: scopeArg, sessionId });

if (target.ambiguous) {
  allow("unlazy: " + target.ambiguous.length + " pipelines under " + UNLAZY_DIR +
    "/ (" + target.ambiguous.join(", ") + ") and none bound to this session; not blocking.");
}
if (target.error && !target.ambiguous) allow("unlazy: " + safeHostText(target.error) + "; not blocking.");

const statePath = hookStatePath(root, target.scope);

async function clearSessionState() {
  if (!existsSync(statePath)) return;
  try {
    await withFileLock(root, statePath, () => {
      let state = { schema: 1, sessions: {} };
      try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch { /* replace invalid local state */ }
      state = normalizeHookState(state);
      delete state.sessions[sessionKey];
      if (!Object.keys(state.sessions).length) {
        try { unlinkSync(statePath); } catch { /* already absent */ }
      } else writeAtomic(statePath, JSON.stringify(state, null, 2) + "\n", { root });
    }, { timeoutMs: 10000 });
  } catch {
    // State cleanup must never trap a session after the gates are complete.
  }
}

const dispatch = dispatchStatus(root, target.scope);

if (!target.files.length && !dispatch.blocking.length && !dispatch.abandoned.length) {
  await clearSessionState();
  allow(null);
}

const unmet = [...dispatch.blocking];
const invalid = [];
const handoffs = [...dispatch.abandoned];
const handoffMessage = () => {
  if (!handoffs.length) return "";
  const shown = handoffs.slice(0, 5).join(", ") +
    (handoffs.length > 5 ? ", +" + (handoffs.length - 5) + " more" : "");
  return " HANDOFF REQUIRED: " + handoffs.length + " abandoned item(s): " + safeHostText(shown) + ".";
};
// The loop guard compares resolved gate state between stops, not raw bytes.
// Byte comparison counted any edit as progress: a comment, a reflowed line, or
// the checker rewriting an evidence line with a fresh PATH hash. That rearmed
// the guard indefinitely, so the six-block release could only ever fire for an
// agent doing literally nothing, which is the one case least in need of it.
// Dispatch issue strings encode only canonical state and counts, not raw JSON
// bytes or timestamps, so metadata-only edits do not reset the same guard.
const resolved = [...dispatch.resolved];
for (const file of [...target.files].sort()) {
  let text;
  try { text = readFileSync(file, "utf8"); }
  catch (error) {
    invalid.push(qualify(file, "PARSE") + " unreadable: " + safeHostText(error.message));
    resolved.push(qualify(file, "PARSE") + "=unreadable");
    continue;
  }
  const doc = parseGates(text);
  if (doc.errors.length) {
    invalid.push(qualify(file, "PARSE") + " " + doc.errors.slice(0, 2).map((error) => safeHostText(error)).join("; "));
    // Record only that the ledger is invalid. Diagnostic text carries line
    // numbers, which shift on an unrelated edit and would restore byte coupling.
    resolved.push(qualify(file, "PARSE") + "=invalid");
    continue;
  }
  for (const gate of doc.gates) {
    const state = gateState(gate, doc.abandoned);
    resolved.push(qualify(file, gate.id) + "=" + state);
    if (state === "unmet" || state === "unmet-no-evidence") unmet.push(qualify(file, gate.id));
    else if (state === "abandoned") handoffs.push(qualify(file, gate.id));
  }
}

if (!unmet.length && !invalid.length) {
  await clearSessionState();
  if (!handoffs.length) allow(null);
  const where = target.scope ? " [scope " + target.scope + "]" : "";
  allow("unlazy" + where + ":" + handoffMessage());
}

const progressHash = sha256(resolved.sort().join("\0")).slice(0, 24);
let sessionState;
try {
  sessionState = await withFileLock(root, statePath, () => {
    let state = { schema: 1, sessions: {} };
    try { state = JSON.parse(readFileSync(statePath, "utf8")); } catch { /* new or corrupt local state */ }
    state = normalizeHookState(state);
    let current = state.sessions[sessionKey];
    if (!current || current.hash !== progressHash) current = { hash: progressHash, blocks: 0 };
    current.blocks += 1;
    current.updatedAt = new Date().toISOString();
    state.sessions[sessionKey] = current;
    // Bound abandoned session debris without mixing counters between sessions.
    const entries = Object.entries(state.sessions).sort((a, b) => String(b[1].updatedAt).localeCompare(String(a[1].updatedAt)));
    state.sessions = Object.fromEntries(entries.slice(0, 64));
    writeAtomic(statePath, JSON.stringify(state, null, 2) + "\n", { root });
    return current;
  }, { timeoutMs: 10000 });
} catch (error) {
  allow("unlazy: could not update the serialized hook state (" + safeHostText(error.message) + "); not blocking to avoid a trap.");
}

const where = target.scope ? " [scope " + target.scope + "]" : "";
const outstanding = [...invalid, ...unmet].map((item) => safeHostText(item));
if (sessionState.blocks > MAX_BLOCKS) {
  allow("unlazy: releasing after " + MAX_BLOCKS + " blocks without gate progress" + where +
    "; " + outstanding.length + " item(s) remain (" + outstanding.slice(0, 4).join(", ") + ")." +
    handoffMessage());
}

const list = outstanding.slice(0, 5).join(", ") + (outstanding.length > 5 ? ", +" + (outstanding.length - 5) + " more" : "");
console.log(JSON.stringify({
  decision: "block",
  reason: "unlazy" + where + ": " + outstanding.length + " gate/ledger/dispatch item(s) need work: " + list +
    ". Run gate-check.mjs --status to inspect without execution. To run inherited CHECK lines, inspect them and use --approve. " +
    "Use ABANDON: <id> <non-blank reason> only when a gate is genuinely impossible." + handoffMessage(),
}));
process.exit(0);
