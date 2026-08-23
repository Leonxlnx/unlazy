#!/usr/bin/env node
// Security, parser, execution, and writeback regressions. Zero dependencies.

import {
  appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync,
  writeFileSync,
} from "node:fs";
import { execFile } from "node:child_process";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATE_CHECK = join(HERE, "..", "scripts", "gate-check.mjs");
const STOP_HOOK = join(HERE, "..", "scripts", "stop-hook.mjs");
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function sandbox() {
  // macOS and custom TMPDIR values can expose lexical aliases (for example
  // /var versus /private/var). Match the checker's canonical CWD semantics at
  // the fixture boundary so every path assertion is portable.
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "unlazy-hardening-")));
  const approvals = realpathSync(mkdtempSync(join(tmpdir(), "unlazy-approval-")));
  return {
    dir, approvals,
    path(rel) { return join(dir, rel); },
    write(rel, text) {
      const path = join(dir, rel);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
      return path;
    },
    read(rel) { return readFileSync(join(dir, rel), "utf8"); },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      rmSync(approvals, { recursive: true, force: true });
    },
  };
}

function run(script, args, options = {}) {
  return new Promise((done) => {
    const child = execFile(process.execPath, [script, ...args], {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, ...(options.env || {}) },
    }, (error, stdout, stderr) => {
      done({ code: error ? (typeof error.code === "number" ? error.code : 1) : 0, out: (stdout || "") + (stderr || "") });
    });
    if (options.stdin !== undefined) child.stdin.end(options.stdin);
  });
}

function gateRun(s, args, options = {}) {
  const action = args.some((arg) => ["--status", "--claim", "--release", "--list-scopes", "--log", "--bind", "--help"].includes(arg));
  const actual = options.approve !== false && !action && !args.includes("--approve") ? ["--approve", ...args] : args;
  return run(GATE_CHECK, actual, {
    cwd: s.dir,
    env: { UNLAZY_APPROVAL_DIR: s.approvals, ...(options.env || {}) },
  });
}

const gate = (id, title, check, expect, extra = "") =>
  "- [ ] " + id + ": " + title + "\n" +
  (check !== null ? "  CHECK: " + check + "\n" : "") +
  (expect !== null ? "  EXPECT: " + expect + "\n" : "") + extra +
  "  EVIDENCE: pending\n";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const has = (text, value, label = "output") => assert(text.includes(value), label + " missing " + JSON.stringify(value) + "\n" + text);
const lacks = (text, value, label = "output") => assert(!text.includes(value), label + " unexpectedly includes " + JSON.stringify(value) + "\n" + text);

test("approval: status is read-only and an unapproved CHECK is printed but not run", async () => {
  const s = sandbox();
  try {
    s.write("check.mjs", "import { writeFileSync } from 'node:fs'; writeFileSync('ran.txt','yes'); console.log('OK');\n");
    s.write("GATES.md", gate("G1", "approval", "node check.mjs", "OK"));
    const before = s.read("GATES.md");
    const status = await gateRun(s, ["--status"], { approve: false, env: { UNLAZY_SHELL: "definitely-missing-shell" } });
    assert(status.code === 1, "status should report unmet");
    assert(s.read("GATES.md") === before, "status changed ledger");
    assert(!readdirSync(s.approvals).length, "status wrote approval state");
    const denied = await gateRun(s, [], { approve: false });
    assert(denied.code === 1, "unapproved run should remain unmet");
    has(denied.out, "APPROVAL REQUIRED GATES:G1");
    has(denied.out, "NOT RUN");
    assert(!s.path("ran.txt") || !await fileExists(s.path("ran.txt")), "unapproved CHECK executed");
    s.write("GATES.md", "- [x] G1: claimed\n  CHECK: node check.mjs\n  EXPECT: OK\n  EVIDENCE: claimed\n");
    const unverified = await gateRun(s, ["--reverify"], { approve: false });
    assert(unverified.code === 1, "unapproved reverify must not certify existing evidence\n" + unverified.out);
    has(unverified.out, "GATES:G1 (reverify not run)");
  } finally { s.cleanup(); }
});

async function fileExists(path) {
  try { await import("node:fs/promises").then((fs) => fs.access(path)); return true; }
  catch { return false; }
}

test("approval: token binds the full oracle and changing CWD invalidates it", async () => {
  const s = sandbox();
  try {
    for (const dir of ["a", "b"]) s.write(dir + "/check.mjs", "console.log('OK');\n");
    s.write("GATES.md", gate("G1", "oracle", "node check.mjs", "OK", "  CWD: a\n"));
    const first = await gateRun(s, []);
    assert(first.code === 0, first.out);
    const tokens = readdirSync(s.approvals).filter((name) => name.endsWith(".json"));
    assert(tokens.length === 1, "expected one approval token");
    const token = JSON.parse(readFileSync(join(s.approvals, tokens[0]), "utf8"));
    for (const key of ["check", "expect", "cwd", "shell", "timeoutMs", "maxOutputBytes", "regexTimeoutMs", "platform", "path"]) {
      assert(Object.prototype.hasOwnProperty.call(token.oracle, key), "approval oracle missing " + key);
    }
    s.write("GATES.md", gate("G1", "oracle", "node check.mjs", "OK", "  CWD: b\n"));
    const changed = await gateRun(s, [], { approve: false });
    assert(changed.code === 1, changed.out);
    has(changed.out, "APPROVAL REQUIRED");
    has(changed.out, join(s.dir, "b"));
  } finally { s.cleanup(); }
});

test("approval: storage failures use the infrastructure exit code", async () => {
  const s = sandbox();
  try {
    s.write("ok.mjs", "console.log('OK');\n");
    s.write("GATES.md", gate("G1", "approval storage", "node ok.mjs", "OK"));
    rmSync(s.approvals, { recursive: true, force: true });
    writeFileSync(s.approvals, "not a directory\n");
    const result = await gateRun(s, ["--approve"], {
      approve: false,
      env: { UNLAZY_APPROVAL_DIR: join(s.approvals, "records") },
    });
    assert(result.code === 2, "approval storage failure returned " + result.code + "\n" + result.out);
    has(result.out, "infrastructure failure prevented 1 approval");
  } finally { s.cleanup(); }
});

test("shell: resolution and PATH context are visible, invalid overrides are usage errors", async () => {
  const s = sandbox();
  try {
    s.write("ok.mjs", "console.log('SHELL-OK');\n");
    s.write("GATES.md", gate("G1", "shell", "node ok.mjs", "SHELL-OK"));
    const good = await gateRun(s, []);
    assert(good.code === 0, good.out);
    has(good.out, "shell=");
    has(good.out, "PATH=");
    const ledger = s.read("GATES.md");
    has(ledger, "exit=0; shell=");
    has(ledger, "; path=");
    s.write("GATES.md", gate("G1", "shell", "node ok.mjs", "SHELL-OK"));
    const bad = await gateRun(s, ["--shell", "definitely-missing-shell"], { approve: false });
    assert(bad.code === 2, bad.out);
    has(bad.out, "cannot resolve command shell");
  } finally { s.cleanup(); }
});

test("execution: exit zero and EXPECT must both pass", async () => {
  const s = sandbox();
  try {
    s.write("bad.mjs", "console.log('MATCH'); process.exitCode = 7;\n");
    s.write("GATES.md", gate("G1", "nonzero", "node bad.mjs", "MATCH"));
    const result = await gateRun(s, []);
    assert(result.code === 1, result.out);
    has(result.out, "exit=7; EXPECT=matched");
    has(s.read("GATES.md"), "- [ ] G1");
  } finally { s.cleanup(); }
});

test("execution: failure summaries retain early assertion diagnostics", async () => {
  const s = sandbox();
  try {
    s.write("bad.mjs", [
      "console.error('AssertionError: expected 3 but received 4');",
      "for (let index = 0; index < 20; index++) console.error('trailer-' + index);",
      "process.exitCode = 1;",
      "",
    ].join("\n"));
    s.write("GATES.md", gate("G1", "diagnostic", "node bad.mjs", "WILL-NOT-MATCH"));
    const result = await gateRun(s, []);
    assert(result.code === 1, result.out);
    has(result.out, "AssertionError: expected 3 but received 4");
    has(result.out, "trailer-19");
  } finally { s.cleanup(); }
});

test("reverify: a stale success is demoted and a reproducible success stays met", async () => {
  const s = sandbox();
  try {
    s.write("bad.mjs", "console.log('WRONG');\n");
    s.write("GATES.md", "- [x] G1: forged\n  CHECK: node bad.mjs\n  EXPECT: RIGHT\n  EVIDENCE: forged\n");
    const plain = await gateRun(s, []);
    assert(plain.code === 0, plain.out);
    const failed = await gateRun(s, ["--reverify"]);
    assert(failed.code === 1, failed.out);
    has(failed.out, "FAIL GATES:G1");
    has(s.read("GATES.md"), "- [ ] G1");
    has(s.read("GATES.md"), "EVIDENCE: pending");
    s.write("good.mjs", "console.log('RIGHT');\n");
    s.write("GATES.md", "- [x] G1: real\n  CHECK: node good.mjs\n  EXPECT: RIGHT\n  EVIDENCE: RIGHT\n");
    const passed = await gateRun(s, ["--reverify"]);
    assert(passed.code === 0, passed.out);
    has(passed.out, "reverified: 1");
  } finally { s.cleanup(); }
});

test("parser: fenced examples are ignored and CRLF plus missing EVIDENCE are preserved", async () => {
  const s = sandbox();
  try {
    s.write("ok.mjs", "console.log('OK');\n");
    s.write("GATES.md", [
      "- [ ] G1: real", "  CHECK: node ok.mjs", "  EXPECT: OK",
      "```markdown", "- [ ] BAD: example", "  CHECK: node absent.mjs", "  EXPECT: BAD", "```", "",
    ].join("\r\n"));
    const result = await gateRun(s, []);
    assert(result.code === 0, result.out);
    lacks(result.out, "BAD:");
    const after = s.read("GATES.md");
    has(after, "- [x] G1: real\r\n");
    has(after, "EVIDENCE: exit=0;");
    assert(!/(^|[^\r])\n/.test(after), "write introduced bare LF");
  } finally { s.cleanup(); }
});

test("parser: Markdown fence length and closing syntax are respected", async () => {
  const s = sandbox();
  try {
    s.write("ok.mjs", "console.log('REAL-OK');\n");
    s.write("GATES.md", [
      "# Gates",
      "",
      "````markdown",
      "```",
      "- [ ] FAKE: remains fenced",
      "  CHECK: node absent.mjs",
      "  EXPECT: FAKE",
      "```not-a-closing-fence",
      "````",
      "",
      "- [ ] G1: real gate after the fence",
      "  CHECK: node ok.mjs",
      "  EXPECT: REAL-OK",
      "  EVIDENCE: pending",
      "",
    ].join("\n"));
    const result = await gateRun(s, []);
    assert(result.code === 0, result.out);
    lacks(result.out, "FAKE:");
    has(result.out, "PASS GATES:G1");
  } finally { s.cleanup(); }
});

test("parser: malformed ledgers are usage errors in checker and blocking in hook", async () => {
  const cases = [
    ["zero", "# Gates only\n", "zero live gates"],
    ["duplicate", "- [ ] G1: a\n  EVIDENCE: pending\n- [ ] G1: b\n  EVIDENCE: pending\n", "duplicate gate id"],
    ["blank abandon", "- [ ] G1: a\n  EVIDENCE: pending\nABANDON: G1\n", "non-blank reason"],
    ["invalid regex", "- [ ] G1: a\n  CHECK: node x.mjs\n  EXPECT: /[/\n  EVIDENCE: pending\n", "invalid EXPECT regex"],
    ["incomplete", "- [ ] G1: a\n  CHECK: node x.mjs\n  EVIDENCE: pending\n", "require both"],
    ["unindented", "- [ ] G1: a\nCHECK: node x.mjs\nEXPECT: OK\nEVIDENCE: pending\n", "unindented"],
    ["orphan attribute", "  CHECK: node x.mjs\n- [ ] G1: manual\n  EVIDENCE: pending\n", "orphan CHECK"],
    ["missing id", "- [ ] outcome without id\n  EVIDENCE: pending\n", "explicit ID"],
    ["blank outcome", "- [ ] G1:\n  EVIDENCE: pending\n", "outcome is blank"],
  ];
  for (const [name, text, expected] of cases) {
    const s = sandbox();
    try {
      s.write("GATES.md", text);
      const status = await gateRun(s, ["--status"], { approve: false });
      assert(status.code === 2, name + " should exit 2\n" + status.out);
      has(status.out, expected, name);
      const hook = await run(STOP_HOOK, [], { cwd: s.dir, stdin: JSON.stringify({ cwd: s.dir, session_id: name }) });
      has(hook.out, '"decision":"block"', name + " hook");
      has(hook.out, "PARSE", name + " hook");
    } finally { s.cleanup(); }
  }
});

test("regex: a decisive regex succeeds and catastrophic matching is bounded", async () => {
  const s = sandbox();
  try {
    s.write("good.mjs", "console.log('total: 42 items');\n");
    s.write("GATES.md", gate("G1", "regex", "node good.mjs", "/total: \\d+ items/"));
    const good = await gateRun(s, []);
    assert(good.code === 0, good.out);
    s.write("evil.mjs", "console.log('a'.repeat(30000) + '!');\n");
    s.write("GATES.md", gate("G1", "bounded", "node evil.mjs", "/(a+)+$/"));
    const start = Date.now();
    const bad = await gateRun(s, []);
    const elapsed = Date.now() - start;
    assert(bad.code === 1, bad.out);
    has(bad.out, "EXPECT regex exceeded 250ms");
    assert(elapsed < 5000, "regex run was not bounded: " + elapsed + "ms");
  } finally { s.cleanup(); }
});

test("execution: output is capped and overflow cannot certify a gate", async () => {
  const s = sandbox();
  try {
    s.write("large.mjs", "process.stdout.write('x'.repeat(1100000)); console.log('FINAL');\n");
    s.write("GATES.md", gate("G1", "bounded output", "node large.mjs", "FINAL"));
    const result = await gateRun(s, []);
    assert(result.code === 1, result.out.slice(-2000));
    has(result.out, "output exceeded 1048576 bytes");
    assert(result.out.length < 1100000, "transcript leaked the full output");
  } finally { s.cleanup(); }
});

test("jobs: rolling concurrency is opt-in and output stays in gate order", async () => {
  const s = sandbox();
  try {
    for (let index = 1; index <= 3; index++) {
      s.write("g" + index + ".mjs",
        "import { appendFileSync } from 'node:fs';\n" +
        "appendFileSync('order.log','start" + index + "\\n');\n" +
        "setTimeout(()=>{appendFileSync('order.log','end" + index + "\\n'); console.log('OK" + index + "');},250);\n");
    }
    s.write("GATES.md", gate("G1", "one", "node g1.mjs", "OK1") +
      gate("G2", "two", "node g2.mjs", "OK2") + gate("G3", "three", "node g3.mjs", "OK3"));
    const result = await gateRun(s, ["--jobs", "2"]);
    assert(result.code === 0, result.out);
    const order = s.read("order.log").trim().split(/\r?\n/);
    const firstEnd = order.findIndex((line) => line.startsWith("end"));
    assert(firstEnd >= 2, "two checks did not overlap: " + order.join(","));
    assert(result.out.indexOf("PASS GATES:G1") < result.out.indexOf("PASS GATES:G2") &&
      result.out.indexOf("PASS GATES:G2") < result.out.indexOf("PASS GATES:G3"), "transcript order was nondeterministic\n" + result.out);
  } finally { s.cleanup(); }
});

test("jobs: runner waits for stdio close so delayed descendant output is visible", async () => {
  const s = sandbox();
  try {
    s.write("delayed.mjs",
      "import { spawn } from 'node:child_process';\n" +
      "spawn(process.execPath,['-e',\"setTimeout(()=>console.log('LATE_OK'),250)\"],{stdio:['ignore','inherit','inherit']});\n");
    s.write("GATES.md", gate("G1", "late output", "node delayed.mjs", "LATE_OK"));
    const result = await gateRun(s, []);
    assert(result.code === 0, result.out);
    has(result.out, "output=LATE_OK");
  } finally { s.cleanup(); }
});

test("writeback: a result cannot certify a gate whose oracle changed in flight", async () => {
  const s = sandbox();
  try {
    s.write("slow.mjs", "setTimeout(()=>console.log('OLD'),500);\n");
    s.write("GATES.md", gate("G1", "stale", "node slow.mjs", "OLD"));
    const running = gateRun(s, []);
    await new Promise((done) => setTimeout(done, 220));
    s.write("GATES.md", gate("G1", "stale", "node slow.mjs", "NEW"));
    const result = await running;
    has(result.out, "STALE GATES:G1");
    const after = s.read("GATES.md");
    has(after, "EXPECT: NEW");
    has(after, "- [ ] G1");
  } finally { s.cleanup(); }
});

test("reverify: a stale in-flight result cannot leave old evidence falsely green", async () => {
  const s = sandbox();
  try {
    s.write("slow.mjs", "setTimeout(()=>console.log('OLD'),500);\n");
    s.write("GATES.md", "- [x] G1: stale met\n  CHECK: node slow.mjs\n  EXPECT: OLD\n  EVIDENCE: old evidence\n");
    const running = gateRun(s, ["--reverify"]);
    await new Promise((done) => setTimeout(done, 220));
    s.write("GATES.md", "- [x] G1: stale met\n  CHECK: node slow.mjs\n  EXPECT: NEW\n  EVIDENCE: old evidence\n");
    const result = await running;
    assert(result.code === 1, "stale reverify returned " + result.code + "\n" + result.out);
    has(result.out, "STALE GATES:G1");
    has(result.out, "GATES:G1 (stale result discarded)");
    lacks(result.out, "ALL MET");
    lacks(result.out, "reverified: 1");
    assert(s.read("GATES.md").includes("EXPECT: NEW\n  EVIDENCE: old evidence"), "newer ledger was clobbered");
  } finally { s.cleanup(); }
});

test("CLI: numeric bounds, incompatible modes, and file types fail with exit 2", async () => {
  const s = sandbox();
  try {
    s.write("GATES.md", "- [ ] G1: manual\n  EVIDENCE: pending\n");
    mkdirSync(s.path("directory.md"));
    const cases = [
      ["--jobs", "0"], ["--jobs", "1.5"], ["--jobs", "Infinity"], ["--jobs", "65"],
      ["--timeout", "0"], ["--timeout", "1.5"], ["--timeout", "86401"], ["--timeout", "Infinity"], ["--timeout"],
      ["--status", "--reverify"], ["--status", "--approve"], ["directory.md"],
    ];
    for (const args of cases) {
      const result = await gateRun(s, args, { approve: false });
      assert(result.code === 2, args.join(" ") + " expected 2, got " + result.code + "\n" + result.out);
    }
  } finally { s.cleanup(); }
});

test("targeting: explicit files anchor relative commands and every positional file is honored", async () => {
  const s = sandbox();
  try {
    for (const name of ["a", "b"]) {
      s.write(name + "/check.mjs", "console.log('" + name.toUpperCase() + "');\n");
      s.write(name + "/leaf.md", gate("G1", name, "node check.mjs", name.toUpperCase()));
    }
    const result = await gateRun(s, ["--timeout", "5", "a/leaf.md", "b/leaf.md"]);
    assert(result.code === 0, result.out);
    has(result.out, "PASS leaf:G1");
    has(s.read("a/leaf.md"), "cwd=" + realpathSync(join(s.dir, "a")));
    has(s.read("b/leaf.md"), "cwd=" + realpathSync(join(s.dir, "b")));
  } finally { s.cleanup(); }
});

test("leases: unsafe declarations, unknown leaves, and wildcard witnesses fail closed", async () => {
  const s = sandbox();
  try {
    s.write(".unlazy/a/gates/leaf-a.md", "OWNS: src/a*.js\n\n" + gate("G1", "a", null, null));
    s.write(".unlazy/b/gates/leaf-b.md", "OWNS: src/ab*.js\n\n" + gate("G1", "b", null, null));
    const first = await gateRun(s, ["--scope", "a", "--leaf", "leaf-a", "--claim"], { approve: false });
    assert(first.code === 0, first.out);
    const overlap = await gateRun(s, ["--scope", "b", "--leaf", "leaf-b", "--claim"], { approve: false });
    assert(overlap.code === 3, overlap.out);
    has(overlap.out, "CONFLICT src/ab*.js overlaps src/a*.js");
    const unknown = await gateRun(s, ["--scope", "a", "--leaf", "missing", "--claim"], { approve: false });
    assert(unknown.code === 2, unknown.out);
    has(unknown.out, "unknown --leaf missing");
    const released = await gateRun(s, ["--scope", "a", "--release"], { approve: false });
    assert(released.code === 0, released.out);
    s.write(".unlazy/dot-a/gates/leaf.md", "OWNS: src/./same.js\n\n" + gate("G1", "dot a", null, null));
    s.write(".unlazy/dot-b/gates/leaf.md", "OWNS: src/same.js\n\n" + gate("G1", "dot b", null, null));
    const dotFirst = await gateRun(s, ["--scope", "dot-a", "--leaf", "leaf", "--claim"], { approve: false });
    assert(dotFirst.code === 0, dotFirst.out);
    has(dotFirst.out, "src/same.js");
    const dotOverlap = await gateRun(s, ["--scope", "dot-b", "--leaf", "leaf", "--claim"], { approve: false });
    assert(dotOverlap.code === 3, dotOverlap.out);
    has(dotOverlap.out, "CONFLICT src/same.js overlaps src/same.js");
    await gateRun(s, ["--scope", "dot-a", "--release"], { approve: false });
    s.write(".unlazy/prefix-a/gates/leaf.md", "OWNS: src/api\n\n" + gate("G1", "prefix a", null, null));
    s.write(".unlazy/prefix-b/gates/leaf.md", "OWNS: src/api/**\n\n" + gate("G1", "prefix b", null, null));
    const prefixFirst = await gateRun(s, ["--scope", "prefix-a", "--leaf", "leaf", "--claim"], { approve: false });
    assert(prefixFirst.code === 0, prefixFirst.out);
    const prefixOverlap = await gateRun(s, ["--scope", "prefix-b", "--leaf", "leaf", "--claim"], { approve: false });
    assert(prefixOverlap.code === 3, prefixOverlap.out);
    has(prefixOverlap.out, "CONFLICT src/api/** overlaps src/api");
    s.write(".unlazy/c/gates/leaf-c.md", "OWNS: ../outside/**\n\n" + gate("G1", "c", null, null));
    const unsafe = await gateRun(s, ["--scope", "c", "--leaf", "leaf-c", "--claim"], { approve: false });
    assert(unsafe.code === 2, unsafe.out);
    has(unsafe.out, "cannot contain traversal");
  } finally { s.cleanup(); }
});

let passed = 0;
const failures = [];
for (const item of tests) {
  try {
    await item.fn();
    passed++;
    console.log("ok   " + item.name);
  } catch (error) {
    failures.push(item.name);
    console.log("FAIL " + item.name + "\n     " + String(error.message).replace(/\n/g, "\n     "));
  }
}
console.log("\n" + passed + "/" + tests.length + " passed");
if (failures.length) {
  console.log("failed: " + failures.join(", "));
  process.exit(1);
}
