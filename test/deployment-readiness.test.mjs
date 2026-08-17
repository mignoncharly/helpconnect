import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createDeploymentReadinessReport, evaluateDeploymentReadiness, validateDeploymentRequirements } from "../scripts/deployment-readiness-policy.mjs";
import { hashReleaseDirectory } from "../scripts/release-hash-lib.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requirements = JSON.parse(await readFile(path.join(projectRoot, "config", "phase-19-deployment.requirements.json"), "utf8"));
const now = Date.parse("2026-08-18T12:00:00.000Z");
const publicHash = "a".repeat(64);
const operatorHash = "b".repeat(64);
const evidenceHash = "c".repeat(64);
const localDigests = {
  public: { fileCount: 42, sha256: publicHash },
  operator: { fileCount: 3, sha256: operatorHash }
};

function attestations() {
  return requirements.required_evidence.map((id) => ({
    id,
    status: "PASS",
    reviewed_at: "2026-08-17T12:00:00.000Z",
    artifact_sha256: evidenceHash,
    reviewer_role: "independent-reviewer"
  }));
}

function validDossier() {
  return {
    schema_version: 1,
    release_id: "release-2026-08-18",
    generated_at: "2026-08-18T10:00:00.000Z",
    pilot_decision: "GO",
    pilot_report_sha256: evidenceHash,
    origins: {
      public: "https://help.example",
      operator: "https://operators.help.example"
    },
    artifacts: {
      public: { path: "dist", file_count: 42, sha256: publicHash },
      operator: { path: "operator-portal/dist", file_count: 3, sha256: operatorHash }
    },
    evidence: attestations(),
    controls: requirements.required_controls.map((id) => ({ id, status: "PASS", owner_role: "release-safety-lead" })),
    operations: {
      change_window_approved: true,
      backup_verified: true,
      staged_cutover: true,
      rollback_ready: true,
      privacy_preserving_monitoring: true,
      deployment_order: [...requirements.deployment_order],
      rollback_targets: [...requirements.rollback_targets],
      public_methods: [...requirements.public_methods]
    }
  };
}

test("the Phase 19 deployment contract preserves the architecture boundaries", () => {
  assert.deepEqual(validateDeploymentRequirements(requirements), []);
  assert.deepEqual(requirements.public_methods, ["GET", "HEAD"]);
  assert.equal(requirements.prerequisite_pilot_decision, "GO");
});

test("a current dossier bound to the exact release artifacts can reach GO", () => {
  const dossier = validDossier();
  assert.deepEqual(evaluateDeploymentReadiness(requirements, dossier, { now, localDigests }), []);
  assert.equal(createDeploymentReadinessReport(requirements, dossier, { now, localDigests }).decision, "GO");
});

test("pilot NO_GO, shared origins, drifted artifacts and writable public methods fail closed", () => {
  const dossier = validDossier();
  dossier.pilot_decision = "NO_GO";
  dossier.origins.operator = dossier.origins.public;
  dossier.artifacts.public.sha256 = "d".repeat(64);
  dossier.operations.public_methods.push("POST");
  const report = createDeploymentReadinessReport(requirements, dossier, { now, localDigests });
  assert.equal(report.decision, "NO_GO");
  assert.ok(report.violations.some((value) => value.includes("pilot decision")));
  assert.ok(report.violations.some((value) => value.includes("distinct hosts")));
  assert.ok(report.violations.some((value) => value.includes("local build")));
  assert.ok(report.violations.some((value) => value.includes("GET/HEAD")));
});

test("stale evidence, missing rollback and secret-bearing fields are rejected", () => {
  const dossier = validDossier();
  dossier.evidence[0].reviewed_at = "2025-01-01T00:00:00.000Z";
  dossier.operations.rollback_ready = false;
  dossier.controls[0].secret = "forbidden";
  const violations = evaluateDeploymentReadiness(requirements, dossier, { now, localDigests });
  assert.ok(violations.some((value) => value.includes("stale")));
  assert.ok(violations.some((value) => value.includes("rollback_ready")));
  assert.ok(violations.some((value) => value.includes("secret is forbidden")));
  assert.ok(violations.some((value) => value.includes("invalid envelope")));
});

test("release tree hashes are deterministic, path-bound and content-sensitive", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "hc-release-hash-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "nested"));
  await writeFile(path.join(directory, "z.txt"), "same", "utf8");
  await writeFile(path.join(directory, "nested", "a.txt"), "content", "utf8");
  const first = await hashReleaseDirectory(directory);
  const second = await hashReleaseDirectory(directory);
  assert.deepEqual(first, second);
  assert.equal(first.fileCount, 2);
  await writeFile(path.join(directory, "nested", "a.txt"), "changed", "utf8");
  const changed = await hashReleaseDirectory(directory);
  assert.notEqual(changed.sha256, first.sha256);
});
