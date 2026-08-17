const categories = Object.freeze(["water", "hospital", "food", "shelter", "first-aid", "generator"]);
const locales = Object.freeze(["fr", "en", "ur"]);
const publicStatuses = Object.freeze(["VERIFIED", "STALE", "UNAVAILABLE", "CLOSED"]);
const workflowStates = Object.freeze(["DRAFT", "IN_REVIEW", "VALIDATED", "PUBLISHED"]);
const privateRecordKeys = Object.freeze(["availability_status", "category", "coarse_location", "created_at", "created_by", "expires_at", "humanitarian_contact", "id", "internal_notes", "publisher_id", "region", "revision", "validator_id", "verified_at", "workflow_state"]);

export const publicPointKeys = Object.freeze([
  "id",
  "category",
  "region",
  "coarse_location",
  "status",
  "verified_at",
  "expires_at",
  "revision"
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function text(value, maximum, label) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function isoInstant(value, label, nullable = false) {
  if (nullable && value === null) return null;
  text(value, 30, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function localizedText(value, label) {
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== [...locales].sort().join(",")) {
    throw new Error(`Invalid locales for ${label}`);
  }
  return Object.fromEntries(locales.map((locale) => [locale, text(value[locale], 100, `${label}.${locale}`)]));
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${label}`);
  return value;
}

export function effectivePublicStatus(status, expiresAt, now = new Date()) {
  if (!publicStatuses.includes(status)) throw new Error("Unsupported public status");
  const expiry = isoInstant(expiresAt, "expires_at", true);
  if (status === "VERIFIED" && expiry !== null && Date.parse(expiry) <= now.getTime()) return "STALE";
  return status;
}

export function createDraft(input, actorId, at) {
  if (!isRecord(input) || !categories.includes(input.category)) throw new Error("Invalid draft input");
  const timestamp = isoInstant(at, "created_at");
  const creator = text(actorId, 80, "created_by");
  return {
    id: text(input.id, 60, "id"),
    category: input.category,
    region: text(input.region, 60, "region"),
    coarse_location: localizedText(input.coarse_location, "coarse_location"),
    availability_status: "UNAVAILABLE",
    workflow_state: "DRAFT",
    revision: 1,
    verified_at: null,
    expires_at: null,
    created_at: timestamp,
    created_by: creator,
    validator_id: null,
    publisher_id: null,
    internal_notes: text(input.internal_notes, 500, "internal_notes"),
    humanitarian_contact: input.humanitarian_contact ?? null
  };
}

export function transitionRecord(record, event, context) {
  validatePrivateRecord(record);
  if (!isRecord(context)) throw new Error("Missing transition context");
  const actorId = text(context.actor_id, 80, "actor_id");
  const at = isoInstant(context.at, "transition time");

  if (event === "SUBMIT_FOR_REVIEW" && record.workflow_state === "DRAFT") {
    if (actorId !== record.created_by) throw new Error("Only the creator can submit the draft");
    return { ...record, workflow_state: "IN_REVIEW" };
  }
  if (event === "VALIDATE" && record.workflow_state === "IN_REVIEW") {
    if (actorId === record.created_by) throw new Error("The creator cannot validate the same record");
    if (!publicStatuses.includes(context.status)) throw new Error("Invalid validation status");
    const expiresAt = isoInstant(context.expires_at, "expires_at", true);
    if (context.status === "VERIFIED" && (expiresAt === null || Date.parse(expiresAt) <= Date.parse(at))) {
      throw new Error("A verified record needs a future expiry");
    }
    return {
      ...record,
      availability_status: context.status,
      workflow_state: "VALIDATED",
      verified_at: at,
      expires_at: expiresAt,
      validator_id: actorId
    };
  }
  if (event === "PUBLISH" && record.workflow_state === "VALIDATED") {
    return { ...record, workflow_state: "PUBLISHED", publisher_id: actorId };
  }
  if (event === "REVALIDATE" && record.workflow_state === "PUBLISHED") {
    return {
      ...record,
      workflow_state: "IN_REVIEW",
      revision: record.revision + 1,
      validator_id: null,
      publisher_id: null
    };
  }
  throw new Error(`Invalid ${event} transition from ${record.workflow_state}`);
}

export function validatePrivateRecord(record) {
  if (!isRecord(record) || !hasExactKeys(record, privateRecordKeys) || !categories.includes(record.category) || !workflowStates.includes(record.workflow_state) || !publicStatuses.includes(record.availability_status)) {
    throw new Error("Invalid private record contract");
  }
  text(record.id, 60, "id");
  text(record.region, 60, "region");
  localizedText(record.coarse_location, "coarse_location");
  positiveInteger(record.revision, "revision");
  isoInstant(record.created_at, "created_at");
  text(record.created_by, 80, "created_by");
  text(record.internal_notes, 500, "internal_notes");
  isoInstant(record.verified_at, "verified_at", true);
  isoInstant(record.expires_at, "expires_at", true);
  if (record.validator_id !== null) text(record.validator_id, 80, "validator_id");
  if (record.publisher_id !== null) text(record.publisher_id, 80, "publisher_id");
  if (record.humanitarian_contact !== null) {
    if (!isRecord(record.humanitarian_contact) || !hasExactKeys(record.humanitarian_contact, ["name", "phone"])) throw new Error("Invalid humanitarian contact");
    text(record.humanitarian_contact.name, 120, "humanitarian contact name");
    text(record.humanitarian_contact.phone, 60, "humanitarian contact phone");
  }
  if (record.validator_id !== null && record.validator_id === record.created_by) {
    throw new Error("The creator and validator must differ");
  }
  if (["VALIDATED", "PUBLISHED"].includes(record.workflow_state) && (record.verified_at === null || record.validator_id === null)) {
    throw new Error("Validated records require validation metadata");
  }
  if (record.workflow_state === "PUBLISHED" && record.publisher_id === null) throw new Error("Published records require a publisher");
  return record;
}

export function projectDirectory(privateBundle) {
  if (!isRecord(privateBundle) || privateBundle.schema_version !== 1 || privateBundle.bundle_id !== "hc-demo-operator-records" || !Array.isArray(privateBundle.records)) {
    throw new Error("Invalid private publication bundle");
  }
  const publishedAt = isoInstant(privateBundle.published_at, "published_at");
  const now = new Date(publishedAt);
  const ids = new Set();
  const validatedRecords = privateBundle.records.map(validatePrivateRecord);
  const points = validatedRecords.filter((record) => record.workflow_state === "PUBLISHED").map((record) => {
    if (ids.has(record.id)) throw new Error("Duplicate published point id");
    ids.add(record.id);
    return {
      id: record.id,
      category: record.category,
      region: record.region,
      coarse_location: localizedText(record.coarse_location, "coarse_location"),
      status: effectivePublicStatus(record.availability_status, record.expires_at, now),
      verified_at: record.verified_at,
      expires_at: record.expires_at,
      revision: record.revision
    };
  });
  if (points.length === 0) throw new Error("A publication cannot be empty");
  return {
    schema_version: 2,
    bundle_id: "hc-demo-directory",
    revision: positiveInteger(privateBundle.revision, "bundle revision"),
    status: "DEMO_NOT_OPERATIONAL",
    published_at: publishedAt,
    points
  };
}

export const publicationCategories = categories;
export const publicationStatuses = publicStatuses;
