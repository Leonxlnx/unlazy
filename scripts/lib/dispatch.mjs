// Atomic host-dispatch wave state. Zero dependencies. Node 16+.

import { existsSync, lstatSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  appendStatus, scopeRoot, validateScopeId, withFileLock, writeAtomic,
} from "./gates.mjs";

const SCHEMA = 1;
const STATES = new Set(["open", "sealed", "complete", "abandoned"]);
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/;
const CONTROL_GLOBAL = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

const record = (value = {}) => Object.assign(Object.create(null), value);
const emptyState = () => ({ schema: SCHEMA, waves: record() });
const count = (record) => Object.keys(record).length;

function fail(message) { throw new Error(message); }
const safeDiagnostic = (value) => String(value).replace(CONTROL_GLOBAL, " ").replace(/\s+/g, " ").trim().slice(0, 500);

function validId(value, label) {
  if (typeof value !== "string") fail(label + " must be a string");
  const error = validateScopeId(value, label);
  if (error) fail(error);
  return value;
}

function validHandle(value) {
  if (typeof value !== "string") fail("handle must be a string");
  const handle = value.trim();
  if (!handle || handle.length > 256 || CONTROL.test(handle)) {
    fail("handle must be printable, nonblank, and at most 256 characters");
  }
  return handle;
}

function validReason(value) {
  if (typeof value !== "string") fail("reason must be a string");
  const reason = value.trim();
  if (!reason || reason.length > 500 || CONTROL.test(reason)) {
    fail("reason must be printable, nonblank, and at most 500 characters");
  }
  return reason;
}

function validTime(value, label) {
  if (typeof value !== "string" || !value || Number.isNaN(Date.parse(value))) {
    fail(label + " must be an ISO timestamp");
  }
  return Date.parse(value);
}

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function validateState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state) || state.schema !== SCHEMA ||
      !state.waves || typeof state.waves !== "object" || Array.isArray(state.waves)) {
    fail("expected schema 1 with a waves object");
  }
  state.waves = record(state.waves);

  for (const [waveId, wave] of Object.entries(state.waves)) {
    validId(waveId, "wave");
    if (!wave || typeof wave !== "object" || Array.isArray(wave) || !STATES.has(wave.state) ||
        !Array.isArray(wave.leaves) || !wave.leaves.length ||
        !wave.started || typeof wave.started !== "object" || Array.isArray(wave.started) ||
        !wave.returned || typeof wave.returned !== "object" || Array.isArray(wave.returned)) {
      fail("wave " + waveId + " has an invalid shape");
    }
    wave.started = record(wave.started);
    wave.returned = record(wave.returned);
    const openedAt = validTime(wave.openedAt, "wave " + waveId + " openedAt");
    let abandonedAt = null;
    if (wave.state === "abandoned") {
      abandonedAt = validTime(wave.abandonedAt, "wave " + waveId + " abandonedAt");
      wave.reason = validReason(wave.reason);
    } else if (hasOwn(wave, "abandonedAt") || hasOwn(wave, "reason")) {
      fail(wave.state + " wave " + waveId + " contains abandonment metadata");
    }
    const leaves = new Set();
    for (const leaf of wave.leaves) {
      const id = validId(leaf, "leaf");
      if (leaves.has(id)) fail("wave " + waveId + " has duplicate leaf " + id);
      leaves.add(id);
    }

    const handles = new Set();
    const startTimes = record();
    let latestStart = openedAt;
    for (const [leaf, start] of Object.entries(wave.started)) {
      if (!leaves.has(leaf)) fail("wave " + waveId + " started unknown leaf " + leaf);
      if (!start || typeof start !== "object" || Array.isArray(start)) fail("wave " + waveId + " has invalid start for " + leaf);
      const handle = validHandle(start.handle);
      if (handles.has(handle)) fail("wave " + waveId + " reuses handle " + handle);
      handles.add(handle);
      const at = validTime(start.at, "wave " + waveId + " start time for " + leaf);
      if (at < openedAt) fail("wave " + waveId + " starts " + leaf + " before it opened");
      startTimes[leaf] = at;
      latestStart = Math.max(latestStart, at);
    }

    const returnTimes = [];
    for (const [leaf, returned] of Object.entries(wave.returned)) {
      if (!leaves.has(leaf) || !wave.started[leaf]) fail("wave " + waveId + " returned unstarted leaf " + leaf);
      if (!returned || typeof returned !== "object" || Array.isArray(returned)) fail("wave " + waveId + " has invalid return for " + leaf);
      const at = validTime(returned.at, "wave " + waveId + " return time for " + leaf);
      if (at < startTimes[leaf]) fail("wave " + waveId + " returns " + leaf + " before it started");
      returnTimes.push(at);
    }

    const allStarted = count(wave.started) === wave.leaves.length;
    const allReturned = count(wave.returned) === wave.leaves.length;
    if (wave.state === "open" && count(wave.returned)) fail("open wave " + waveId + " contains returns");
    if (wave.state !== "open" && wave.state !== "abandoned" && !allStarted) {
      fail(wave.state + " wave " + waveId + " is missing starts");
    }
    if (wave.state === "complete" && !allReturned) fail("complete wave " + waveId + " is missing returns");
    if (wave.state === "sealed" && allReturned) fail("sealed wave " + waveId + " should be complete");

    const needsSeal = wave.state === "sealed" || wave.state === "complete" ||
      (wave.state === "abandoned" && hasOwn(wave, "sealedAt"));
    let sealedAt = null;
    if (needsSeal) {
      sealedAt = validTime(wave.sealedAt, "wave " + waveId + " sealedAt");
      if (!allStarted) fail(wave.state + " wave " + waveId + " is missing starts after sealing");
      if (sealedAt < latestStart) fail("wave " + waveId + " was sealed before its final start");
    } else if (hasOwn(wave, "sealedAt")) {
      fail(wave.state + " wave " + waveId + " contains seal metadata");
    }

    if (returnTimes.length) {
      if (sealedAt === null) fail(wave.state + " wave " + waveId + " contains returns without being sealed");
      if (returnTimes.some((at) => at < sealedAt)) fail("wave " + waveId + " contains a return before sealing");
    }

    if (wave.state === "complete") {
      const completedAt = validTime(wave.completedAt, "wave " + waveId + " completedAt");
      if (completedAt < Math.max(sealedAt, ...returnTimes)) {
        fail("wave " + waveId + " completed before its final return");
      }
    } else if (hasOwn(wave, "completedAt")) {
      fail(wave.state + " wave " + waveId + " contains completion metadata");
    }

    if (wave.state === "abandoned") {
      if (allReturned) fail("abandoned wave " + waveId + " already has every return and must be complete");
      if (abandonedAt < Math.max(openedAt, latestStart, sealedAt || openedAt, ...returnTimes)) {
        fail("wave " + waveId + " was abandoned before its latest transition");
      }
    }
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
  return dispatchStatus(root, scope).blocking;
}

export function dispatchStatus(root, scope) {
  if (!scope) return { blocking: [], abandoned: [], resolved: [], errors: [] };
  let state;
  try { state = readState(dispatchStatePath(root, scope)); }
  catch (error) {
    const message = safeDiagnostic(error.message);
    return {
      blocking: ["dispatch:PARSE invalid dispatch state"],
      abandoned: [],
      resolved: ["dispatch:PARSE=invalid"],
      errors: ["invalid dispatch state for scope " + scope + ": " + message],
    };
  }
  const result = { blocking: [], abandoned: [], resolved: [], errors: [] };
  for (const [id, wave] of Object.entries(state.waves).sort(([left], [right]) => left.localeCompare(right))) {
    const started = count(wave.started);
    const returned = count(wave.returned);
    result.resolved.push("dispatch:" + id + "=" + wave.state + ";started=" + started + "/" +
      wave.leaves.length + ";returned=" + returned + "/" + wave.leaves.length);
    if (wave.state === "complete") continue;
    if (wave.state === "abandoned") {
      result.abandoned.push("dispatch:" + id);
    } else if (wave.state === "open") {
      result.blocking.push("dispatch:" + id + " open (" + started + "/" + wave.leaves.length + " started)");
    } else {
      result.blocking.push("dispatch:" + id + " sealed (" + returned + "/" + wave.leaves.length + " returned)");
    }
  }
  return result;
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
      state.waves[waveId] = { leaves, state: "open", openedAt: now, started: record(), returned: record() };
      event = "dispatch " + waveId + " opened: " + leaves.join(", ");
    } else {
      const current = state.waves[waveId];
      if (!current) fail("unknown wave " + waveId);
      if (spec.action === "abandon") {
        if (current.state === "complete" || current.state === "abandoned") {
          fail("wave " + waveId + " is " + current.state + "; abandon requires an open or sealed wave");
        }
        current.state = "abandoned";
        current.reason = validReason(spec.reason);
        current.abandonedAt = now;
        event = "dispatch " + waveId + " abandoned: " + current.reason;
      } else if (spec.action === "start") {
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
        if (current.state !== "sealed") fail("return requires a sealed wave; " + waveId + " is " + current.state);
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

  await appendStatus(root, scope, new Date().toISOString() + " " + event);
  return wave;
}
