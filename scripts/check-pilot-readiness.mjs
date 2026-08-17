import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPilotAdmissionReport } from "./pilot-readiness-policy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dossierPath = process.argv[2];
if (!dossierPath) throw new Error("Usage: npm run pilot:check -- path/to/pilot-admission.json [report-path]");

const reportPath = process.argv[3]
  ? path.resolve(process.argv[3])
  : path.join(projectRoot, "reports", "phase-18-admission-report.json");
const [requirements, dossier] = await Promise.all([
  readFile(path.join(projectRoot, "config", "phase-18-pilot.requirements.json"), "utf8").then(JSON.parse),
  readFile(path.resolve(dossierPath), "utf8").then(JSON.parse)
]);
const report = createPilotAdmissionReport(requirements, dossier);
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (report.decision !== "GO") {
  throw new Error(`Pilot admission remains NO_GO:\n${report.violations.join("\n")}`);
}
console.log(`Pilot admission GO for ${report.pilotId}; machine report: ${reportPath}`);
