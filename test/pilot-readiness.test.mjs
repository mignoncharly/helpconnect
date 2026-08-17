import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createPilotAdmissionReport, evaluatePilotAdmission, validatePilotRequirements } from "../scripts/pilot-readiness-policy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requirements = JSON.parse(await readFile(path.join(projectRoot, "config", "phase-18-pilot.requirements.json"), "utf8"));
const now = Date.parse("2026-08-17T12:00:00.000Z");
const hash = "a".repeat(64);

function attestations(ids) {
  return ids.map((id) => ({
    id,
    status: "PASS",
    reviewed_at: "2026-08-16T12:00:00.000Z",
    artifact_sha256: hash,
    reviewer_role: "independent-reviewer"
  }));
}

function validDossier() {
  return {
    schema_version: 1,
    pilot_id: "pilot-north-01",
    generated_at: "2026-08-17T10:00:00.000Z",
    build_sha256: hash,
    security_decision: "GO",
    external_evidence: attestations(requirements.required_security_evidence),
    scope: {
      region_ids: ["north-01"],
      point_count: 20,
      categories: ["water", "hospital", "food"],
      operator_count: 2,
      participant_count: 5
    },
    human_reviews: attestations(requirements.required_human_reviews),
    operational_drills: attestations(requirements.required_operational_drills),
    measurement: {
      consent_script_approved: true,
      in_app_telemetry: false,
      individual_tracking: false,
      persistent_participant_ids: false,
      free_text_collection: false,
      metrics: [...requirements.required_metrics]
    },
    stop_conditions: requirements.required_stop_conditions.map((id) => ({ id, armed: true, owner_role: "pilot-safety-lead" }))
  };
}

test("the Phase 18 requirement contract is strict and reduced", () => {
  assert.deepEqual(validatePilotRequirements(requirements), []);
  assert.equal(requirements.scope.region_count, 1);
  assert.deepEqual(requirements.scope.point_count, { minimum: 20, maximum: 50 });
  assert.deepEqual(requirements.scope.category_count, { minimum: 3, maximum: 5 });
});

test("a complete, current and privacy-preserving admission dossier can reach GO", () => {
  const dossier = validDossier();
  assert.deepEqual(evaluatePilotAdmission(requirements, dossier, now), []);
  assert.equal(createPilotAdmissionReport(requirements, dossier, now).decision, "GO");
});

test("missing external proof, oversized scope and telemetry remain NO_GO", () => {
  const dossier = validDossier();
  dossier.security_decision = "NO_GO";
  dossier.external_evidence.pop();
  dossier.scope.point_count = 51;
  dossier.scope.region_ids.push("south-01");
  dossier.measurement.in_app_telemetry = true;
  const report = createPilotAdmissionReport(requirements, dossier, now);
  assert.equal(report.decision, "NO_GO");
  assert.ok(report.violations.some((value) => value.includes("security decision")));
  assert.ok(report.violations.some((value) => value.includes("external_evidence")));
  assert.ok(report.violations.some((value) => value.includes("point_count")));
  assert.ok(report.violations.some((value) => value.includes("one safe region")));
  assert.ok(report.violations.some((value) => value.includes("in_app_telemetry")));
});

test("stale or self-unbound attestations and personal-data fields are rejected", () => {
  const dossier = validDossier();
  dossier.external_evidence[0].reviewed_at = "2025-01-01T00:00:00.000Z";
  dossier.external_evidence[1].artifact_sha256 = "not-a-hash";
  dossier.external_evidence[2].participant_id = "person-1";
  const violations = evaluatePilotAdmission(requirements, dossier, now);
  assert.ok(violations.some((value) => value.includes("stale")));
  assert.ok(violations.some((value) => value.includes("SHA-256")));
  assert.ok(violations.some((value) => value.includes("participant_id is forbidden")));
  assert.ok(violations.some((value) => value.includes("invalid attestation envelope")));
});
