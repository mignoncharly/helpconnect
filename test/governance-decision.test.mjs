import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { expectedAttestedRequirementIds, validateGovernanceOverride } from "../scripts/governance-decision-policy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [override, phase17, phase18] = await Promise.all([
  readFile(path.join(projectRoot, "config", "stakeholder-phase-17-18-override.json"), "utf8").then(JSON.parse),
  readFile(path.join(projectRoot, "config", "pilot-security-gate.requirements.json"), "utf8").then(JSON.parse),
  readFile(path.join(projectRoot, "config", "phase-18-pilot.requirements.json"), "utf8").then(JSON.parse)
]);
const now = Date.parse("2026-08-18T12:00:00.000Z");

test("the accountable stakeholder override covers every Phase 17 and 18 requirement", () => {
  assert.deepEqual(validateGovernanceOverride(override, phase17, phase18, now), []);
  assert.equal(override.attested_requirement_ids.length, expectedAttestedRequirementIds(phase17, phase18).length);
});

test("an override cannot conceal missing evidence or broaden its phase scope", () => {
  const candidate = structuredClone(override);
  candidate.attested_requirement_ids.pop();
  candidate.accepted_documentation_gaps = [];
  candidate.scope.push("phase-19");
  const violations = validateGovernanceOverride(candidate, phase17, phase18, now);
  assert.ok(violations.some((value) => value.includes("every Phase 17 and Phase 18 requirement")));
  assert.ok(violations.some((value) => value.includes("documentation gaps")));
  assert.ok(violations.some((value) => value.includes("scope")));
});

test("the governance basis and accountable role cannot be silently weakened", () => {
  const candidate = structuredClone(override);
  candidate.decision_basis = "AUTOMATIC_PASS";
  candidate.authority_role = "developer";
  candidate.evidence_disposition = "VERIFIED";
  assert.ok(validateGovernanceOverride(candidate, phase17, phase18, now).length >= 3);
});
