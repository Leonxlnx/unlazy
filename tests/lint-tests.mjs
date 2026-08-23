#!/usr/bin/env node
// lint-tests.mjs : behavioural tests for scripts/gate-lint.mjs.
// Zero dependencies, cross-platform.
//
//   node tests/lint-tests.mjs            run all
//   node tests/lint-tests.mjs regex      run tests whose name contains "regex"
//
// Prints "N/N passed" on success, which is the string CI matches on.

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const HERE = dirname(fileURLToPath(import.meta.url));
const LINT = join(HERE, "..", "scripts", "gate-lint.mjs");
const filter = process.argv[2] || "";
const DIR = mkdtempSync(join(tmpdir(), "unlazy-lint-test-"));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function write(name, body) {
  const path = join(DIR, name);
  writeFileSync(path, body);
  return path;
}

function lint(...args) {
  const result = spawnSync(process.execPath, [LINT, ...args], { encoding: "utf8" });
  return { out: result.stdout + result.stderr, code: result.status };
}

// ------------------------------------------------------------- fixtures

// Every defect below passes gate-check and the Stop hook today.
const WEAK = write("weak.md", `# Gates: weak ledger

Scope: a ledger that satisfies every enforcement layer and proves nothing

- [ ] G1: the entire feature works perfectly
  CHECK: echo ok
  EXPECT: ok
  EVIDENCE: pending

- [ ] G2: improve the error handling
  CHECK: node scripts/verify.mjs --banner DONE
  EXPECT: DONE
  EVIDENCE: pending

- [ ] G3: renders 34 stat rows
  EVIDENCE: pending

- [ ] G4: config path is reported
  CHECK: node scripts/show-path.mjs
  EXPECT: /etc/app/conf/
  EVIDENCE: pending
`);

const SOUND_BODY = `# Gates: sound ledger

Scope: pricing section renders and behaves

- [ ] G1: three tiers render with real copy
  CHECK: node scripts/check.mjs pricing --tiers
  EXPECT: 3/3 tiers rendered
  EVIDENCE: pending

- [ ] G2: annual toggle changes price and label
  CHECK: node scripts/check.mjs pricing --toggle
  EXPECT: toggle switched both fields
  EVIDENCE: pending

- [ ] G3: typecheck is clean
  CHECK: npx tsc --noEmit
  EXPECT: /Found 0 errors/
  EVIDENCE: pending

- [ ] G4: unit suite green
  CHECK: node --test test/pricing.test.mjs
  EXPECT: /# fail 0/
  EVIDENCE: pending

- [ ] G5: no console errors on load
  CHECK: node scripts/check.mjs pricing --console
  EXPECT: 0 console errors
  EVIDENCE: pending
`;

const SOUND = write("sound.md", SOUND_BODY);
const MANUAL = write("manual.md", SOUND_BODY + `
- [ ] G6: copy reads as written by the brand, not by a model
  EVIDENCE: pending
`);

// ------------------------------------------------------------- tests

test("lint: an oracle that cannot fail is an error", () => {
  const { out, code } = lint(WEAK);
  assert.match(out, /G1: CHECK cannot fail/);
  assert.equal(code, 1);
});

test("lint: an expectation printed by its own command is an error", () => {
  assert.match(lint(WEAK).out, /G2:.*appears verbatim in its own CHECK/);
});

test("lint: an expectation shared with failure output is warned", () => {
  assert.match(lint(WEAK).out, /G1:.*also appears in failure output/);
});

test("lint: an activity title is warned", () => {
  assert.match(lint(WEAK).out, /G2:.*names an activity, not an outcome/);
});

test("lint: an unmeasured number in a manual gate is warned", () => {
  assert.match(lint(WEAK).out, /G3:.*states a number that nothing measures/);
});

test("lint: a literal path read as a regex is warned", () => {
  assert.match(lint(WEAK).out, /G4:.*looks like a literal path/);
});

test("lint: a deliberate slash wrapped pattern is not warned", () => {
  assert.doesNotMatch(lint(SOUND).out, /looks like a literal path/);
});

test("lint: a ledger under the size band is warned", () => {
  assert.match(lint(WEAK).out, /under five/);
});

test("lint: a sound ledger is clean and exits 0", () => {
  const { out, code } = lint(SOUND);
  assert.match(out, /^LINT OK$/m);
  assert.equal(code, 0);
});

test("lint: a manual gate warns without failing", () => {
  const { out, code } = lint(MANUAL);
  assert.match(out, /G6:.*judged by hand/);
  assert.equal(code, 0);
});

test("lint: strict promotes warnings to failure", () => {
  assert.equal(lint(MANUAL).code, 0);
  assert.equal(lint("--strict", MANUAL).code, 1);
});

test("lint: json reports counts and stays parseable", () => {
  const data = JSON.parse(lint("--json", WEAK).out);
  assert.equal(data.ok, false);
  assert.ok(data.errors >= 2, "expected at least two errors, got " + data.errors);
  assert.ok(data.findings.every((f) => f.rule && f.level));
});

test("lint: a ledger the shared parser rejects exits 2, not 1", () => {
  const broken = write("broken.md", "# Gates: broken\n\n- [ ] no explicit id here\n");
  assert.equal(lint(broken).code, 2);
});

test("lint: multiple ledgers in one run are all honored", () => {
  const { out } = lint(SOUND, WEAK);
  assert.match(out, /weak\.md/);
  assert.match(out, /G1: CHECK cannot fail/);
});

test("lint: an unknown option exits 2", () => {
  assert.equal(lint("--nope", SOUND).code, 2);
});

test("lint: no arguments exits 2", () => {
  assert.equal(lint().code, 2);
});

// ------------------------------------------------------------- runner

const selected = tests.filter((t) => t.name.includes(filter));
let passed = 0;
const failures = [];

for (const t of selected) {
  try {
    t.fn();
    passed++;
    console.log("ok   " + t.name);
  } catch (e) {
    failures.push(t.name);
    console.log("FAIL " + t.name + "\n     " + String(e.message).split("\n").join("\n     "));
  }
}

console.log("");
console.log(passed + "/" + selected.length + " passed");
try { rmSync(DIR, { recursive: true, force: true }); } catch { /* windows lag */ }
process.exit(failures.length ? 1 : 0);
