#!/usr/bin/env node
// run-tests.mjs : behavioural tests for the unlazy enforcement scripts.
// Zero dependencies, cross-platform (every CHECK command is a `node -e`).
//
//   node tests/run-tests.mjs            run all
//   node tests/run-tests.mjs scope      run tests whose name contains "scope"
//
// Prints "N/N passed" on success, which is the string CI and the repo's own
// gates match on.

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE_CHECK = join(HERE, "..", "scripts", "gate-check.mjs");
const STOP_HOOK = join(HERE, "..", "scripts", "stop-hook.mjs");
const INSTALL = join(HERE, "..", "scripts", "install-hooks.mjs");
const filter = process.argv[2] || "";
const APPROVAL_ROOT = mkdtempSync(join(tmpdir(), "unlazy-test-approvals-"));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

// ------------------------------------------------------------- helpers

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "unlazy-test-"));
  return {
    dir,
    write(rel, text) {
      const p = join(dir, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, text);
      return p;
    },
    read(rel) { return readFileSync(join(dir, rel), "utf8"); },
    cleanup() { try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows lag */ } },
  };
}

function run(script, args, opts = {}) {
  return new Promise((res) => {
    const actions = new Set(["--status", "--claim", "--release", "--list-scopes", "--log", "--bind", "--help", "-h"]);
    const needsApproval = script === GATE_CHECK && !opts.noApprove && !args.some((arg) => actions.has(arg));
    const actualArgs = needsApproval && !args.includes("--approve") ? ["--approve", ...args] : args;
    const child = execFile(process.execPath, [script, ...actualArgs], {
      cwd: opts.cwd, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, UNLAZY_APPROVAL_DIR: APPROVAL_ROOT, ...(opts.env || {}) },
    }, (err, stdout, stderr) => {
      res({ code: err ? (err.code ?? 1) : 0, out: (stdout || "") + (stderr || "") });
    });
    if (opts.stdin !== undefined) { child.stdin.end(opts.stdin); }
  });
}

const gate = (id, title, check, expect) =>
  "- [ ] " + id + ": " + title + "\n" +
  (check ? "  CHECK: " + check + "\n" : "") +
  (expect ? "  EXPECT: " + expect + "\n" : "") +
  "  EVIDENCE: pending\n";

const nodeEval = (js) => 'node -e "' + js.replace(/"/g, '\\"') + '"';
const echoOk = (word) => nodeEval("console.log('" + word + "')");

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertHas(hay, needle, label) {
  assert(hay.includes(needle), (label || "output") + " missing " + JSON.stringify(needle) + "\n--- got ---\n" + hay);
}
function assertLacks(hay, needle, label) {
  assert(!hay.includes(needle), (label || "output") + " unexpectedly contains " + JSON.stringify(needle) + "\n--- got ---\n" + hay);
}

// --------------------------------------------------------------- tests

test("args: two explicit files are both processed without --timeout", async () => {
  const s = sandbox();
  try {
    s.write("gates/leaf-a.md", "# Gates: A\n\n" + gate("G1", "A", echoOk("A-OK"), "A-OK"));
    s.write("gates/leaf-b.md", "# Gates: B\n\n" + gate("G1", "B", echoOk("B-OK"), "B-OK"));
    const r = await run(GATE_CHECK, ["gates/leaf-a.md", "gates/leaf-b.md"], { cwd: s.dir });
    assertHas(r.out, "PASS leaf-a:G1");
    assertHas(r.out, "PASS leaf-b:G1");
    assertHas(r.out, "ALL MET (2 met)");
    assertHas(s.read("gates/leaf-a.md"), "- [x] G1", "leaf-a");
    assert(r.code === 0, "expected exit 0, got " + r.code);
  } finally { s.cleanup(); }
});

test("args: one explicit file never widens to the rest of the tree", async () => {
  const s = sandbox();
  try {
    s.write("gates/leaf-a.md", "# Gates: A\n\n" + gate("G1", "A", echoOk("A-OK"), "A-OK"));
    s.write("gates/leaf-b.md", "# Gates: B\n\n" + gate("G1", "B", echoOk("B-OK"), "B-OK"));
    const r = await run(GATE_CHECK, ["gates/leaf-a.md"], { cwd: s.dir });
    assertHas(r.out, "PASS leaf-a:G1");
    assertLacks(r.out, "leaf-b", "run output");
    assertHas(s.read("gates/leaf-b.md"), "- [ ] G1", "leaf-b must be untouched");
    assertHas(s.read("gates/leaf-b.md"), "EVIDENCE: pending", "leaf-b evidence must be untouched");
  } finally { s.cleanup(); }
});

test("args: unknown option is rejected instead of treated as a file", async () => {
  const s = sandbox();
  try {
    s.write("GATES.md", "# Gates\n\n" + gate("G1", "x", echoOk("OK"), "OK"));
    const r = await run(GATE_CHECK, ["--nope"], { cwd: s.dir });
    assert(r.code === 2, "expected exit 2, got " + r.code);
    assertHas(r.out, "unknown option --nope");
  } finally { s.cleanup(); }
});

test("scope: running one pipeline leaves the other pipeline alone", async () => {
  const s = sandbox();
  try {
    s.write(".unlazy/api/gates/leaf-1.md", "# Gates: api1\n\n" + gate("G1", "api", echoOk("API-OK"), "API-OK"));
    s.write(".unlazy/web/gates/leaf-1.md", "# Gates: web1\n\n" + gate("G1", "web", echoOk("WEB-OK"), "WEB-OK"));
    const r = await run(GATE_CHECK, ["--scope", "api"], { cwd: s.dir });
    assertHas(r.out, "PASS leaf-1:G1");
    assertHas(r.out, "[scope api]");
    assertHas(s.read(".unlazy/api/gates/leaf-1.md"), "- [x] G1", "api gates");
    assertHas(s.read(".unlazy/web/gates/leaf-1.md"), "- [ ] G1", "web gates must be untouched");
  } finally { s.cleanup(); }
});

test("scope: two pipelines and no scope is refused, not guessed", async () => {
  const s = sandbox();
  try {
    s.write(".unlazy/api/gates/leaf-1.md", "# Gates: api\n\n" + gate("G1", "api", echoOk("API-OK"), "API-OK"));
    s.write(".unlazy/web/gates/leaf-1.md", "# Gates: web\n\n" + gate("G1", "web", echoOk("WEB-OK"), "WEB-OK"));
    const r = await run(GATE_CHECK, [], { cwd: s.dir });
    assert(r.code === 2, "expected exit 2, got " + r.code);
    assertHas(r.out, "2 pipelines present");
    assertHas(r.out, "api");
    assertHas(r.out, "web");
    assertHas(s.read(".unlazy/api/gates/leaf-1.md"), "- [ ] G1", "api must be untouched");
    assertHas(s.read(".unlazy/web/gates/leaf-1.md"), "- [ ] G1", "web must be untouched");
  } finally { s.cleanup(); }
});

test("scope: UNLAZY_SCOPE selects the pipeline", async () => {
  const s = sandbox();
  try {
    s.write(".unlazy/api/gates/leaf-1.md", "# Gates: api\n\n" + gate("G1", "api", echoOk("API-OK"), "API-OK"));
    s.write(".unlazy/web/gates/leaf-1.md", "# Gates: web\n\n" + gate("G1", "web", echoOk("WEB-OK"), "WEB-OK"));
    const r = await run(GATE_CHECK, [], { cwd: s.dir, env: { UNLAZY_SCOPE: "web" } });
    assertHas(r.out, "[scope web]");
    assertHas(s.read(".unlazy/web/gates/leaf-1.md"), "- [x] G1", "web gates");
    assertHas(s.read(".unlazy/api/gates/leaf-1.md"), "- [ ] G1", "api must be untouched");
  } finally { s.cleanup(); }
});

test("scope: a single pipeline needs no flag", async () => {
  const s = sandbox();
  try {
    s.write(".unlazy/solo/GATES.md", "# Gates: solo\n\n" + gate("G1", "solo", echoOk("S-OK"), "S-OK"));
    const r = await run(GATE_CHECK, [], { cwd: s.dir });
    assertHas(r.out, "ALL MET (1 met) [scope solo]");
  } finally { s.cleanup(); }
});

test("scope: legacy GATES.md layout still works", async () => {
  const s = sandbox();
  try {
    s.write("GATES.md", "# Gates\n\n" + gate("G1", "legacy", echoOk("L-OK"), "L-OK"));
    const r = await run(GATE_CHECK, [], { cwd: s.dir });
    assertHas(r.out, "PASS GATES:G1");
    assertHas(r.out, "ALL MET (1 met)");
  } finally { s.cleanup(); }
});

test("state: checked box with pending evidence counts as unmet", async () => {
  const s = sandbox();
  try {
    s.write("GATES.md", "# Gates\n\n- [x] G1: claimed\n  EVIDENCE: pending\n");
    const r = await run(GATE_CHECK, ["--status"], { cwd: s.dir });
    assert(r.code === 1, "expected exit 1, got " + r.code);
    assertHas(r.out, "UNMET GATES:G1 (checked but EVIDENCE pending)");
  } finally { s.cleanup(); }
});

test("state: ABANDON resolves a gate honestly", async () => {
  const s = sandbox();
  try {
    s.write("GATES.md", "# Gates\n\n- [ ] G1: impossible\n  EVIDENCE: pending\n\nABANDON: G1 upstream API removed\n");
    const r = await run(GATE_CHECK, ["--status"], { cwd: s.dir });
    assert(r.code === 0, "expected exit 0, got " + r.code);
    assertHas(r.out, "1 abandoned");
  } finally { s.cleanup(); }
});

test("state: unmet gates are reported with file-qualified ids", async () => {
  const s = sandbox();
  try {
    s.write(".unlazy/api/gates/leaf-1.md", "# Gates: 1\n\n" + gate("G1", "a", null, null));
    s.write(".unlazy/api/gates/leaf-2.md", "# Gates: 2\n\n" + gate("G1", "b", null, null));
    const r = await run(GATE_CHECK, ["--scope", "api", "--status"], { cwd: s.dir });
    assertHas(r.out, "leaf-1:G1");
    assertHas(r.out, "leaf-2:G1");
  } finally { s.cleanup(); }
});

test("run: a concurrent edit to another gate in the same file survives", async () => {
  const s = sandbox();
  try {
    // G1 is slow and will be flipped by gate-check; G2 is manual and gets its
    // evidence filled in by hand while that check is still running.
    s.write("GATES.md",
      "# Gates\n\n" +
      "- [ ] G1: slow\n  CHECK: " + nodeEval("setTimeout(()=>console.log('SLOW-OK'),2500)") +
      "\n  EXPECT: SLOW-OK\n  EVIDENCE: pending\n\n" +
      "- [ ] G2: manual\n  EVIDENCE: pending\n");
    const running = run(GATE_CHECK, [], { cwd: s.dir });
    await new Promise(r => setTimeout(r, 800));
    const text = s.read("GATES.md")
      .replace("- [ ] G2: manual\n  EVIDENCE: pending", "- [x] G2: manual\n  EVIDENCE: measured 47 rows, threadAnalysis.ts:88");
    s.write("GATES.md", text);
    await running;
    const after = s.read("GATES.md");
    assertHas(after, "- [x] G1", "G1 should be flipped by the checker");
    assertHas(after, "measured 47 rows", "the hand edit to G2 must not be clobbered");
    assertLacks(after, "G2: manual\n  EVIDENCE: pending", "G2 must not be reverted");
  } finally { s.cleanup(); }
});

test("checks: CWD runs a check in the directory it names", async () => {
  const s = sandbox();
  try {
    s.write("sub/marker.txt", "here\n");
    s.write("GATES.md", "# Gates\n\n" +
      "- [ ] G1: in sub\n  CHECK: " + nodeEval("console.log(require('fs').readFileSync('marker.txt','utf8'))") +
      "\n  EXPECT: here\n  CWD: sub\n  EVIDENCE: pending\n");
    const r = await run(GATE_CHECK, [], { cwd: s.dir });
    assertHas(r.out, "ALL MET (1 met)");
  } finally { s.cleanup(); }
});

test("leases: overlapping OWNS across pipelines is refused", async () => {
  const s = sandbox();
  try {
    s.write(".unlazy/api/gates/leaf-1.md", "OWNS: src/shared/**\n\n# Gates\n\n" + gate("G1", "a", null, null));
    s.write(".unlazy/web/gates/leaf-1.md", "OWNS: src/shared/util.ts\n\n# Gates\n\n" + gate("G1", "b", null, null));
    const a = await run(GATE_CHECK, ["--scope", "api", "--leaf", "leaf-1", "--claim"], { cwd: s.dir });
    assertHas(a.out, "CLAIMED 1 path(s) for api/leaf-1");
    const b = await run(GATE_CHECK, ["--scope", "web", "--leaf", "leaf-1", "--claim"], { cwd: s.dir });
    assert(b.code === 3, "expected exit 3 on conflict, got " + b.code);
    assertHas(b.out, "CONFLICT src/shared/util.ts overlaps src/shared/** held by api/leaf-1");
    assertHas(b.out, "CLAIM REFUSED");
  } finally { s.cleanup(); }
});

test("leases: disjoint OWNS both succeed, and release frees them", async () => {
  const s = sandbox();
  try {
    s.write(".unlazy/api/gates/leaf-1.md", "OWNS: src/api/**\n\n# Gates\n\n" + gate("G1", "a", null, null));
    s.write(".unlazy/api/gates/leaf-2.md", "OWNS: src/web/**\n\n# Gates\n\n" + gate("G1", "b", null, null));
    const a = await run(GATE_CHECK, ["--scope", "api", "--leaf", "leaf-1", "--claim"], { cwd: s.dir });
    const b = await run(GATE_CHECK, ["--scope", "api", "--leaf", "leaf-2", "--claim"], { cwd: s.dir });
    assert(a.code === 0 && b.code === 0, "disjoint claims should both succeed");
    assertHas(b.out, "CLAIMED 1 path(s) for api/leaf-2");
    const rel = await run(GATE_CHECK, ["--scope", "api", "--release"], { cwd: s.dir });
    assertHas(rel.out, "released 2 lease(s)");
  } finally { s.cleanup(); }
});

test("status log: appends, and appends survive concurrency", async () => {
  const s = sandbox();
  try {
    s.write(".unlazy/api/gates/leaf-1.md", "# Gates\n\n" + gate("G1", "a", null, null));
    await Promise.all([
      run(GATE_CHECK, ["--scope", "api", "--log", "leaf-1 started"], { cwd: s.dir }),
      run(GATE_CHECK, ["--scope", "api", "--log", "leaf-2 started"], { cwd: s.dir }),
      run(GATE_CHECK, ["--scope", "api", "--log", "leaf-3 started"], { cwd: s.dir }),
    ]);
    const log = s.read(".unlazy/api/status.log");
    for (const n of [1, 2, 3]) assertHas(log, "leaf-" + n + " started", "status log");
  } finally { s.cleanup(); }
});

test("hook: does not block on a pipeline this session does not own", async () => {
  const s = sandbox();
  try {
    // api is finished; web has never been started. Ending the api session must
    // not be blocked by web's gates.
    s.write(".unlazy/api/gates/leaf-1.md", "# Gates\n\n- [x] G1: done\n  EVIDENCE: measured, 8/8 passed\n");
    s.write(".unlazy/web/gates/leaf-1.md", "# Gates\n\n" + gate("G1", "not started", null, null));
    const r = await run(STOP_HOOK, ["--scope", "api"], { cwd: s.dir, stdin: JSON.stringify({ cwd: s.dir }) });
    assertLacks(r.out, '"decision":"block"', "hook");
    assert(r.code === 0, "hook should exit 0");
  } finally { s.cleanup(); }
});

test("hook: blocks on its own scope, naming qualified ids", async () => {
  const s = sandbox();
  try {
    s.write(".unlazy/api/gates/leaf-7.md", "# Gates\n\n" + gate("G3", "unfinished", null, null));
    s.write(".unlazy/web/gates/leaf-1.md", "# Gates\n\n- [x] G1: done\n  EVIDENCE: proven\n");
    const r = await run(STOP_HOOK, ["--scope", "api"], { cwd: s.dir, stdin: JSON.stringify({ cwd: s.dir }) });
    assertHas(r.out, '"decision":"block"');
    assertHas(r.out, "leaf-7:G3");
    assertHas(r.out, "[scope api]");
  } finally { s.cleanup(); }
});

test("hook: unresolvable scope allows the stop instead of blocking blindly", async () => {
  const s = sandbox();
  try {
    s.write(".unlazy/api/gates/leaf-1.md", "# Gates\n\n" + gate("G1", "a", null, null));
    s.write(".unlazy/web/gates/leaf-1.md", "# Gates\n\n" + gate("G1", "b", null, null));
    const r = await run(STOP_HOOK, [], { cwd: s.dir, stdin: JSON.stringify({ cwd: s.dir }) });
    assertLacks(r.out, '"decision":"block"', "hook");
    assertHas(r.out, "2 pipelines");
  } finally { s.cleanup(); }
});

test("hook: session binding resolves the scope among several", async () => {
  const s = sandbox();
  try {
    s.write(".unlazy/api/gates/leaf-1.md", "# Gates\n\n" + gate("G1", "a", null, null));
    s.write(".unlazy/web/gates/leaf-1.md", "# Gates\n\n" + gate("G1", "b", null, null));
    const bind = await run(GATE_CHECK, ["--scope", "web", "--bind", "sess-abc"], { cwd: s.dir });
    assertHas(bind.out, "bound session sess-abc to scope web");
    const r = await run(STOP_HOOK, [], { cwd: s.dir, stdin: JSON.stringify({ cwd: s.dir, session_id: "sess-abc" }) });
    assertHas(r.out, '"decision":"block"');
    assertHas(r.out, "[scope web]");
  } finally { s.cleanup(); }
});

test("hook: each pipeline keeps its own loop-guard counter", async () => {
  const s = sandbox();
  try {
    s.write(".unlazy/api/gates/leaf-1.md", "# Gates\n\n" + gate("G1", "a", null, null));
    s.write(".unlazy/web/gates/leaf-1.md", "# Gates\n\n" + gate("G1", "b", null, null));
    const stdin = JSON.stringify({ cwd: s.dir });
    for (let i = 0; i < 7; i++) await run(STOP_HOOK, ["--scope", "api"], { cwd: s.dir, stdin });
    const apiState = JSON.parse(s.read(".unlazy/api/hook-state.json"));
    const apiSession = Object.values(apiState.sessions)[0];
    assert(apiSession.blocks === 7, "api counter should be 7, got " + apiSession.blocks);
    // api has exhausted its guard and now releases; web is untouched and still blocks.
    const apiNow = await run(STOP_HOOK, ["--scope", "api"], { cwd: s.dir, stdin });
    assertHas(apiNow.out, "releasing after 6 blocks");
    const webNow = await run(STOP_HOOK, ["--scope", "web"], { cwd: s.dir, stdin });
    assertHas(webNow.out, '"decision":"block"');
  } finally { s.cleanup(); }
});

test("hook: no gate files anywhere means silence", async () => {
  const s = sandbox();
  try {
    const r = await run(STOP_HOOK, [], { cwd: s.dir, stdin: JSON.stringify({ cwd: s.dir }) });
    assert(r.out.trim() === "", "expected no output, got: " + r.out);
    assert(r.code === 0, "expected exit 0");
  } finally { s.cleanup(); }
});

test("install: repeated install stays a single Stop entry", async () => {
  const s = sandbox();
  try {
    await run(INSTALL, ["--scope", "api"], { cwd: s.dir });
    await run(INSTALL, ["--scope", "api"], { cwd: s.dir });
    const cfg = JSON.parse(s.read(".claude/settings.local.json"));
    assert(cfg.hooks.Stop.length === 1, "expected 1 Stop entry, got " + cfg.hooks.Stop.length);
    assertHas(cfg.hooks.Stop[0].hooks[0].command, "--scope api", "hook command");
  } finally { s.cleanup(); }
});

test("install: changing the scope replaces the entry instead of stacking", async () => {
  const s = sandbox();
  try {
    await run(INSTALL, ["--scope", "api"], { cwd: s.dir });
    await run(INSTALL, ["--scope", "web"], { cwd: s.dir });
    const cfg = JSON.parse(s.read(".claude/settings.local.json"));
    assert(cfg.hooks.Stop.length === 1, "expected 1 Stop entry, got " + cfg.hooks.Stop.length);
    assertHas(cfg.hooks.Stop[0].hooks[0].command, "--scope web", "hook command");
  } finally { s.cleanup(); }
});

test("install: uninstall removes our entry and leaves others alone", async () => {
  const s = sandbox();
  try {
    s.write(".claude/settings.local.json", JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: "command", command: "node other-tool.mjs" }] }] },
    }, null, 2));
    await run(INSTALL, ["--scope", "api"], { cwd: s.dir });
    const r = await run(INSTALL, ["--uninstall"], { cwd: s.dir });
    assertHas(r.out, "Removed unlazy Stop hook");
    const cfg = JSON.parse(s.read(".claude/settings.local.json"));
    assert(cfg.hooks.Stop.length === 1, "expected the unrelated hook to remain");
    assertHas(cfg.hooks.Stop[0].hooks[0].command, "other-tool.mjs", "unrelated hook");
  } finally { s.cleanup(); }
});

test("install: an upstream v2.0 entry is still recognised and removable", async () => {
  const s = sandbox();
  try {
    s.write(".claude/settings.local.json", JSON.stringify({
      hooks: {
        Stop: [{
          hooks: [{
            type: "command",
            command: 'node "/home/me/.claude/skills/unlazy/scripts/stop-hook.mjs"',
          }],
        }],
      },
    }, null, 2));
    const r = await run(INSTALL, ["--uninstall"], { cwd: s.dir });
    assertHas(r.out, "Removed unlazy Stop hook");
    const cfg = JSON.parse(s.read(".claude/settings.local.json"));
    assert(!cfg.hooks, "settings should be left clean, got " + JSON.stringify(cfg));
  } finally { s.cleanup(); }
});

// ---------------------------------------------------------------- driver

const selected = tests.filter(t => t.name.includes(filter));
let passed = 0;
const failures = [];

for (const t of selected) {
  try {
    await t.fn();
    passed++;
    console.log("ok   " + t.name);
  } catch (e) {
    failures.push({ name: t.name, err: e });
    console.log("FAIL " + t.name + "\n     " + String(e.message).split("\n").join("\n     "));
  }
}

console.log("");
console.log(passed + "/" + selected.length + " passed");
try { rmSync(APPROVAL_ROOT, { recursive: true, force: true }); } catch { /* best effort */ }
process.exit(failures.length ? 1 : 0);
