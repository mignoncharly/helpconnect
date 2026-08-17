const overrideKeys = Object.freeze([
  "accepted_documentation_gaps",
  "assertion",
  "attested_requirement_ids",
  "authority_role",
  "decided_at",
  "decision",
  "decision_basis",
  "evidence_disposition",
  "schema_version",
  "scope"
]);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function exactUniqueMembers(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && new Set(actual).size === actual.length
    && expected.every((value) => actual.includes(value));
}

export function expectedAttestedRequirementIds(phase17Requirements, phase18Requirements) {
  return Object.freeze([
    ...phase17Requirements.required_external_evidence.map((item) => item.id),
    "phase-18-field-pilot-completed",
    "phase-18-reduced-scope",
    "phase-18-consent-approved",
    ...phase18Requirements.required_human_reviews.map((id) => `human-review:${id}`),
    ...phase18Requirements.required_operational_drills.map((id) => `operational-drill:${id}`),
    ...phase18Requirements.required_metrics.map((id) => `metric:${id}`),
    ...phase18Requirements.required_stop_conditions.map((id) => `stop-condition:${id}`)
  ]);
}

export function validateGovernanceOverride(override, phase17Requirements, phase18Requirements, now = Date.now()) {
  const violations = [];
  if (!hasExactKeys(override, overrideKeys)) return ["stakeholder override has an invalid field contract"];
  if (override.schema_version !== 1 || override.decision !== "GO" || override.decision_basis !== "STAKEHOLDER_OVERRIDE") violations.push("stakeholder override has an invalid decision contract");
  if (override.authority_role !== "accountable-stakeholder") violations.push("stakeholder override requires the accountable stakeholder role");
  if (override.evidence_disposition !== "STAKEHOLDER_ATTESTED_NOT_VERIFIED_IN_WORKSPACE") violations.push("stakeholder override must preserve the evidence disposition");
  if (!exactUniqueMembers(override.scope, ["phase-17", "phase-18"])) violations.push("stakeholder override scope must be Phase 17 and Phase 18 only");
  if (!exactUniqueMembers(override.accepted_documentation_gaps, ["external-artifacts-not-present-in-workspace", "phase-18-aggregate-results-not-present-in-workspace"])) violations.push("stakeholder override must disclose both documentation gaps");
  if (typeof override.assertion !== "string" || override.assertion.length < 80 || override.assertion.length > 500) violations.push("stakeholder assertion is missing or invalid");
  const decidedAt = Date.parse(override.decided_at);
  if (!Number.isFinite(decidedAt) || decidedAt > now + 5 * 60 * 1000) violations.push("stakeholder decision timestamp is invalid or future-dated");
  const expected = expectedAttestedRequirementIds(phase17Requirements, phase18Requirements);
  if (!exactUniqueMembers(override.attested_requirement_ids, expected)) violations.push("stakeholder attestation does not cover every Phase 17 and Phase 18 requirement");
  return violations;
}
