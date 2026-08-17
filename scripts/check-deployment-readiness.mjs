import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDeploymentReadinessReport } from "./deployment-readiness-policy.mjs";
import { hashReleaseDirectory } from "./release-hash-lib.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dossierPath = process.argv[2];
if (!dossierPath) throw new Error("Usage: npm run deployment:check -- path/to/deployment-dossier.json [report-path]");
const reportPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(projectRoot, "reports", "phase-19-deployment-report.json");
const [requirements, dossier, publicDigest, operatorDigest] = await Promise.all([
  readFile(path.join(projectRoot, "config", "phase-19-deployment.requirements.json"), "utf8").then(JSON.parse),
  readFile(path.resolve(dossierPath), "utf8").then(JSON.parse),
  hashReleaseDirectory(path.join(projectRoot, "dist")),
  hashReleaseDirectory(path.join(projectRoot, "operator-portal", "dist"))
]);
const report = createDeploymentReadinessReport(requirements, dossier, {
  localDigests: { public: publicDigest, operator: operatorDigest }
});
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
if (report.decision !== "GO") throw new Error(`Production deployment remains NO_GO:\n${report.violations.join("\n")}`);
console.log(`Production deployment GO for ${report.releaseId}; machine report: ${reportPath}`);
