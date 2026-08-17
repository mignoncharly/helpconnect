import assert from "node:assert/strict";
import test from "node:test";
import { assertBudgets, compressedSizes, evaluateBudgets, sumAssets } from "../scripts/budget-lib.mjs";
import { validateWeightCiPolicy, weightCiCommand } from "../scripts/weight-ci-policy.mjs";
import { readFile } from "node:fs/promises";

const limits = {
  initialBrotliBytes: 200,
  coreOfflineBrotliBytes: 300,
  hardLimitBrotliBytes: 500,
  javascriptBrotliBytes: 80,
  cssBrotliBytes: 30,
  directoryBrotliBytes: 20,
  mapAllBrotliBytes: 40,
  mapSingleBrotliBytes: 20,
  updateAllBrotliBytes: 40,
  updateDeltaSingleBrotliBytes: 5,
  integrityAllBrotliBytes: 20,
  firstAidAllBrotliBytes: 150,
  firstAidSingleBrotliBytes: 50
};

const passingMetrics = {
  initialBrotliBytes: 200,
  coreOfflineBrotliBytes: 300,
  hardLimitBrotliBytes: 500,
  javascriptBrotliBytes: 80,
  cssBrotliBytes: 30,
  directoryBrotliBytes: 20,
  mapAllBrotliBytes: 40,
  mapSingleBrotliBytes: 20,
  updateAllBrotliBytes: 40,
  updateDeltaSingleBrotliBytes: 5,
  integrityAllBrotliBytes: 20,
  firstAidAllBrotliBytes: 150,
  firstAidSingleBrotliBytes: 50
};

test("compressedSizes reports all supported representations", () => {
  const sizes = compressedSizes(Buffer.from("HELP CONNECT ".repeat(100)));
  assert.equal(sizes.rawBytes, 1300);
  assert.ok(sizes.gzipBytes > 0 && sizes.gzipBytes < sizes.rawBytes);
  assert.ok(sizes.brotliBytes > 0 && sizes.brotliBytes < sizes.rawBytes);
});

test("sumAssets counts duplicate names once", () => {
  const assets = [{ name: "app.js", brotliBytes: 12 }];
  assert.equal(sumAssets(assets, ["app.js", "app.js"]), 12);
});

test("sumAssets rejects missing build artifacts", () => {
  assert.throws(() => sumAssets([], ["missing.js"]), /missing asset/);
});

test("budgets pass exactly at every limit", () => {
  const checks = evaluateBudgets(passingMetrics, limits);
  assert.ok(checks.every((check) => check.passed));
  assert.doesNotThrow(() => assertBudgets(checks));
});

for (const metric of Object.keys(passingMetrics)) {
  test(`${metric} fails one byte above its limit`, () => {
    const failingMetrics = { ...passingMetrics, [metric]: passingMetrics[metric] + 1 };
    const failedChecks = evaluateBudgets(failingMetrics, limits).filter((check) => !check.passed);
    assert.equal(failedChecks.length, 1);
  });
}

test("an exceeded budget terminates with an explicit BUILD FAILED error", () => {
  const checks = evaluateBudgets({ ...passingMetrics, javascriptBrotliBytes: 81 }, limits);
  assert.throws(() => assertBudgets(checks), /BUILD FAILED.*javascript 81\/80/);
});

test("the checked-in Pull Request workflow enforces the complete weight pipeline", async () => {
  const [workflow, packageSource, buildSource, budgetSource] = await Promise.all([
    readFile(new URL("../.github/workflows/weight-budget.yml", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../scripts/build.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/check-budget.mjs", import.meta.url), "utf8")
  ]);
  const input = { workflow, packageJson: JSON.parse(packageSource), buildSource, budgetSource };
  assert.deepEqual(validateWeightCiPolicy(input), []);
  assert.ok(workflow.indexOf("npm ci") < workflow.indexOf("npm run weight:ci"));
  assert.equal(input.packageJson.scripts["weight:ci"], weightCiCommand);
  assert.match(workflow, /pull_request:/);
});

test("the CI policy rejects warning-only or privileged workflow drift", () => {
  const violations = validateWeightCiPolicy({
    workflow: "on:\n  pull_request_target:\njobs:\n  weight-budget:\n    timeout-minutes: 15\n",
    packageJson: { engines: { node: ">=22.0.0" }, scripts: { "weight:ci": "npm run build || true" } },
    buildSource: "minify: false",
    budgetSource: "console.warn('over budget')"
  });
  assert.ok(violations.length >= 10);
  assert.ok(violations.some((violation) => violation.includes("pull_request_target")));
  assert.ok(violations.some((violation) => violation.includes("hard-failure")));
});
