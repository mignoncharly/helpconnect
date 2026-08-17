import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createNetworkAdaptationController,
  networkAdaptationPolicy,
  runAdaptiveRequest
} from "../shared/network-adaptation.js";

function pendingUntilAbort(signal) {
  return new Promise((resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}

test("request failures degrade automatic mode from normal to low and then text", () => {
  const changes = [];
  const controller = createNetworkAdaptationController((state) => changes.push(state));

  assert.equal(controller.getState().mode, "normal");
  assert.equal(controller.recordFailure("first-timeout").mode, "low");
  assert.equal(controller.recordFailure("retry-timeout").mode, "text");
  assert.deepEqual(changes.map(({ mode, reason }) => [mode, reason]), [
    ["low", "first-timeout"],
    ["text", "retry-timeout"]
  ]);
});

test("three fast useful requests are required for each automatic recovery step", () => {
  const controller = createNetworkAdaptationController();
  controller.recordFailure();
  controller.recordFailure();

  for (let index = 0; index < networkAdaptationPolicy.recoverySuccesses - 1; index += 1) {
    assert.equal(controller.recordSuccess(25).mode, "text");
  }
  assert.equal(controller.recordSuccess(25).mode, "low");
  for (let index = 0; index < networkAdaptationPolicy.recoverySuccesses - 1; index += 1) {
    assert.equal(controller.recordSuccess(25).mode, "low");
  }
  assert.equal(controller.recordSuccess(25).mode, "normal");
});

test("manual mode remains authoritative while automatic health continues to update", () => {
  const controller = createNetworkAdaptationController();
  assert.equal(controller.setManualMode("normal").source, "manual");
  controller.recordFailure();
  const state = controller.recordFailure();
  assert.equal(state.automaticMode, "text");
  assert.equal(state.mode, "normal");
  assert.equal(state.source, "manual");
  assert.equal(controller.clearManualMode().mode, "text");
});

test("an initial timeout performs exactly one minimal retry", async () => {
  const controller = createNetworkAdaptationController();
  const attempts = [];
  const result = await runAdaptiveRequest((signal, attemptNumber) => {
    attempts.push(attemptNumber);
    return attemptNumber === 1 ? pendingUntilAbort(signal) : Promise.resolve("verified-data");
  }, controller, { initialTimeoutMs: 5, retryTimeoutMs: 50 });

  assert.equal(result, "verified-data");
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(controller.getState().automaticMode, "low");
});

test("a failed retry switches to text mode without a third attempt", async () => {
  const controller = createNetworkAdaptationController();
  let attempts = 0;
  await assert.rejects(runAdaptiveRequest((signal) => {
    attempts += 1;
    return pendingUntilAbort(signal);
  }, controller, { initialTimeoutMs: 5, retryTimeoutMs: 5 }), /timed out/i);

  assert.equal(attempts, 2);
  assert.equal(controller.getState().automaticMode, "text");
});

test("panic cancellation is not mistaken for network degradation", async () => {
  const parent = new AbortController();
  parent.abort(new DOMException("Panic Wipe", "AbortError"));
  const controller = createNetworkAdaptationController();
  let attempts = 0;

  await assert.rejects(runAdaptiveRequest(async () => {
    attempts += 1;
    return "unexpected";
  }, controller, { parentSignal: parent.signal }), /Panic Wipe/);
  assert.equal(attempts, 0);
  assert.equal(controller.getState().mode, "normal");
});

test("network adaptation does not probe navigator connectivity or run a speed test", async () => {
  const [moduleSource, applicationSource] = await Promise.all([
    readFile(new URL("../shared/network-adaptation.js", import.meta.url), "utf8"),
    readFile(new URL("../src/app.ts", import.meta.url), "utf8")
  ]);
  const source = `${moduleSource}\n${applicationSource}`;
  assert.doesNotMatch(source, /navigator\.(?:connection|onLine)/);
  assert.doesNotMatch(source, /speed[ -]?test/i);
});
