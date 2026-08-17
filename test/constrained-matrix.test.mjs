import assert from "node:assert/strict";
import test from "node:test";
import {
  constrainedProfile,
  criticalScenario,
  requiredMatrixDimensions,
  validateConstrainedMatrix
} from "../scripts/constrained-matrix.mjs";

test("the constrained matrix covers every Phase 16 condition", () => {
  assert.deepEqual(validateConstrainedMatrix({
    profile: constrainedProfile,
    scenario: criticalScenario,
    dimensions: requiredMatrixDimensions
  }), []);
  assert.equal(requiredMatrixDimensions.length, 14);
});

test("the critical scenario preserves the required eleven-step order", () => {
  assert.deepEqual(criticalScenario, [
    "load",
    "disconnect",
    "close-browser",
    "reopen-offline",
    "search-hospital",
    "open-first-aid",
    "enable-text-mode",
    "restore-very-slow-network",
    "receive-signed-delta",
    "panic-wipe",
    "inspect-all-storage"
  ]);
});

test("weaker device, network, storage, or locale coverage is rejected", () => {
  const weakProfile = {
    ...constrainedProfile,
    cpuThrottlingRate: 2,
    locales: ["fr"],
    network: { ...constrainedProfile.network, downloadThroughput: 50_000, latency: 200 },
    packetDropRatio: 0,
    quotaHeadroomBytes: 1024 * 1024,
    viewport: { ...constrainedProfile.viewport, height: 844, width: 390 }
  };
  const violations = validateConstrainedMatrix({
    profile: weakProfile,
    scenario: [...criticalScenario].reverse(),
    dimensions: requiredMatrixDimensions.filter(({ id }) => id !== "android-low-end")
  });
  assert.ok(violations.length >= 8);
});
