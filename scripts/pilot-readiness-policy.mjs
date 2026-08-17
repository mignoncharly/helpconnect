const requirementKeys = Object.freeze([
  "allowed_categories",
  "dossier_max_age_days",
  "evidence_max_age_days",
  "prerequisite_decision",
  "required_human_reviews",
  "required_metrics",
  "required_operational_drills",
  "required_security_evidence",
  "required_stop_conditions",
  "schema_version",
  "scope"
]);

const dossierKeys = Object.freeze([
  "build_sha256",
  "external_evidence",
  "generated_at",
  "human_reviews",
  "measurement",
  "operational_drills",
  "pilot_id",
  "schema_version",
  "scope",
  "security_decision",
  "stop_conditions"
]);

const forbiddenDossierKeys = Object.freeze(new Set([
  "android_id",
  "device_identifier",
  "email",
  "exact_location",
  "free_text",
  "gps",
  "imei",
  "ip",
  "name",
  "participant_id",
  "phone",
  "search_query",
  "serial_number",
  "user_agent"
]));

const idPattern = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;
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

function isUniqueStringList(value, minimum = 1) {
  return Array.isArray(value)
    && value.length >= minimum
    && value.every((item) => typeof item === "string" && item.length > 0)
    && new Set(value).size === value.length;
}

function isPositiveRange(value) {
  return hasExactKeys(value, ["maximum", "minimum"])
    && Number.isSafeInteger(value.minimum)
    && Number.isSafeInteger(value.maximum)
    && value.minimum > 0
    && value.maximum >= value.minimum;
}

function matchesExpectedIds(actual, expected) {
  return isUniqueStringList(actual)
    && actual.length === expected.length
    && expected.every((id) => actual.includes(id));
}

function timestampAgeDays(value, now) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return (now - parsed) / (24 * 60 * 60 * 1000);
}

function validateAttestations(values, expectedIds, maximumAgeDays, now, label, violations) {
  if (!Array.isArray(values) || values.length !== expectedIds.length) {
    violations.push(`${label} must contain every required attestation exactly once`);
    return;
  }
  const ids = [];
  for (const value of values) {
    if (!hasExactKeys(value, ["artifact_sha256", "id", "reviewed_at", "reviewer_role", "status"])) {
      violations.push(`${label} contains an invalid attestation envelope`);
      continue;
    }
    ids.push(value.id);
    if (!expectedIds.includes(value.id)) violations.push(`${label} contains an unknown id: ${value.id}`);
    if (value.status !== "PASS") violations.push(`${label} ${value.id} is not PASS`);
    if (!sha256Pattern.test(value.artifact_sha256)) violations.push(`${label} ${value.id} lacks a SHA-256 evidence binding`);
    if (typeof value.reviewer_role !== "string" || !idPattern.test(value.reviewer_role)) violations.push(`${label} ${value.id} has an invalid reviewer role`);
    const age = timestampAgeDays(value.reviewed_at, now);
    if (!Number.isFinite(age) || age < 0 || age > maximumAgeDays) violations.push(`${label} ${value.id} is missing, future-dated, or stale`);
  }
  if (!matchesExpectedIds(ids, expectedIds)) violations.push(`${label} ids do not match the requirement contract`);
}

function findForbiddenKeys(value, path = "dossier", violations = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => findForbiddenKeys(item, `${path}[${index}]`, violations));
    return violations;
  }
  if (!isRecord(value)) return violations;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenDossierKeys.has(key.toLowerCase())) violations.push(`${path}.${key} is forbidden in a pilot admission dossier`);
    findForbiddenKeys(nested, `${path}.${key}`, violations);
  }
  return violations;
}

export function validatePilotRequirements(requirements) {
  const violations = [];
  if (!hasExactKeys(requirements, requirementKeys)) return ["pilot requirements have an invalid field contract"];
  if (requirements.schema_version !== 1 || requirements.prerequisite_decision !== "GO") violations.push("pilot requirements have an invalid version or prerequisite decision");
  for (const key of ["dossier_max_age_days", "evidence_max_age_days"]) {
    if (!Number.isSafeInteger(requirements[key]) || requirements[key] < 1 || requirements[key] > 365) violations.push(`${key} must be between 1 and 365`);
  }
  if (!hasExactKeys(requirements.scope, ["category_count", "operator_count", "participant_count", "point_count", "region_count"])) {
    violations.push("pilot scope requirements have an invalid field contract");
  } else {
    if (requirements.scope.region_count !== 1) violations.push("the pilot must be limited to exactly one region");
    for (const key of ["point_count", "category_count", "operator_count", "participant_count"]) if (!isPositiveRange(requirements.scope[key])) violations.push(`invalid ${key} range`);
  }
  for (const key of ["allowed_categories", "required_security_evidence", "required_human_reviews", "required_operational_drills", "required_metrics", "required_stop_conditions"]) {
    if (!isUniqueStringList(requirements[key]) || requirements[key].some((id) => !idPattern.test(id))) violations.push(`${key} must be a unique list of safe ids`);
  }
  return violations;
}

export function evaluatePilotAdmission(requirements, dossier, now = Date.now()) {
  const requirementViolations = validatePilotRequirements(requirements);
  if (requirementViolations.length > 0) return requirementViolations;
  const violations = findForbiddenKeys(dossier);
  if (!hasExactKeys(dossier, dossierKeys)) return [...violations, "pilot dossier has an invalid field contract"];
  if (dossier.schema_version !== 1) violations.push("pilot dossier schema version must be 1");
  if (typeof dossier.pilot_id !== "string" || !idPattern.test(dossier.pilot_id)) violations.push("pilot_id must be a non-identifying safe id");
  if (!sha256Pattern.test(dossier.build_sha256)) violations.push("build_sha256 must bind the exact tested build");
  const dossierAge = timestampAgeDays(dossier.generated_at, now);
  if (!Number.isFinite(dossierAge) || dossierAge < 0 || dossierAge > requirements.dossier_max_age_days) violations.push("pilot dossier is missing, future-dated, or stale");
  if (dossier.security_decision !== requirements.prerequisite_decision) violations.push("Phase 17 security decision is not GO");

  if (!hasExactKeys(dossier.scope, ["categories", "operator_count", "participant_count", "point_count", "region_ids"])) {
    violations.push("pilot scope has an invalid field contract");
  } else {
    const { scope } = dossier;
    if (!isUniqueStringList(scope.region_ids) || scope.region_ids.length !== requirements.scope.region_count || scope.region_ids.some((id) => !idPattern.test(id))) violations.push("pilot scope must contain exactly one safe region id");
    if (!isUniqueStringList(scope.categories) || scope.categories.length < requirements.scope.category_count.minimum || scope.categories.length > requirements.scope.category_count.maximum || scope.categories.some((category) => !requirements.allowed_categories.includes(category))) violations.push("pilot categories are unknown or outside the reduced scope");
    for (const key of ["point_count", "operator_count", "participant_count"]) {
      const value = scope[key];
      const range = requirements.scope[key];
      if (!Number.isSafeInteger(value) || value < range.minimum || value > range.maximum) violations.push(`${key} is outside the reduced pilot scope`);
    }
  }

  validateAttestations(dossier.external_evidence, requirements.required_security_evidence, requirements.evidence_max_age_days, now, "external_evidence", violations);
  validateAttestations(dossier.human_reviews, requirements.required_human_reviews, requirements.evidence_max_age_days, now, "human_reviews", violations);
  validateAttestations(dossier.operational_drills, requirements.required_operational_drills, requirements.evidence_max_age_days, now, "operational_drills", violations);

  if (!hasExactKeys(dossier.measurement, ["consent_script_approved", "free_text_collection", "in_app_telemetry", "individual_tracking", "metrics", "persistent_participant_ids"])) {
    violations.push("pilot measurement plan has an invalid field contract");
  } else {
    if (dossier.measurement.consent_script_approved !== true) violations.push("the observation consent script is not approved");
    for (const key of ["free_text_collection", "in_app_telemetry", "individual_tracking", "persistent_participant_ids"]) if (dossier.measurement[key] !== false) violations.push(`${key} must remain disabled`);
    if (!matchesExpectedIds(dossier.measurement.metrics, requirements.required_metrics)) violations.push("the aggregate field metrics do not match the requirement contract");
  }

  if (!Array.isArray(dossier.stop_conditions) || dossier.stop_conditions.length !== requirements.required_stop_conditions.length) {
    violations.push("every required stop condition must be armed");
  } else {
    const ids = [];
    for (const condition of dossier.stop_conditions) {
      if (!hasExactKeys(condition, ["armed", "id", "owner_role"])) {
        violations.push("stop_conditions contains an invalid envelope");
        continue;
      }
      ids.push(condition.id);
      if (condition.armed !== true) violations.push(`stop condition ${condition.id} is not armed`);
      if (typeof condition.owner_role !== "string" || !idPattern.test(condition.owner_role)) violations.push(`stop condition ${condition.id} has an invalid owner role`);
    }
    if (!matchesExpectedIds(ids, requirements.required_stop_conditions)) violations.push("stop condition ids do not match the requirement contract");
  }
  return violations;
}

export function createPilotAdmissionReport(requirements, dossier, now = Date.now()) {
  const violations = evaluatePilotAdmission(requirements, dossier, now);
  return {
    schemaVersion: 1,
    generatedAt: new Date(now).toISOString(),
    pilotId: isRecord(dossier) && typeof dossier.pilot_id === "string" ? dossier.pilot_id : null,
    decision: violations.length === 0 ? "GO" : "NO_GO",
    violations
  };
}
