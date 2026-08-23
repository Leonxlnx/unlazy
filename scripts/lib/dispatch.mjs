// Atomic host-dispatch wave state. Zero dependencies. Node 16+.

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  appendStatus, scopeRoot, validateScopeId, withFileLock, writeAtomic,
} from "./gates.mjs";

const SCHEMA = 1;
const STATES = new Set(["open", "sealed", "complete"]);
const CONTROL = /[\u0000-\u001f\u007f]/;

const emptyState = () => ({ schema: SCHEMA, waves: {} });
const count = (record) => Object.keys(record).length;

function fail(message) { throw new Error(message); }

function validId(value, label) {
  const error = validateScopeId(value, label);
  if (error) fail(error);
  return String(value);
}

function validHandle(value) {
  const handle = String(value || "").trim();
  if (!handle || handle.length > 256 || CONTROL.test(handle)) {
    fail("handle must be printable, nonblank, and at most 256 characters");
  }
  return handle;
}

function validTime(value, label) {
  if (typeof value !== "string" || !value || Number.isNaN(Date.parse(value))) {
    fail(label + " must be an ISO timestamp");
  }
}

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state) || state.schema !== SCHEMA ||
      !state.waves || typeof state.waves !== "object" || Array.isArray(state.waves)) {
    fail("expected schema 1 with a waves object");
  }

  for (const [waveId, wave] of Object.entries(state.waves)) {
    validId(waveId, "wave");
    if (!wave || typeof wave !== "object" || Array.isArray(wave) || !STATES.has(wave.state) ||
        !Array.isArray(wave.leaves) || !wave.leaves.length ||
        !wave.started || typeof wave.started !== "object" || Array.isArray(wave.started) ||
        !wave.returned || typeof wave.returned !== "object" || Array.isArray(wave.returned)) {
      fail("wave " + waveId + " has an invalid shape");
    }
    validTime(wave.openedAt, "wave " + waveId + " openedAt");
    const leaves = new Set();
    for (const leaf of wave.leaves) {
      const id = validId(leaf, "leaf");
      if (leaves.has(id)) fail("wave " + waveId + " has duplicate leaf " + id);
      leaves.add(id);
    }

    const handles = new Set();
    for (const [leaf, start] of Object.entries(wave.started)) {
      if (!leaves.has(leaf)) fail("wave " + waveId + " started unknown leaf " + leaf);
      if (!start || typeof start !== "object" || Array.isArray(start)) fail("wave " + waveId + " has invalid start for " + leaf);
      const handle = validHandle(start.handle);
      if (handles.has(handle)) fail("wave " + waveId + " reuses handle " + handle);
      handles.add(handle);
      validTime(start.at, "wave " + waveId + " start time for " + leaf);
    }

    for (const [leaf, returned] of Object.entries(wave.returned)) {
      if (!leaves.has(leaf) || !wave.started[leaf]) fail("wave " + waveId + " returned unstarted leaf " + leaf);
      if (!returned || typeof returned !== "object" || Array.isArray(returned)) fail("wave " + waveId + " has invalid return for " + leaf);
      validTime(returned.at, "wave " + waveId + " return time for " + leaf);
    }

    const allStarted = count(wave.started) === wave.leaves.length;
    const allReturned = count(wave.returned) === wave.leaves.length;
    if (wave.state === "open" && count(wave.returned)) fail("open wave " + waveId + " contains returns");
    if (wave.state !== "open" && !allStarted) fail(wave.state + " wave " + waveId + " is missing starts");
    if (wave.state === "complete" && !allReturned) fail("complete wave " + waveId + " is missing returns");
    if (wave.state === "sealed" && allReturned) fail("sealed wave " + waveId + " should be complete");
  }
  return state;
}

function readState(path) {
  if (!existsSync(path)) return emptyState();
  try {
    if (lstatSync(path).isSymbolicLink()) fail("refusing dispatch state symlink");
    return validateState(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (String(error.message).startsWith("invalid dispatch state:")) throw error;
    throw new Error("invalid dispatch state: " + error.message);
  }
}

export function dispatchStatePath(root, scope) {
  return join(scopeRoot(resolve(root), validId(scope, "scope")), "dispatch.json");
}

export function getDispatchWave(root, scope, waveId) {
  const wave = validId(waveId, "wave");
  const state = readState(dispatchStatePath(root, scope));
  if (!state.waves[wave]) fail("unknown wave " + wave);
  return state.waves[wave];
}

export function dispatchIssues(root, scope) {
  if (!scope) return [];
  let state;
  try { state = readState(dispatchStatePath(root, scope)); }
  catch (error) { return ["dispatch:PARSE " + error.message]; }
  return Object.entries(state.waves).sort(([left], [right]) => left.localeCompare(right)).flatMap(([id, wave]) => {
    if (wave.state === "complete") return [];
    if (wave.state === "open") return ["dispatch:" + id + " open (" + count(wave.started) + "/" + wave.leaves.length + " started)"];
    return ["dispatch:" + id + " sealed (" + count(wave.returned) + "/" + wave.leaves.length + " returned)"];
  });
}

export async function updateDispatch(root, spec) {
  const scope = validId(spec.scope, "scope");
  const waveId = validId(spec.wave, "wave");
  const path = dispatchStatePath(root, scope);
  let event = "";

  const wave = await withFileLock(root, path, () => {
    const state = readState(path);
    const now = spec.now || new Date().toISOString();
    validTime(now, "timestamp");

    if (spec.action === "open") {
      if (state.waves[waveId]) fail("wave " + waveId + " already exists");
      const leaves = (spec.leaves || []).map((leaf) => validId(leaf, "leaf"));
      if (!leaves.length) fail("open requires at least one --leaf");
      const seen = new Set();
      for (const leaf of leaves) {
        if (seen.has(leaf)) fail("duplicate leaf " + leaf);
        seen.add(leaf);
      }
      state.waves[waveId] = { leaves, state: "open", openedAt: now, started: {}, returned: {} };
      event = "dispatch " + waveId + " opened: " + leaves.join(", ");
    } else {
      const current = state.waves[waveId];
      if (!current) fail("unknown wave " + waveId);
      if (spec.action === "start") {
        const leaf = validId(spec.leaf, "leaf");
        const handle = validHandle(spec.handle);
        if (current.state !== "open") fail("wave " + waveId + " is " + current.state + "; start requires an open wave");
        if (!current.leaves.includes(leaf)) fail("unknown leaf " + leaf + " in wave " + waveId);
        if (current.started[leaf]) fail("leaf " + leaf + " already started");
        const owner = Object.entries(current.started).find(([, start]) => start.handle === handle);
        if (owner) fail("handle is already assigned to " + owner[0]);
        current.started[leaf] = { handle, at: now };
        event = "dispatch " + waveId + " started " + leaf + " as " + handle;
      } else if (spec.action === "seal") {
        if (current.state !== "open") fail("wave " + waveId + " is " + current.state + "; seal requires an open wave");
        const missing = current.leaves.filter((leaf) => !current.started[leaf]);
        if (missing.length) fail("cannot seal " + waveId + ": missing starts for " + missing.join(", "));
        current.state = "sealed";
        current.sealedAt = now;
        event = "dispatch " + waveId + " sealed";
      } else if (spec.action === "return") {
        const leaf = validId(spec.leaf, "leaf");
        if (current.state === "open") fail("return requires a sealed wave; " + waveId + " is open");
        if (!current.leaves.includes(leaf)) fail("unknown leaf " + leaf + " in wave " + waveId);
        if (current.returned[leaf]) fail("leaf " + leaf + " already returned");
        current.returned[leaf] = { at: now };
        if (count(current.returned) === current.leaves.length) {
          current.state = "complete";
          current.completedAt = now;
        }
        event = "dispatch " + waveId + " returned " + leaf;
      } else fail("unknown dispatch action " + spec.action);
    }

    validateState(state);
    writeAtomic(path, JSON.stringify(state, null, 2) + "\n", { root });
    return state.waves[waveId];
  });

  appendStatus(root, scope, new Date().toISOString() + " " + event);
  return wave;
}
