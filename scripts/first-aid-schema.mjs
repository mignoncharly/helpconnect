const bundleKeys = ["bundleId", "dir", "expiresAt", "guides", "locale", "revision", "schemaVersion", "sourceCheckedAt", "sources", "status"];
const guideKeys = ["avoid", "emergency", "id", "sources", "steps", "summary", "title"];
const sourceKeys = ["id", "publisher", "title", "updatedAt"];

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${label} has an invalid field contract`);
  }
}

function assertString(value, label, maximum = 500) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`${label} must be a non-empty bounded string`);
  }
  return value;
}

function assertDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${label} must be an ISO date`);
  }
  return value;
}

function assertStringList(value, label, minimum = 1) {
  if (!Array.isArray(value) || value.length < minimum || value.length > 12) {
    throw new Error(`${label} must be a bounded list`);
  }
  return value.map((item, index) => assertString(item, `${label}[${index}]`, 600));
}

export function validateFirstAidBundle(value, expectedLocale) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("First-aid bundle must be an object");
  }
  assertExactKeys(value, bundleKeys, "bundle");
  if (value.schemaVersion !== 1 || value.bundleId !== "hc-first-aid-core" || value.revision !== 1) {
    throw new Error("Unsupported first-aid bundle identity or revision");
  }
  if (value.locale !== expectedLocale || !["fr", "en", "ur"].includes(value.locale)) {
    throw new Error("Unexpected first-aid locale");
  }
  if (value.dir !== (value.locale === "ur" ? "rtl" : "ltr")) {
    throw new Error("Invalid first-aid text direction");
  }
  if (value.status !== "REVIEW_REQUIRED" || value.expiresAt !== null) {
    throw new Error("Unapproved content must remain REVIEW_REQUIRED without an expiry claim");
  }
  assertDate(value.sourceCheckedAt, "sourceCheckedAt");
  if (!Array.isArray(value.sources) || value.sources.length < 2 || value.sources.length > 10) {
    throw new Error("Invalid first-aid source list");
  }
  const sourceIds = new Set();
  for (const [index, source] of value.sources.entries()) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw new Error(`sources[${index}] must be an object`);
    }
    assertExactKeys(source, sourceKeys, `sources[${index}]`);
    const id = assertString(source.id, `sources[${index}].id`, 80);
    if (sourceIds.has(id)) {
      throw new Error(`Duplicate source id: ${id}`);
    }
    sourceIds.add(id);
    assertString(source.publisher, `sources[${index}].publisher`, 120);
    assertString(source.title, `sources[${index}].title`, 240);
    assertDate(source.updatedAt, `sources[${index}].updatedAt`);
  }
  if (!Array.isArray(value.guides) || value.guides.length !== 4) {
    throw new Error("The core first-aid bundle must contain four guides");
  }
  const guideIds = new Set();
  for (const [index, guide] of value.guides.entries()) {
    if (!guide || typeof guide !== "object" || Array.isArray(guide)) {
      throw new Error(`guides[${index}] must be an object`);
    }
    assertExactKeys(guide, guideKeys, `guides[${index}]`);
    const id = assertString(guide.id, `guides[${index}].id`, 60);
    if (guideIds.has(id)) {
      throw new Error(`Duplicate guide id: ${id}`);
    }
    guideIds.add(id);
    assertString(guide.title, `${id}.title`, 120);
    assertString(guide.summary, `${id}.summary`, 400);
    assertString(guide.emergency, `${id}.emergency`, 500);
    assertStringList(guide.steps, `${id}.steps`, 3);
    assertStringList(guide.avoid, `${id}.avoid`, 1);
    const references = assertStringList(guide.sources, `${id}.sources`, 1);
    if (references.some((sourceId) => !sourceIds.has(sourceId))) {
      throw new Error(`${id} references an unknown source`);
    }
  }
  return value;
}
