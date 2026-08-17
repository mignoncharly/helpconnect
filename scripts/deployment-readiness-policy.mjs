const requirementKeys = Object.freeze([
  "deployment_order",
  "dossier_max_age_days",
  "evidence_max_age_days",
  "prerequisite_pilot_decision",
  "public_methods",
  "required_controls",
  "required_evidence",
  "rollback_targets",
  "schema_version"
]);
const dossierKeys = Object.freeze([
  "artifacts",
  "controls",
  "evidence",
  "generated_at",
  "operations",
  "origins",
  "pilot_decision",
  "pilot_report_sha256",
  "release_id",
  "schema_version"
]);
const forbiddenKeys = Object.freeze(new Set([
  "access_token",
  "api_key",
  "cookie",
  "email",
  "name",
  "password",
  "phone",
  "private_key",
  "secret",
  "session",
  "username"
]));
const idPattern = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])?$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isUniqueSafeIdList(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && idPattern.test(item)) && new Set(value).size === value.length;
}

function sameMembers(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && new Set(actual).size === actual.length && expected.every((value) => actual.includes(value));
}

function ageDays(value, now) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? (now - timestamp) / (24 * 60 * 60 * 1000) : Number.NaN;
}

function cleanHttpsOrigin(value) {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.origin !== value) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

function findForbiddenKeys(value, location = "dossier", violations = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenKeys(item, `${location}[${index}]`, violations));
    return violations;
  }
  if (!isRecord(value)) return violations;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenKeys.has(key.toLowerCase())) violations.push(`${location}.${key} is forbidden in a deployment dossier`);
    findForbiddenKeys(nested, `${location}.${key}`, violations);
  }
  return violations;
}

function validateAttestations(values, expectedIds, maximumAgeDays, now, violations) {
  if (!Array.isArray(values) || values.length !== expectedIds.length) {
    violations.push("evidence must contain every required attestation exactly once");
    return;
  }
  const ids = [];
  for (const value of values) {
    if (!hasExactKeys(value, ["artifact_sha256", "id", "reviewed_at", "reviewer_role", "status"])) {
      violations.push("evidence contains an invalid attestation envelope");
      continue;
    }
    ids.push(value.id);
    if (!expectedIds.includes(value.id)) violations.push(`evidence contains an unknown id: ${value.id}`);
    if (value.status !== "PASS") violations.push(`evidence ${value.id} is not PASS`);
    if (!sha256Pattern.test(value.artifact_sha256)) violations.push(`evidence ${value.id} lacks a SHA-256 binding`);
    if (typeof value.reviewer_role !== "string" || !idPattern.test(value.reviewer_role)) violations.push(`evidence ${value.id} has an invalid reviewer role`);
    const age = ageDays(value.reviewed_at, now);
    if (!Number.isFinite(age) || age < 0 || age > maximumAgeDays) violations.push(`evidence ${value.id} is missing, future-dated, or stale`);
  }
  if (!sameMembers(ids, expectedIds)) violations.push("evidence ids do not match the deployment contract");
}

export function validateDeploymentRequirements(requirements) {
  const violations = [];
  if (!hasExactKeys(requirements, requirementKeys)) return ["deployment requirements have an invalid field contract"];
  if (requirements.schema_version !== 1 || requirements.prerequisite_pilot_decision !== "GO") violations.push("invalid deployment requirement version or pilot prerequisite");
  for (const key of ["dossier_max_age_days", "evidence_max_age_days"]) if (!Number.isSafeInteger(requirements[key]) || requirements[key] < 1 || requirements[key] > 365) violations.push(`${key} must be between 1 and 365`);
  for (const key of ["required_evidence", "required_controls", "deployment_order", "rollback_targets"]) if (!isUniqueSafeIdList(requirements[key])) violations.push(`${key} must contain unique safe ids`);
  if (!Array.isArray(requirements.public_methods) || requirements.public_methods.join(",") !== "GET,HEAD") violations.push("the public deployment boundary must be GET/HEAD only");
  return violations;
}

export function evaluateDeploymentReadiness(requirements, dossier, options = {}) {
  const now = options.now ?? Date.now();
  const localDigests = options.localDigests;
  const requirementViolations = validateDeploymentRequirements(requirements);
  if (requirementViolations.length > 0) return requirementViolations;
  const violations = findForbiddenKeys(dossier);
  if (!hasExactKeys(dossier, dossierKeys)) return [...violations, "deployment dossier has an invalid field contract"];
  if (dossier.schema_version !== 1) violations.push("deployment dossier schema version must be 1");
  if (typeof dossier.release_id !== "string" || !idPattern.test(dossier.release_id)) violations.push("release_id must be a safe non-identifying id");
  if (dossier.pilot_decision !== requirements.prerequisite_pilot_decision) violations.push("Phase 18 pilot decision is not GO");
  if (!sha256Pattern.test(dossier.pilot_report_sha256)) violations.push("pilot_report_sha256 must bind the approved Phase 18 result");
  const dossierAge = ageDays(dossier.generated_at, now);
  if (!Number.isFinite(dossierAge) || dossierAge < 0 || dossierAge > requirements.dossier_max_age_days) violations.push("deployment dossier is missing, future-dated, or stale");

  if (!hasExactKeys(dossier.origins, ["operator", "public"])) {
    violations.push("deployment origins have an invalid field contract");
  } else {
    const publicOrigin = cleanHttpsOrigin(dossier.origins.public);
    const operatorOrigin = cleanHttpsOrigin(dossier.origins.operator);
    if (!publicOrigin) violations.push("public origin must be a canonical HTTPS root origin");
    if (!operatorOrigin) violations.push("operator origin must be a canonical HTTPS root origin");
    if (publicOrigin && operatorOrigin && (publicOrigin.origin === operatorOrigin.origin || publicOrigin.hostname === operatorOrigin.hostname)) violations.push("public and operator origins must use distinct hosts");
  }

  if (!hasExactKeys(dossier.artifacts, ["operator", "public"])) {
    violations.push("release artifacts have an invalid field contract");
  } else {
    const artifactContracts = [["public", "dist"], ["operator", "operator-portal/dist"]];
    for (const [id, expectedPath] of artifactContracts) {
      const artifact = dossier.artifacts[id];
      if (!hasExactKeys(artifact, ["file_count", "path", "sha256"]) || artifact.path !== expectedPath || !Number.isSafeInteger(artifact.file_count) || artifact.file_count < 1 || !sha256Pattern.test(artifact.sha256)) {
        violations.push(`${id} release artifact is invalid`);
        continue;
      }
      const local = localDigests?.[id];
      if (!local || local.sha256 !== artifact.sha256 || local.fileCount !== artifact.file_count) violations.push(`${id} release artifact does not match the local build`);
    }
  }

  validateAttestations(dossier.evidence, requirements.required_evidence, requirements.evidence_max_age_days, now, violations);

  if (!Array.isArray(dossier.controls) || dossier.controls.length !== requirements.required_controls.length) {
    violations.push("every required deployment control must be assigned and PASS");
  } else {
    const ids = [];
    for (const control of dossier.controls) {
      if (!hasExactKeys(control, ["id", "owner_role", "status"])) {
        violations.push("controls contains an invalid envelope");
        continue;
      }
      ids.push(control.id);
      if (control.status !== "PASS") violations.push(`control ${control.id} is not PASS`);
      if (typeof control.owner_role !== "string" || !idPattern.test(control.owner_role)) violations.push(`control ${control.id} has an invalid owner role`);
    }
    if (!sameMembers(ids, requirements.required_controls)) violations.push("control ids do not match the deployment contract");
  }

  if (!hasExactKeys(dossier.operations, ["backup_verified", "change_window_approved", "deployment_order", "privacy_preserving_monitoring", "public_methods", "rollback_ready", "rollback_targets", "staged_cutover"])) {
    violations.push("deployment operations have an invalid field contract");
  } else {
    for (const key of ["backup_verified", "change_window_approved", "privacy_preserving_monitoring", "rollback_ready", "staged_cutover"]) if (dossier.operations[key] !== true) violations.push(`${key} must be true before deployment`);
    if (JSON.stringify(dossier.operations.deployment_order) !== JSON.stringify(requirements.deployment_order)) violations.push("deployment order does not match the contract");
    if (!sameMembers(dossier.operations.rollback_targets, requirements.rollback_targets)) violations.push("rollback targets do not match the contract");
    if (JSON.stringify(dossier.operations.public_methods) !== JSON.stringify(requirements.public_methods)) violations.push("public methods must remain GET/HEAD only");
  }
  return violations;
}

export function createDeploymentReadinessReport(requirements, dossier, options = {}) {
  const now = options.now ?? Date.now();
  const violations = evaluateDeploymentReadiness(requirements, dossier, { ...options, now });
  return {
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    releaseId: isRecord(dossier) && typeof dossier.release_id === "string" ? dossier.release_id : null,
    decision: violations.length === 0 ? "GO" : "NO_GO",
    violations
  };
}
