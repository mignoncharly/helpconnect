const requiredWorkflowFragments = Object.freeze([
  ["Pull Request trigger", /^\s{2}pull_request:\s*$/m],
  ["read-only repository permission", /^permissions:\s*\n\s{2}contents: read\s*$/m],
  ["bounded job runtime", /^\s{4}timeout-minutes: 15\s*$/m],
  ["current checkout action", /uses: actions\/checkout@v7/],
  ["disabled checkout credentials", /persist-credentials: false/],
  ["current setup-node action", /uses: actions\/setup-node@v7/],
  ["Node.js 22", /node-version: 22/],
  ["locked dependency install", /run: npm ci\s*$/m],
  ["weight gate validation", /run: npm run weight:validate\s*$/m],
  ["weight pipeline", /run: npm run weight:ci\s*$/m],
  ["report upload on failure", /if: always\(\)/],
  ["current artifact action", /uses: actions\/upload-artifact@v7/],
  ["machine-readable report artifact", /path: reports\/weight-report\.json/]
]);

export const weightCiCommand = "node scripts/build.mjs && node scripts/check-budget.mjs";

export function validateWeightCiPolicy({ workflow, packageJson, buildSource, budgetSource }) {
  const violations = [];
  if (packageJson.scripts?.["weight:ci"] !== weightCiCommand) {
    violations.push("package.json must expose the exact build then budget pipeline");
  }
  if (packageJson.engines?.node !== ">=22.0.0") {
    violations.push("the CI Node major must match the project engine floor");
  }
  for (const [label, pattern] of requiredWorkflowFragments) {
    if (!pattern.test(workflow)) violations.push(`workflow lacks ${label}`);
  }
  if (/pull_request_target\s*:/.test(workflow)) {
    violations.push("pull_request_target is forbidden for the untrusted build gate");
  }
  if ((buildSource.match(/minify:\s*true/g) ?? []).length < 2) {
    violations.push("the public build must minify code and CSS before measurement");
  }
  if (!/compressedSizes\(/.test(budgetSource) || !/weight-report\.json/.test(budgetSource)) {
    violations.push("the budget step must Brotli-compress and write its machine report");
  }
  if (!/assertBudgets\(checks\)/.test(budgetSource)) {
    violations.push("budget comparison must terminate through the hard-failure assertion");
  }
  return violations;
}
