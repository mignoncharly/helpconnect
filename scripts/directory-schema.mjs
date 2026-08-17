const locales = Object.freeze(["fr", "en", "ur"]);
const categories = Object.freeze(["water", "hospital", "food", "shelter", "first-aid", "generator"]);
const statuses = Object.freeze(["VERIFIED", "STALE", "UNAVAILABLE", "CLOSED"]);
const pointKeys = Object.freeze(["category", "coarse_location", "expires_at", "id", "region", "revision", "status", "verified_at"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function boundedString(value, maximum, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) throw new Error(`Invalid ${label}`);
  return value;
}

function localizedStrings(value, label) {
  if (!isRecord(value) || !hasExactKeys(value, locales)) throw new Error(`Invalid locale contract for ${label}`);
  return Object.fromEntries(locales.map((locale) => [locale, boundedString(value[locale], 100, `${label}.${locale}`)]));
}

function isoInstant(value, label, nullable = false) {
  if (nullable && value === null) return null;
  boundedString(value, 30, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) || Number.isNaN(Date.parse(value))) throw new Error(`Invalid ${label}`);
  return value;
}

export function effectiveDirectoryStatus(point, now = new Date()) {
  if (!statuses.includes(point.status)) throw new Error("Unsupported directory status");
  return point.status === "VERIFIED" && point.expires_at !== null && Date.parse(point.expires_at) <= now.getTime() ? "STALE" : point.status;
}

export function validateDirectoryBundle(value) {
  const bundleKeys = ["bundle_id", "points", "published_at", "revision", "schema_version", "status"];
  if (!isRecord(value) || !hasExactKeys(value, bundleKeys) || value.schema_version !== 2 || value.bundle_id !== "hc-demo-directory" || value.status !== "DEMO_NOT_OPERATIONAL") {
    throw new Error("Unsupported directory bundle");
  }
  const publishedAt = isoInstant(value.published_at, "published_at");
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error("Invalid directory revision");
  if (!Array.isArray(value.points) || value.points.length < 1 || value.points.length > 500) throw new Error("Invalid directory point count");

  const ids = new Set();
  const points = value.points.map((point) => {
    if (!isRecord(point) || !hasExactKeys(point, pointKeys) || !categories.includes(point.category) || !statuses.includes(point.status)) {
      throw new Error("Invalid or non-minimized public point");
    }
    const id = boundedString(point.id, 60, "point id");
    if (ids.has(id)) throw new Error("Duplicate point id");
    ids.add(id);
    if (!Number.isSafeInteger(point.revision) || point.revision < 1) throw new Error("Invalid point revision");
    const verifiedAt = isoInstant(point.verified_at, "verified_at", true);
    const expiresAt = isoInstant(point.expires_at, "expires_at", true);
    if (point.status === "VERIFIED" && (verifiedAt === null || expiresAt === null)) throw new Error("Verified point lacks integrity timestamps");
    return {
      id,
      category: point.category,
      region: boundedString(point.region, 60, "region"),
      coarse_location: localizedStrings(point.coarse_location, "coarse_location"),
      status: point.status,
      verified_at: verifiedAt,
      expires_at: expiresAt,
      revision: point.revision
    };
  });

  return { schema_version: 2, bundle_id: "hc-demo-directory", revision: value.revision, status: "DEMO_NOT_OPERATIONAL", published_at: publishedAt, points };
}

export const directoryCategories = categories;
export const directoryLocales = locales;
export const directoryPointKeys = pointKeys;
export const directoryStatuses = statuses;
