#!/usr/bin/env node
// Black-box tests for dispatch launch barriers. Zero dependencies, Node 16+.

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DISPATCH_CHECK = join(HERE, "..", "scripts", "dispatch-check.mjs");
const filter = process.argv[2] || "";
const tests = [];

const test = (name, fn) => tests.push({ name, fn });
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const assertHas = (value, expected) => {
  assert(value.includes(expected), "output missing " + JSON.stringify(expected) + "\n--- got ---\n" + value);
};

function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "unlazy-dispatch-test-"));
  return {
    dir,
    write(relative, value) {
      const file = join(dir, relative);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, value);
    },
    read(relative) { return readFileSync(join(dir, relative), "utf8"); },
    cleanup() { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } },
  };
}

function run(args, options = {}) {
  return new Promise((resolveResult) => {
    execFile(process.execPath, [DISPATCH_CHECK, ...args], {
      cwd: options.cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    }, (error, stdout, stderr) => {
      resolveResult({
        code: error ? (error.code ?? 1) : 0,
        out: (stdout || "") + (stderr || ""),
      });
    });
  });
}

const base = (command, wave = "ready-1") => [command, "--scope", "api", "--wave", wave];

test("barrier: every leaf must start before seal or return", async () => {
  const s = sandbox();
  try {
    let result = await run([...base("open"), "--leaf", "leaf-a", "--leaf", "leaf-b"], { cwd: s.dir });
    assert(result.code === 0, result.out);
    assertHas(result.out, "OPEN ready-1 (0/2 started, 0/2 returned)");

    result = await run([...base("start"), "--leaf", "leaf-a", "--handle", "codex:a"], { cwd: s.dir });
    assert(result.code === 0, result.out);

    result = await run([...base("return"), "--leaf", "leaf-a"], { cwd: s.dir });
    assert(result.code === 2, "premature return should exit 2, got " + result.code);
    assertHas(result.out, "return requires a sealed wave");

    result = await run(base("seal"), { cwd: s.dir });
    assert(result.code === 2, "incomplete seal should exit 2, got " + result.code);
    assertHas(result.out, "missing starts for leaf-b");

    await run([...base("start"), "--leaf", "leaf-b", "--handle", "codex:b"], { cwd: s.dir });
    result = await run(base("seal"), { cwd: s.dir });
    assert(result.code === 0, result.out);
    assertHas(result.out, "SEALED ready-1 (2/2 started)");

    await run([...base("return"), "--leaf", "leaf-b"], { cwd: s.dir });
    result = await run([...base("return"), "--leaf", "leaf-a"], { cwd: s.dir });
    assert(result.code === 0, result.out);
    assertHas(result.out, "COMPLETE ready-1 (2/2 returned)");

    result = await run(base("status"), { cwd: s.dir });
    assert(result.code === 0, result.out);
    assertHas(result.out, "COMPLETE ready-1 (2/2 returned)");
  } finally { s.cleanup(); }
});

test("validation: duplicate leaves and duplicate waves are rejected", async () => {
  const s = sandbox();
  try {
    let result = await run([...base("open"), "--leaf", "leaf-a", "--leaf", "leaf-a"], { cwd: s.dir });
    assert(result.code === 2, "duplicate leaves should exit 2, got " + result.code);
    assertHas(result.out, "duplicate leaf leaf-a");

    result = await run([...base("open"), "--leaf", "leaf-a"], { cwd: s.dir });
    assert(result.code === 0, result.out);
    result = await run([...base("open"), "--leaf", "leaf-b"], { cwd: s.dir });
    assert(result.code === 2, "duplicate wave should exit 2, got " + result.code);
    assertHas(result.out, "wave ready-1 already exists");
  } finally { s.cleanup(); }
});

test("validation: unknown leaves and reused handles are rejected", async () => {
  const s = sandbox();
  try {
    await run([...base("open"), "--leaf", "leaf-a", "--leaf", "leaf-b"], { cwd: s.dir });
    let result = await run([...base("start"), "--leaf", "leaf-c", "--handle", "codex:c"], { cwd: s.dir });
    assert(result.code === 2, "unknown leaf should exit 2, got " + result.code);
    assertHas(result.out, "unknown leaf leaf-c");

    await run([...base("start"), "--leaf", "leaf-a", "--handle", "codex:shared"], { cwd: s.dir });
    result = await run([...base("start"), "--leaf", "leaf-b", "--handle", "codex:shared"], { cwd: s.dir });
    assert(result.code === 2, "duplicate handle should exit 2, got " + result.code);
    assertHas(result.out, "handle is already assigned to leaf-a");

    result = await run([...base("start"), "--leaf", "leaf-a", "--handle", "codex:again"], { cwd: s.dir });
    assert(result.code === 2, "duplicate start should exit 2, got " + result.code);
    assertHas(result.out, "leaf leaf-a already started");
  } finally { s.cleanup(); }
});

test("locking: simultaneous start records are not lost", async () => {
  const s = sandbox();
  try {
    const leaves = ["leaf-a", "leaf-b", "leaf-c", "leaf-d"];
    await run([...base("open"), ...leaves.flatMap((leaf) => ["--leaf", leaf])], { cwd: s.dir });
    const results = await Promise.all(leaves.map((leaf) =>
      run([...base("start"), "--leaf", leaf, "--handle", "codex:" + leaf], { cwd: s.dir })));
    assert(results.every((result) => result.code === 0), results.map((result) => result.out).join("\n"));

    const state = JSON.parse(s.read(".unlazy/api/dispatch.json"));
    assert(Object.keys(state.waves["ready-1"].started).length === 4,
      "expected four persisted starts, got " + JSON.stringify(state));
    const sealed = await run(base("seal"), { cwd: s.dir });
    assert(sealed.code === 0, sealed.out);
  } finally { s.cleanup(); }
});

test("validation: malformed ids, handles, and state fail closed", async () => {
  const s = sandbox();
  try {
    let result = await run(["open", "--scope", "../api", "--wave", "ready-1", "--leaf", "leaf-a"], { cwd: s.dir });
    assert(result.code === 2, "invalid scope should exit 2, got " + result.code);
    assertHas(result.out, "scope must match");

    await run([...base("open"), "--leaf", "leaf-a"], { cwd: s.dir });
    result = await run([...base("start"), "--leaf", "leaf-a", "--handle", "bad\nhandle"], { cwd: s.dir });
    assert(result.code === 2, "control character should exit 2, got " + result.code);
    assertHas(result.out, "handle must be printable");

    s.write(".unlazy/api/dispatch.json", "{not json\n");
    result = await run(base("status"), { cwd: s.dir });
    assert(result.code === 2, "malformed state should exit 2, got " + result.code);
    assertHas(result.out, "invalid dispatch state");
  } finally { s.cleanup(); }
});

const selected = tests.filter(({ name }) => name.includes(filter));
let passed = 0;
const failures = [];

for (const current of selected) {
  try {
    await current.fn();
    passed += 1;
    console.log("ok   " + current.name);
  } catch (error) {
    failures.push({ name: current.name, error });
    console.log("FAIL " + current.name + "\n     " + String(error.message).split("\n").join("\n     "));
  }
}

console.log("\n" + passed + "/" + selected.length + " passed");
process.exit(failures.length ? 1 : 0);
