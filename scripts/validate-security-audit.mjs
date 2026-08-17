import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { validateGovernanceOverride } from "./governance-decision-policy.mjs";
import { securityAuditCommand, validateSecurityAuditPolicy } from "./security-audit-policy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readProjectFile = (relativePath) => readFile(path.join(projectRoot, relativePath), "utf8");
const [workflow, packageSource, lockSource, operatorConfig, operatorServer, securityHeaders, requirements, phase18Requirements, overrideSource] = await Promise.all([
  readProjectFile(".github/workflows/security-audit.yml"),
  readProjectFile("package.json"),
  readProjectFile("package-lock.json"),
  readProjectFile("operator-api/src/config-validation.mjs"),
  readProjectFile("operator-api/src/server.mjs"),
  readProjectFile("shared/security-headers.js"),
  readProjectFile("config/pilot-security-gate.requirements.json").then(JSON.parse),
  readProjectFile("config/phase-18-pilot.requirements.json").then(JSON.parse),
  readProjectFile("config/stakeholder-phase-17-18-override.json")
]);
const governanceOverride = JSON.parse(overrideSource);

const scanRoots = ["config", "public", "operator-api/config"];
const secretScan = {};
for (const root of scanRoots) {
  for (const relativePath of await listFiles(path.join(projectRoot, root), root)) {
    if (/\.(?:json|html|js|mjs|txt)$/i.test(relativePath)) secretScan[relativePath] = await readProjectFile(relativePath);
  }
}
const candidateFiles = await listCandidateFiles(projectRoot);
const violations = validateSecurityAuditPolicy({
  workflow,
  packageJson: JSON.parse(packageSource),
  lockfile: JSON.parse(lockSource),
  sources: { operatorConfig, operatorServer, securityHeaders, secretScan },
  candidateFiles
});
if (violations.length > 0) throw new Error(`Security audit gate failed:\n${violations.join("\n")}`);

if (requirements.schema_version !== 1 || requirements.decision_when_evidence_missing !== "NO_GO" || !Array.isArray(requirements.required_external_evidence) || requirements.required_external_evidence.length !== 6) throw new Error("Invalid pilot security requirements");
const governanceViolations = validateGovernanceOverride(governanceOverride, requirements, phase18Requirements);
if (governanceViolations.length > 0) throw new Error(`Stakeholder governance override failed:\n${governanceViolations.join("\n")}`);
const overrideSha256 = createHash("sha256").update(overrideSource, "utf8").digest("hex");
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  methodology: ["OWASP ASVS 5.0.0", "OWASP WSTG 4.2"],
  localControls: [
    { id: "frontend-build-policy", status: "PASS" },
    { id: "operator-origin-and-webauthn-binding", status: "PASS" },
    { id: "operator-authentication-authorization-replay", status: "PASS" },
    { id: "audit-and-revocation-journal-validation", status: "PASS" },
    { id: "dependency-lock-and-secret-inventory", status: "PASS" },
    { id: "security-ci-policy", status: "PASS" }
  ],
  dependencyAudit: { command: "npm audit --audit-level=low", execution: "separate-required-gate" },
  externalEvidence: requirements.required_external_evidence.map((item) => ({ ...item, status: "STAKEHOLDER_ATTESTED_NOT_WORKSPACE_VERIFIED" })),
  pilotDecision: governanceOverride.decision,
  decisionBasis: governanceOverride.decision_basis,
  authorityRole: governanceOverride.authority_role,
  decidedAt: governanceOverride.decided_at,
  overrideSha256,
  evidenceDisposition: governanceOverride.evidence_disposition,
  documentationGaps: governanceOverride.accepted_documentation_gaps,
  reason: "The accountable stakeholder attests completion and accepts the disclosed absence of independently verifiable artifacts in this workspace",
  command: securityAuditCommand
};
await writeFile(path.join(projectRoot, "reports", "security-audit-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Local security audit controls passed; effective pilot decision ${report.pilotDecision} by ${report.decisionBasis}`);

async function listFiles(directory, relativeRoot) {
  const entries = await readdir(directory, { withFileTypes: true });
  const values = await Promise.all(entries.map(async (entry) => {
    const relativePath = `${relativeRoot}/${entry.name}`.replace(/\\/g, "/");
    return entry.isDirectory() ? listFiles(path.join(directory, entry.name), relativePath) : [relativePath];
  }));
  return values.flat();
}

async function listCandidateFiles(directory, relativeRoot = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  const ignored = new Set([".git", "dist", "node_modules", "reports"]);
  const values = await Promise.all(entries.map(async (entry) => {
    if (entry.isDirectory() && (ignored.has(entry.name) || (relativeRoot === "operator-portal" && entry.name === "dist"))) return [];
    const relativePath = relativeRoot ? `${relativeRoot}/${entry.name}` : entry.name;
    return entry.isDirectory() ? listCandidateFiles(path.join(directory, entry.name), relativePath) : [relativePath];
  }));
  return values.flat();
}
