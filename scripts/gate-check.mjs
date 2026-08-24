#!/usr/bin/env node
// Execute gate oracles, update evidence, coordinate scopes, and manage leases.
// Zero dependencies. Node 16+.

import {
  closeSync, constants as fsConstants, existsSync, fstatSync, lstatSync,
  mkdirSync, openSync, readFileSync, realpathSync, statSync, unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import { Worker } from "node:worker_threads";
import { randomBytes } from "node:crypto";
import { delimiter, dirname, basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  UNLAZY_DIR, appendStatus, claimLeases, formatDocument, gateState,
  hookStatePath, listScopes, parseGates, qualify, releaseLeases, resolveTarget,
  scopeRoot, sha256, sleep, validateScopeId, withFileLock, writeAtomic,
} from "./lib/gates.mjs";
import { terminateProcessTree } from "./lib/process-tree.mjs";
import { dispatchStatus } from "./lib/dispatch.mjs";

const HELP = `usage: gate-check.mjs [options] [file ...]

run modes:
  (default)             run unmet runnable gates and update their ledgers
  --status              report only; never execute, approve, or write
  --reverify            re-run every runnable gate and demote stale failures
  --approve             approve each exact pending oracle, then run it
  --jobs N              rolling concurrency, integer 1..64 (default 1)
  --timeout S           per-check timeout, integer seconds 1..86400 (default 120)
  --shell PATH          command shell (UNLAZY_SHELL, then platform default)
  --cwd DIR             default CHECK directory (explicit: file dir; discovered: --root)

pipeline actions:
  --claim --scope ID [--leaf NAME]   atomically claim the leaf's OWNS paths
  --release --scope ID [--leaf NAME] release serialized ownership leases
  --log TEXT --scope ID              append one status line
  --bind SESSION --scope ID          bind a session to one pipeline
  --list-scopes                      list .unlazy pipelines

targeting:
  --scope ID             use .unlazy/ID (or UNLAZY_SCOPE)
  --root DIR             repository/pipeline root (default current directory)
  file ...               explicit regular ledger files; all are honored

CHECK execution requires prior approval keyed to the exact CHECK, EXPECT,
resolved CWD, resolved shell, timeout, output/regex limits, platform, and PATH.
Approvals live outside the repository under ~/.unlazy/approved by default.

exit codes: 0 all met/action succeeded; 1 unmet; 2 usage/parse/infrastructure;
            3 lease conflict.`;

const FLAG_OPTIONS = new Set([
  "--status", "--reverify", "--approve", "--claim", "--release",
  "--list-scopes", "--help", "-h",
]);
const VALUE_OPTIONS = new Set([
  "--scope", "--leaf", "--timeout", "--jobs", "--cwd", "--root",
  "--log", "--bind", "--shell",
]);
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_APPROVAL_BYTES = 256 * 1024;
const REGEX_TIMEOUT_MS = 250;
const REGEX_STARTUP_TIMEOUT_MS = 5000;
const MAX_REGEX_WORKERS = 4;
const DEFAULT_TIMEOUT_SECONDS = 120;
const CHECK_SUPERVISOR = fileURLToPath(new URL("./lib/check-supervisor.mjs", import.meta.url));

// Repository-controlled titles, paths, commands, and output must not be able
// to rewrite terminal history, set a window title, or visually reorder text.
// Strip every C0/C1 control plus Unicode bidi formatting markers at the final
// sink. Each console call still receives its own trailing newline.
const UNSAFE_TERMINAL_RE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
const terminalSafe = (value) => String(value).replace(UNSAFE_TERMINAL_RE, " ");
for (const method of ["log", "error"]) {
  const write = console[method].bind(console);
  console[method] = (...values) => write(...values.map(terminalSafe));
}

function parseArgs(argv) {
  const options = {};
  const files = [];
  let positional = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--") { positional = true; continue; }
    if (!positional && FLAG_OPTIONS.has(arg)) {
      const key = arg.replace(/^-+/, "");
      if (options[key] !== undefined) return { error: "duplicate option " + arg };
      options[key] = true;
      continue;
    }
    if (!positional && arg.startsWith("--")) {
      const equals = arg.indexOf("=");
      const name = equals === -1 ? arg : arg.slice(0, equals);
      if (!VALUE_OPTIONS.has(name)) return { error: "unknown option " + name };
      const key = name.slice(2);
      if (options[key] !== undefined) return { error: "duplicate option " + name };
      const value = equals === -1 ? argv[++index] : arg.slice(equals + 1);
      if (value === undefined || value === "") return { error: name + " needs a value" };
      options[key] = value;
      continue;
    }
    if (!positional && arg.startsWith("-")) return { error: "unknown option " + arg };
    files.push(arg);
  }
  return { options, files };
}

function failUsage(message) {
  console.error("gate-check: " + message);
  console.error("run gate-check.mjs --help for usage");
  process.exit(2);
}

function asDirectory(path, label) {
  try {
    if (!statSync(path).isDirectory()) failUsage(label + " is not a directory: " + path);
  } catch (error) {
    if (error.code === "ENOENT") failUsage(label + " does not exist: " + path);
    failUsage("cannot inspect " + label + " " + path + ": " + error.message);
  }
}

function timeoutValue(value) {
  if (value === undefined) return DEFAULT_TIMEOUT_SECONDS;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 1 || number > 86400) {
    failUsage("--timeout needs an integer from 1 through 86400, got " + JSON.stringify(value));
  }
  return number;
}

function jobCount(value) {
  if (value === undefined) return 1;
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number) || number < 1 || number > 64) {
    failUsage("--jobs needs an integer from 1 through 64, got " + JSON.stringify(value));
  }
  return number;
}

const parsedArgs = parseArgs(process.argv.slice(2));
if (parsedArgs.error) failUsage(parsedArgs.error);
const { options: opt, files: fileArgs } = parsedArgs;
if (opt.help || opt.h) {
  // HELP is a fixed local constant, so preserve its intentional layout instead
  // of routing it through the untrusted-value terminal sanitizer.
  process.stdout.write(HELP + "\n");
  process.exit(0);
}

const actionNames = [];
for (const key of ["claim", "release", "list-scopes"]) if (opt[key]) actionNames.push("--" + key);
for (const key of ["log", "bind"]) if (opt[key] !== undefined) actionNames.push("--" + key);
if (actionNames.length > 1) failUsage("pipeline actions are mutually exclusive: " + actionNames.join(", "));
const action = actionNames[0] || null;

if (opt.status && opt.reverify) failUsage("--status and --reverify are mutually exclusive");
if (opt.status && opt.approve) failUsage("--status never approves commands; remove --approve");
if (action && (opt.status || opt.reverify || opt.approve)) failUsage(action + " cannot be combined with a run mode");
if (action && fileArgs.length) failUsage(action + " cannot be combined with explicit files");
if (fileArgs.length && opt.scope) failUsage("explicit files and --scope are mutually exclusive");
if (opt.leaf && !opt.claim && !opt.release) failUsage("--leaf is only valid with --claim or --release");
if ((opt.timeout || opt.jobs || opt.shell || opt.cwd) && (action || opt.status)) {
  failUsage("--timeout, --jobs, --shell, and --cwd are execution options only");
}

const root = resolve(opt.root || process.cwd());
asDirectory(root, "--root");
const timeoutSeconds = timeoutValue(opt.timeout);
const jobs = jobCount(opt.jobs);
const defaultCwd = resolve(root, opt.cwd || ".");
if (!action && !opt.status) asDirectory(defaultCwd, "--cwd");

if (action === "--list-scopes") {
  const scopes = listScopes(root);
  if (scopes.length) {
    for (const scope of scopes) console.log(scope);
  } else console.log("(no pipelines under " + UNLAZY_DIR + "/)");
  process.exit(0);
}

if (opt.scope) {
  const error = validateScopeId(opt.scope);
  if (error) failUsage(error);
}

let target = resolveTarget({ root, scope: opt.scope, files: fileArgs });
// A deleted/crashed pipeline can leave coordination leases behind after its
// ledger directory is gone. An explicit, validated release target must remain
// usable for that recovery path; claims still require a live exact ledger.
if (target.error && action === "--release" && opt.scope) {
  target = { mode: "scope", scope: opt.scope, files: [] };
} else if (target.error) failUsage(target.error);
const scope = target.scope;

if (action === "--log") {
  if (!scope) failUsage("--log needs --scope ID or exactly one discoverable pipeline");
  if (!String(opt.log).trim()) failUsage("--log needs non-blank text");
  try {
    const path = await appendStatus(root, scope, opt.log);
    console.log("appended to " + path);
    process.exit(0);
  } catch (error) {
    console.error("gate-check: cannot append status: " + error.message);
    process.exit(2);
  }
}

if (action === "--bind") {
  if (!scope) failUsage("--bind needs --scope ID or exactly one discoverable pipeline");
  if (!String(opt.bind).trim()) failUsage("--bind needs a non-blank session id");
  const path = join(scopeRoot(root, scope), "session");
  try {
    writeAtomic(path, String(opt.bind).trim() + "\n", { root });
    console.log("bound session " + opt.bind + " to scope " + scope);
    process.exit(0);
  } catch (error) {
    console.error("gate-check: cannot bind session: " + error.message);
    process.exit(2);
  }
}

if (!target.files.length && action !== "--release") {
  failUsage("no gate files found (looked for " + UNLAZY_DIR + "/<scope>/, then GATES.md and gates/*.md under " + root + ")");
}

for (const file of target.files) {
  try {
    if (!statSync(file).isFile()) failUsage("gate target is not a regular file: " + file);
  } catch (error) {
    if (error.code === "ENOENT") failUsage("no such gate file: " + file);
    failUsage("cannot inspect gate file " + file + ": " + error.message);
  }
}

function loadLedger(file) {
  let text;
  try { text = readFileSync(file, "utf8"); }
  catch (error) { failUsage("cannot read " + file + ": " + error.message); }
  const doc = parseGates(text);
  for (const warning of doc.warnings) console.error("gate-check: " + file + ": warning: " + warning);
  if (doc.errors.length) {
    for (const error of doc.errors) console.error("gate-check: " + file + ": " + error);
    process.exit(2);
  }
  return { file, doc };
}

if (action === "--claim" || action === "--release") {
  if (!scope) failUsage(action + " needs --scope ID or exactly one discoverable pipeline");
  const stems = target.files.map((file) => basename(file).replace(/\.md$/i, ""));
  if (opt.leaf) {
    const error = validateScopeId(opt.leaf, "leaf");
    if (error) failUsage(error);
    if (stems.length && !stems.includes(opt.leaf)) failUsage("unknown --leaf " + opt.leaf + " (have: " + stems.join(", ") + ")");
  }
  if (action === "--release") {
    try {
      const count = await releaseLeases(root, { scope, leaf: opt.leaf || null });
      console.log("released " + count + " lease(s) for " + scope + (opt.leaf ? "/" + opt.leaf : ""));
      process.exit(0);
    } catch (error) {
      console.error("gate-check: cannot release leases: " + error.message);
      process.exit(2);
    }
  }

  const leaf = opt.leaf || (stems.length === 1 ? stems[0] : null);
  if (!leaf) failUsage("--claim needs --leaf NAME when a scope has several gate files");
  const selectedFile = target.files.find((file) => basename(file).replace(/\.md$/i, "") === leaf);
  const selected = loadLedger(selectedFile);
  if (!selected.doc.owns.length) failUsage(basename(selected.file) + " declares no OWNS paths");
  let result;
  try { result = await claimLeases(root, { scope, leaf, globs: selected.doc.owns }); }
  catch (error) {
    console.error("gate-check: cannot claim leases: " + error.message);
    process.exit(2);
  }
  if (!result.ok) {
    if (result.error) failUsage(result.error);
    for (const conflict of result.conflicts) {
      console.log("CONFLICT " + conflict.glob + " overlaps " + conflict.theirGlob + " held by " + conflict.with);
    }
    console.log("CLAIM REFUSED (" + result.conflicts.length + " conflict(s))");
    process.exit(3);
  }
  console.log("CLAIMED " + result.globs.length + " path(s) for " + scope + "/" + leaf + ": " + result.globs.join(", "));
  process.exit(0);
}

let ledgers = target.files.map(loadLedger);

function executableCandidates(name) {
  if (process.platform !== "win32") return [name];
  if (/\.[A-Za-z0-9]+$/.test(name)) return [name];
  const extensions = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  return [name, ...extensions.map((extension) => name + extension.toLowerCase()), ...extensions.map((extension) => name + extension.toUpperCase())];
}

function resolveShell(raw) {
  const requested = raw || process.env.UNLAZY_SHELL || (process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "/bin/sh");
  const containsSeparator = requested.includes("/") || requested.includes("\\") || isAbsolute(requested);
  const candidates = [];
  if (containsSeparator) candidates.push(resolve(process.cwd(), requested));
  else {
    for (const directory of String(process.env.PATH || "").split(delimiter).filter(Boolean)) {
      for (const name of executableCandidates(requested)) candidates.push(join(directory, name));
    }
  }
  for (const candidate of candidates) {
    try { if (statSync(candidate).isFile()) return candidate; } catch { /* keep looking */ }
  }
  failUsage("cannot resolve command shell " + JSON.stringify(requested) + " from PATH");
}

const shell = opt.status ? "(not used: status mode)" : resolveShell(opt.shell);
const pathValue = String(process.env.PATH || "");
const pathHash = sha256(pathValue).slice(0, 12);
const pathCount = pathValue ? pathValue.split(delimiter).length : 0;
const pathEvidence = pathHash + "/" + pathCount + " entries";
const pathTranscript = pathValue.replace(/[\r\n]/g, " ").slice(0, 800) + (pathValue.length > 800 ? "..." : "");

function resolvedGateCwd(gate, file) {
  // Explicit ledgers are self-contained: absent --cwd, relative commands and
  // CWD attributes anchor beside that ledger instead of wherever the caller
  // happened to launch the checker. Scoped and legacy discovery anchor at root.
  const base = opt.cwd ? defaultCwd : (target.mode === "explicit" ? dirname(resolve(file)) : root);
  return gate.cwd ? resolve(base, gate.cwd) : base;
}

function oracle(file, gate) {
  const cwd = resolvedGateCwd(gate, file);
  return {
    schema: 1,
    check: gate.check,
    expect: gate.expect,
    cwd,
    shell,
    timeoutMs: timeoutSeconds * 1000,
    maxOutputBytes: MAX_OUTPUT_BYTES,
    regexTimeoutMs: REGEX_TIMEOUT_MS,
    regexStartupTimeoutMs: REGEX_STARTUP_TIMEOUT_MS,
    maxRegexWorkers: MAX_REGEX_WORKERS,
    platform: process.platform,
    path: pathValue,
  };
}

function signature(file, gate) {
  return sha256(JSON.stringify(oracle(file, gate)));
}

function pathIsInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith(".." + sep) && rel !== ".." && !isAbsolute(rel));
}

const approvalDir = resolve(process.env.UNLAZY_APPROVAL_DIR || join(homedir(), ".unlazy", "approved"));
const canonicalRoot = realpathSync(root);
if (!opt.status && pathIsInside(root, approvalDir)) failUsage("UNLAZY_APPROVAL_DIR must be outside the repository root");

function approvalPath(file, gate, directory = approvalDir) {
  const identity = resolve(file) + "\0" + gate.id + "\0" + signature(file, gate);
  return join(directory, sha256(identity) + ".json");
}

function assertPrivateApprovalEntry(path, info, kind) {
  if (info.isSymbolicLink() || (kind === "directory" ? !info.isDirectory() : !info.isFile())) {
    throw new Error(path + " must be a real " + kind);
  }
  const uid = typeof process.geteuid === "function" ? process.geteuid()
    : typeof process.getuid === "function" ? process.getuid() : null;
  if (uid !== null && info.uid !== uid) {
    throw new Error(path + " must be owned by the current user");
  }
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0) {
    throw new Error(path + " must not grant group or other permissions");
  }
}

function validatedApprovalDir({ create = false } = {}) {
  if (create) mkdirSync(approvalDir, { recursive: true, mode: 0o700 });
  else if (!existsSync(approvalDir)) return null;
  const info = lstatSync(approvalDir);
  assertPrivateApprovalEntry(approvalDir, info, "directory");
  const canonical = realpathSync(approvalDir);
  if (pathIsInside(canonicalRoot, canonical)) {
    throw new Error("approval directory resolves inside the repository root: " + canonical);
  }
  const canonicalInfo = lstatSync(canonical);
  assertPrivateApprovalEntry(canonical, canonicalInfo, "directory");
  return { path: canonical, dev: canonicalInfo.dev, ino: canonicalInfo.ino };
}

function assertApprovalDirUnchanged(store) {
  const current = lstatSync(store.path);
  assertPrivateApprovalEntry(store.path, current, "directory");
  if (current.dev !== store.dev || current.ino !== store.ino) {
    throw new Error("approval directory changed during use: " + store.path);
  }
}

function readApprovalFile(path) {
  let fd = null;
  try {
    const noFollow = process.platform === "win32" ? 0 : (fsConstants.O_NOFOLLOW || 0);
    fd = openSync(path, fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK || 0) | noFollow);
    const opened = fstatSync(fd);
    const named = lstatSync(path);
    assertPrivateApprovalEntry(path, opened, "file");
    if (opened.size > MAX_APPROVAL_BYTES) {
      throw new Error("approval record exceeds " + MAX_APPROVAL_BYTES + " bytes: " + path);
    }
    if (named.isSymbolicLink() || !named.isFile() || named.nlink !== 1 || opened.nlink !== 1 ||
        named.dev !== opened.dev || named.ino !== opened.ino) {
      throw new Error("refusing linked or replaced approval record " + path);
    }
    const text = readFileSync(fd, "utf8");
    const after = lstatSync(path);
    if (after.isSymbolicLink() || !after.isFile() || after.nlink !== 1 ||
        after.dev !== opened.dev || after.ino !== opened.ino) {
      throw new Error("approval record changed while it was read: " + path);
    }
    return text;
  } finally {
    if (fd !== null) try { closeSync(fd); } catch { /* ignore */ }
  }
}

function approvalExists(file, gate) {
  const store = validatedApprovalDir();
  if (!store) return false;
  const path = approvalPath(file, gate, store.path);
  let text;
  try { text = readApprovalFile(path); }
  catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  let value;
  try { value = JSON.parse(text); }
  catch { return false; }
  assertApprovalDirUnchanged(store);
  return value && value.file === resolve(file) && value.gate === gate.id && value.signature === signature(file, gate);
}

async function recordApproval(file, gate) {
  const store = validatedApprovalDir({ create: true });
  const token = approvalPath(file, gate, store.path);
  const lock = token + ".lock";
  const deadline = Date.now() + 10000;
  const owner = randomBytes(16).toString("hex");
  let fd = null;
  for (;;) {
    try { fd = openSync(lock, "wx", 0o600); break; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      // Fail closed instead of trying to steal by path: an owner can release
      // and a successor can acquire between stat and unlink.
      try { statSync(lock); } catch (statError) {
        if (statError.code === "ENOENT") continue;
        throw statError;
      }
      if (Date.now() >= deadline) throw new Error("timed out waiting for approval lock");
      await sleep(20);
    }
  }
  try {
    writeFileSync(fd, JSON.stringify({ owner, pid: process.pid, at: Date.now() }));
    const value = {
      schema: 1, file: resolve(file), gate: gate.id, signature: signature(file, gate),
      oracle: oracle(file, gate), approvedAt: new Date().toISOString(),
    };
    writeAtomic(token, JSON.stringify(value, null, 2) + "\n");
    assertApprovalDirUnchanged(store);
  } finally {
    try { closeSync(fd); } catch { /* ignore */ }
    try {
      const current = JSON.parse(readFileSync(lock, "utf8"));
      if (current.owner === owner) unlinkSync(lock);
    } catch { /* manual cleanup or a successor owns the lock */ }
  }
}

function printOracle(file, gate, prefix) {
  const value = oracle(file, gate);
  console.log(prefix + " " + qualify(file, gate.id));
  console.log("    CHECK: " + value.check);
  console.log("    EXPECT: " + value.expect);
  console.log("    CWD: " + value.cwd);
  console.log("    SHELL: " + value.shell);
  console.log("    PATH: " + pathTranscript);
}

let activeRegexWorkers = 0;
const regexWaiters = [];

function acquireRegexWorker() {
  if (activeRegexWorkers < MAX_REGEX_WORKERS) {
    activeRegexWorkers++;
    return Promise.resolve();
  }
  return new Promise((done) => regexWaiters.push(done));
}

function releaseRegexWorker() {
  const next = regexWaiters.shift();
  if (next) next();
  else activeRegexWorkers--;
}

async function safeRegexMatch(expectation, output) {
  if (expectation.kind === "text") return { matched: output.includes(expectation.value) };
  await acquireRegexWorker();
  try {
    return await new Promise((done) => {
      let worker;
      let settled = false;
      let startupTimer = null;
      let matchTimer = null;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        if (startupTimer) clearTimeout(startupTimer);
        if (matchTimer) clearTimeout(matchTimer);
        if (worker) worker.terminate().catch(() => {});
        done(value);
      };
      try { worker = new Worker(new URL("./lib/regex-worker.mjs", import.meta.url)); }
      catch (error) {
        finish({ matched: false, error: "EXPECT worker could not start: " + error.message });
        return;
      }
      startupTimer = setTimeout(() => finish({
        matched: false,
        error: "EXPECT worker startup exceeded " + REGEX_STARTUP_TIMEOUT_MS + "ms",
      }), REGEX_STARTUP_TIMEOUT_MS);
      worker.once("online", () => {
        if (settled) return;
        clearTimeout(startupTimer);
        startupTimer = null;
        // The catastrophic-backtracking budget starts only after the worker is
        // online; process startup and a busy --jobs queue are not regex time.
        matchTimer = setTimeout(() => finish({
          matched: false,
          error: "EXPECT regex exceeded " + REGEX_TIMEOUT_MS + "ms",
        }), REGEX_TIMEOUT_MS);
        try { worker.postMessage({ source: expectation.source, flags: expectation.flags, output }); }
        catch (error) { finish({ matched: false, error: error.message }); }
      });
      worker.once("message", (message) => finish(message));
      worker.once("error", (error) => finish({ matched: false, error: error.message }));
      worker.once("exit", (code) => {
        finish({ matched: false, error: "EXPECT worker exited " + code + " without a result" });
      });
    });
  } finally {
    releaseRegexWorker();
  }
}

function runCheck(task) {
  return new Promise((done) => {
    const chunks = { stdout: [], stderr: [] };
    let bytes = 0;
    let overflow = false;
    let timedOut = false;
    let spawnError = null;
    let closed = false;
    let closeStreamsTimer = null;
    let forceSettleTimer = null;
    let timeoutTimer = null;
    let cleanupDiagnostic = null;
    let child;

    const settle = async (exitCode, signal) => {
      if (closed) return;
      closed = true;
      if (timeoutTimer) clearTimeout(timeoutTimer);
      if (closeStreamsTimer) clearTimeout(closeStreamsTimer);
      if (forceSettleTimer) clearTimeout(forceSettleTimer);
      const stdout = Buffer.concat(chunks.stdout).toString("utf8");
      const stderr = Buffer.concat(chunks.stderr).toString("utf8");
      const output = stdout + (stdout && stderr ? "\n" : "") + stderr;
      const match = timedOut || overflow || spawnError
        ? { matched: false }
        : await safeRegexMatch(task.gate.expectation, output);
      const cleanupSuffix = cleanupDiagnostic ? "; cleanup: " + cleanupDiagnostic : "";
      const error = timedOut ? "timed out after " + timeoutSeconds + "s" + cleanupSuffix
        : overflow ? "output exceeded " + MAX_OUTPUT_BYTES + " bytes" + cleanupSuffix
          : spawnError ? spawnError.message
            : match.error || null;
      done({
        ...task, output, exitCode, signal, matched: Boolean(match.matched), error,
        ok: !error && exitCode === 0 && Boolean(match.matched),
      });
    };

    const stopChild = () => {
      if (closeStreamsTimer) return;
      const cleanup = terminateProcessTree(child);
      cleanupDiagnostic = cleanup.diagnostic;
      // A descendant that escaped the shell can otherwise keep inherited pipes
      // open forever. We still settle through the child's close event, after
      // giving stdio a short grace period to drain.
      closeStreamsTimer = setTimeout(() => {
        try { child.stdout.destroy(); } catch { /* closed */ }
        try { child.stderr.destroy(); } catch { /* closed */ }
      }, 1000);
      // A successful signal request is not proof that a child closed or that
      // every pipe-holding descendant exited. Settle independently after the
      // bounded helper attempt for every cleanup outcome, while retaining any
      // explicit cleanup failure in the result.
      forceSettleTimer = setTimeout(() => {
        try { child.stdout.destroy(); } catch { /* closed */ }
        try { child.stderr.destroy(); } catch { /* closed */ }
        try { child.unref(); } catch { /* unavailable */ }
        settle(null, null);
      }, 1500);
    };

    const capture = (stream, chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = MAX_OUTPUT_BYTES - bytes;
      if (remaining > 0) chunks[stream].push(buffer.subarray(0, remaining));
      bytes += buffer.length;
      if (bytes > MAX_OUTPUT_BYTES && !overflow) {
        overflow = true;
        stopChild();
      }
    };

    try {
      child = spawn(process.execPath, [CHECK_SUPERVISOR, shell, task.gate.check], {
        cwd: task.cwd,
        shell: false,
        windowsHide: true,
        detached: process.platform !== "win32",
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      done({ ...task, ok: false, output: "", exitCode: null, signal: null, matched: false, error: error.message });
      return;
    }
    child.stdout.on("data", (chunk) => capture("stdout", chunk));
    child.stderr.on("data", (chunk) => capture("stderr", chunk));
    child.once("error", (error) => { spawnError = error; });
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      stopChild();
    }, timeoutSeconds * 1000);
    child.once("close", settle);
  });
}

async function runRolling(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      if (index >= tasks.length) return;
      results[index] = await runCheck(tasks[index]);
    }
  }
  const workers = [];
  for (let index = 0; index < Math.min(limit, tasks.length); index++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

const pending = [];
for (const ledger of ledgers) {
  for (const gate of ledger.doc.gates) {
    if (ledger.doc.abandoned.has(gate.id) || !gate.check) continue;
    const state = gateState(gate, ledger.doc.abandoned);
    if (opt.status || (!opt.reverify && state === "met")) continue;
    const cwd = resolvedGateCwd(gate, ledger.file);
    try {
      if (!statSync(cwd).isDirectory()) failUsage("gate " + qualify(ledger.file, gate.id) + " CWD is not a directory: " + cwd);
    } catch (error) {
      if (error.code === "ENOENT") failUsage("gate " + qualify(ledger.file, gate.id) + " CWD does not exist: " + cwd);
      failUsage("cannot inspect gate CWD " + cwd + ": " + error.message);
    }
    pending.push({ file: ledger.file, gate, cwd, wasMet: state === "met", signature: signature(ledger.file, gate) });
  }
}

const runnable = [];
const notRun = [];
let approvalInfrastructureFailures = 0;
for (const task of pending) {
  let approved = false;
  try { approved = approvalExists(task.file, task.gate); }
  catch (error) {
    console.error("gate-check: could not validate approval for " + qualify(task.file, task.gate.id) + ": " + error.message);
    approvalInfrastructureFailures++;
    notRun.push(task);
    continue;
  }
  if (!approved) {
    printOracle(task.file, task.gate, "APPROVAL REQUIRED");
    if (!opt.approve) {
      console.log("    NOT RUN: inspect this oracle, then re-run with --approve");
      notRun.push(task);
      continue;
    }
    try {
      await recordApproval(task.file, task.gate);
      console.log("    APPROVED: " + approvalPath(task.file, task.gate, validatedApprovalDir().path));
    } catch (error) {
      console.error("gate-check: could not record approval for " + qualify(task.file, task.gate.id) + ": " + error.message);
      approvalInfrastructureFailures++;
      notRun.push(task);
      continue;
    }
  }
  runnable.push(task);
}

for (const task of runnable) {
  console.log("  RUN  " + qualify(task.file, task.gate.id) + " shell=" + shell + " cwd=" + task.cwd + " PATH=" + pathTranscript);
}
const results = opt.status ? [] : await runRolling(runnable, jobs);
const outputFingerprint = (output) => ({
  sha256: sha256(String(output)),
  bytes: Buffer.byteLength(String(output), "utf8"),
});
for (const result of results) {
  const fingerprint = outputFingerprint(result.output);
  const outputSummary = result.ok
    ? "sha256=" + fingerprint.sha256 + "; bytes=" + fingerprint.bytes
    : failureOutput(result.output);
  const outcome = "exit=" + (result.exitCode === null ? "none" : result.exitCode) +
    (result.signal ? " signal=" + result.signal : "") +
    "; EXPECT=" + (result.matched ? "matched" : "not matched") +
    "; output=" + outputSummary;
  if (result.ok) {
    console.log("  PASS " + qualify(result.file, result.gate.id) + ": " + result.gate.title);
    console.log("       " + outcome);
  } else {
    console.log("  FAIL " + qualify(result.file, result.gate.id) + ": " + result.gate.title);
    console.log("       " + (result.error ? result.error + "; " : "") + outcome);
  }
}

function failureOutput(output, max = 480) {
  const lines = String(output).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 8) return (lines.join(" | ") || "(no output)").slice(0, max);
  const summary = [...lines.slice(0, 6), "...", ...lines.slice(-2)].join(" | ");
  return summary.slice(0, max);
}

function evidenceFor(result) {
  const clean = (value) => terminalSafe(value).replace(/[\r\n\t]+/g, " ");
  const fingerprint = outputFingerprint(result.output);
  return ("exit=0; shell=" + clean(shell) + "; cwd=" + clean(result.cwd) +
    "; path=" + pathEvidence + "; EXPECT=matched; output-sha256=" + fingerprint.sha256 +
    "; output-bytes=" + fingerprint.bytes).slice(0, 900);
}

function insertOrUpdateEvidence(doc, gate, value) {
  if (gate.evidenceLine !== -1) {
    const indent = (doc.lines[gate.evidenceLine].match(/^\s*/) || ["  "])[0];
    doc.lines[gate.evidenceLine] = indent + "EVIDENCE: " + value;
    return;
  }
  let line = gate.line + 1;
  while (line < doc.lines.length && /^\s+(CHECK|EXPECT|EVIDENCE|CWD):/.test(doc.lines[line])) line++;
  doc.lines.splice(line, 0, "  EVIDENCE: " + value);
}

const resultKey = (file, id) => resolve(file) + "\0" + id;
const staleResults = new Map();
for (const result of results) {
  if (!result.ok && !(opt.reverify && result.wasMet)) continue;
  try {
    await withFileLock(root, result.file, () => {
      let doc = parseGates(readFileSync(result.file, "utf8"));
      if (doc.errors.length) throw new Error("fresh ledger became invalid: " + doc.errors.join("; "));
      const fresh = doc.gates.find((gate) => gate.id === result.gate.id);
      if (!fresh || signature(result.file, fresh) !== result.signature) {
        staleResults.set(resultKey(result.file, result.gate.id), qualify(result.file, result.gate.id));
        console.log("  STALE " + qualify(result.file, result.gate.id) + ": CHECK/EXPECT/CWD/shell signature changed; result not written");
        return;
      }
      if (result.ok) {
        doc.lines[fresh.line] = doc.lines[fresh.line].replace(/^- \[( |x|X)\]/, "- [x]");
        insertOrUpdateEvidence(doc, fresh, evidenceFor(result));
      } else {
        doc.lines[fresh.line] = doc.lines[fresh.line].replace(/^- \[(x|X)\]/, "- [ ]");
        insertOrUpdateEvidence(doc, fresh, "pending");
      }
      writeAtomic(result.file, formatDocument(doc));
    });
  } catch (error) {
    console.error("gate-check: cannot update " + result.file + ": " + error.message);
    process.exitCode = 2;
  }
}
if (process.exitCode === 2) process.exit(2);

ledgers = target.files.map(loadLedger);
let totalMet = 0;
let totalUnmet = 0;
let totalAbandoned = 0;
let reverified = 0;
const unmetIds = [];
const abandonedIds = [];
const finalStates = new Map();
for (const result of results) {
  if (opt.reverify && result.wasMet && !staleResults.has(resultKey(result.file, result.gate.id))) reverified++;
}

for (const ledger of ledgers) {
  for (const gate of ledger.doc.gates) {
    const state = gateState(gate, ledger.doc.abandoned);
    finalStates.set(resultKey(ledger.file, gate.id), state);
    if (state === "abandoned") {
      totalAbandoned++;
      abandonedIds.push(qualify(ledger.file, gate.id));
    }
    else if (state === "met") totalMet++;
    else {
      totalUnmet++;
      unmetIds.push(qualify(ledger.file, gate.id));
      if (opt.status) {
        console.log("  UNMET " + qualify(ledger.file, gate.id) + " (" +
          (state === "unmet" ? "unchecked" : "checked but EVIDENCE pending") + "): " + gate.title);
      }
    }
  }
  console.log(basename(ledger.file) + ": " + ledger.doc.gates.length + " gates");
}

// A scoped pipeline is complete only when both its ledgers and its native
// dispatch waves are resolved. Per-wave `dispatch-check status` is useful for
// inspection, but completion cannot depend on callers remembering a second
// command (or on the optional Stop hook being installed).
const aggregateDispatch = dispatchStatus(root, scope);
if (aggregateDispatch.errors.length) {
  for (const error of aggregateDispatch.errors) console.error("gate-check: " + error);
  process.exit(2);
}
totalAbandoned += aggregateDispatch.abandoned.length;
abandonedIds.push(...aggregateDispatch.abandoned);
if (opt.status) {
  for (const blocker of aggregateDispatch.blocking) console.log("  UNMET " + blocker);
}

const where = scope ? " [scope " + scope + "]" : "";
const verifyNote = opt.reverify
  ? ", reran: " + results.length + ", previously met reverified: " + reverified
  : "";
const unverifiedMet = opt.reverify ? notRun.filter((task) => task.wasMet) : [];
const extraUnmet = new Map();
for (const task of unverifiedMet) {
  const key = resultKey(task.file, task.gate.id);
  const state = finalStates.get(key);
  if (state === "met" || state === undefined) extraUnmet.set(key, qualify(task.file, task.gate.id) + " (reverify not run)");
}
for (const [key, label] of staleResults) {
  const state = finalStates.get(key);
  if (state === "met" || state === undefined) extraUnmet.set(key, label + " (stale result discarded)");
}
const effectiveUnmet = totalUnmet + extraUnmet.size + aggregateDispatch.blocking.length;
unmetIds.push(...extraUnmet.values());
unmetIds.push(...aggregateDispatch.blocking);
if (approvalInfrastructureFailures) {
  console.error("gate-check: infrastructure failure prevented " + approvalInfrastructureFailures + " approval(s)");
  process.exit(2);
}
if (effectiveUnmet === 0 && totalAbandoned === 0) {
  console.log("ALL MET (" + totalMet + " met" + verifyNote + ")" + where);
  process.exit(0);
}
if (totalAbandoned) {
  console.log("HANDOFF REQUIRED: " + totalAbandoned + " abandoned (met: " +
    Math.max(0, totalMet - extraUnmet.size) + (effectiveUnmet ? ", unmet: " + effectiveUnmet : "") +
    verifyNote + ")" + where);
  console.log("  " + abandonedIds.slice(0, 12).join(", ") +
    (abandonedIds.length > 12 ? ", +" + (abandonedIds.length - 12) + " more" : ""));
}
if (effectiveUnmet) {
  console.log("UNMET: " + effectiveUnmet + " (met: " + Math.max(0, totalMet - extraUnmet.size) +
    (totalAbandoned ? ", abandoned: " + totalAbandoned : "") + verifyNote + ")" + where);
  console.log("  " + unmetIds.slice(0, 12).join(", ") + (unmetIds.length > 12 ? ", +" + (unmetIds.length - 12) + " more" : ""));
}
process.exit(1);
