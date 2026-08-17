import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateWeightCiPolicy } from "./weight-ci-policy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), "utf8");
const [workflow, packageSource, buildSource, budgetSource] = await Promise.all([
  readProjectFile(".github/workflows/weight-budget.yml"),
  readProjectFile("package.json"),
  readProjectFile("scripts/build.mjs"),
  readProjectFile("scripts/check-budget.mjs")
]);
const violations = validateWeightCiPolicy({
  workflow,
  packageJson: JSON.parse(packageSource),
  buildSource,
  budgetSource
});

if (violations.length > 0) throw new Error(`Invalid Pull Request weight gate:\n${violations.join("\n")}`);
console.log("Validated Pull Request build, minification, Brotli measurement, and hard budget failure gate");
