#!/usr/bin/env node
// Focused fixtures for PLAN contract reconciliation. Zero dependencies.
//
// The required ids below stand for a human reread of the current request. This
// test intentionally does not infer requirements from prose; it checks that the
// documented inventory control can discriminate omissions once that authority
// is supplied.

import assert from "node:assert/strict";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

function reviewContract(spec) {
  const gaps = [];
  const rows = new Map();
  for (const row of spec.rows) {
    if (rows.has(row.id)) gaps.push(row.id + ": duplicate row");
    rows.set(row.id, row);
  }
  for (const id of spec.required) {
    const row = rows.get(id);
    if (!row) { gaps.push(id + ": missing row"); continue; }
    if (row.revision !== spec.revision) gaps.push(id + ": stale revision");
    if (row.disposition === "REMOVED_BY_USER") {
      if (!spec.removedByUser.has(id)) gaps.push(id + ": removal lacks explicit user authority");
      continue;
    }
    if (row.disposition !== "ACTIVE") gaps.push(id + ": non-completion disposition " + row.disposition);
    if (!row.owner || !spec.owners.has(row.owner)) gaps.push(id + ": missing or stale owner");
    if (!row.observation || !spec.observations.has(row.observation)) {
      gaps.push(id + ": missing or stale observation");
    } else if (!spec.observations.get(row.observation).has(id)) {
      gaps.push(id + ": observation does not cover outcome");
    }
  }
  return gaps;
}

const base = () => ({
  required: ["A", "B"],
  revision: 1,
  removedByUser: new Set(),
  owners: new Set(["leaf-a", "leaf-b"]),
  observations: new Map([["GA", new Set(["A"])], ["GB", new Set(["B"])]]),
  rows: [
    { id: "A", owner: "leaf-a", observation: "GA", disposition: "ACTIVE", revision: 1 },
    { id: "B", owner: "leaf-b", observation: "GB", disposition: "ACTIVE", revision: 1 },
  ],
});

test("contract: A and B mapped to live owners and observations reconcile", () => {
  assert.deepEqual(reviewContract(base()), []);
});

test("contract: an omitted B is reported", () => {
  const spec = base();
  spec.rows.pop();
  assert.match(reviewContract(spec).join("\n"), /B: missing row/);
});

test("contract: an unowned B is reported", () => {
  const spec = base();
  spec.rows[1].owner = "";
  assert.match(reviewContract(spec).join("\n"), /B: missing or stale owner/);
});

test("contract: missing, stale, or wrong observations are reported", () => {
  const missing = base();
  missing.rows[1].observation = "";
  assert.match(reviewContract(missing).join("\n"), /missing or stale observation/);
  const stale = base();
  stale.rows[1].observation = "OLD";
  assert.match(reviewContract(stale).join("\n"), /missing or stale observation/);
  const wrong = base();
  wrong.rows[1].observation = "GA";
  assert.match(reviewContract(wrong).join("\n"), /does not cover outcome/);
});

test("contract: explicit removal is distinct from abandonment or deferment", () => {
  const removed = base();
  removed.rows[1].disposition = "REMOVED_BY_USER";
  removed.removedByUser.add("B");
  assert.deepEqual(reviewContract(removed), []);
  for (const disposition of ["ABANDONED", "DEFERRED", "OWNER_DECISION"]) {
    const spec = base();
    spec.rows[1].disposition = disposition;
    assert.match(reviewContract(spec).join("\n"), new RegExp("non-completion disposition " + disposition));
  }
});

test("contract: amendment C invalidates the prior revision until reconciled", () => {
  const spec = base();
  spec.revision = 2;
  spec.required.push("C");
  assert.match(reviewContract(spec).join("\n"), /stale revision/);
  assert.match(reviewContract(spec).join("\n"), /C: missing row/);
});

test("contract: acceptance constraints count while optional ideas do not", () => {
  const spec = base();
  spec.required.push("NO_WRITE");
  spec.optional = ["NICE_TO_HAVE"];
  assert.match(reviewContract(spec).join("\n"), /NO_WRITE: missing row/);
  assert.doesNotMatch(reviewContract(spec).join("\n"), /NICE_TO_HAVE/);
});

test("contract: a table cannot pass without the current request denominator", () => {
  const spec = base();
  spec.rows = [spec.rows[0]];
  assert.notDeepEqual(reviewContract(spec), []);
});

let passed = 0;
const failures = [];
for (const current of tests) {
  try {
    current.fn();
    passed++;
    console.log("ok   " + current.name);
  } catch (error) {
    failures.push(current.name);
    console.log("FAIL " + current.name + "\n     " + String(error.message).replace(/\n/g, "\n     "));
  }
}
console.log("\n" + passed + "/" + tests.length + " passed");
process.exit(failures.length ? 1 : 0);
