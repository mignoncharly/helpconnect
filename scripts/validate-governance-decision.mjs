import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateGovernanceOverride } from "./governance-decision-policy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [overrideSource, phase17Requirements, phase18Requirements] = await Promise.all([
  readFile(path.join(projectRoot, "config", "stakeholder-phase-17-18-override.json"), "utf8"),
  readFile(path.join(projectRoot, "config", "pilot-security-gate.requirements.json"), "utf8").then(JSON.parse),
  readFile(path.join(projectRoot, "config", "phase-18-pilot.requirements.json"), "utf8").then(JSON.parse)
]);
const override = JSON.parse(overrideSource);
const violations = validateGovernanceOverride(override, phase17Requirements, phase18Requirements);
if (violations.length > 0) throw new Error(`Stakeholder governance override failed:\n${violations.join("\n")}`);
const overrideSha256 = createHash("sha256").update(overrideSource, "utf8").digest("hex");
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  phase: 18,
  decision: "GO",
  decisionBasis: override.decision_basis,
  authorityRole: override.authority_role,
  decidedAt: override.decided_at,
  overrideSha256,
  evidenceDisposition: override.evidence_disposition,
  documentationGaps: override.accepted_documentation_gaps,
  pilotExecution: "ATTESTED_COMPLETE_BY_STAKEHOLDER",
  violations: []
};
await mkdir(path.join(projectRoot, "reports"), { recursive: true });
await writeFile(path.join(projectRoot, "reports", "phase-18-admission-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Phase 18 effective decision GO by stakeholder override ${overrideSha256}`);
