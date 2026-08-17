const locales = Object.freeze(["fr", "en", "ur"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value, maximum, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function localizedLabel(value, label) {
  if (!isRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...locales].sort())) {
    throw new Error(`Invalid localized ${label}`);
  }
  return Object.fromEntries(locales.map((locale) => [locale, boundedString(value[locale], 80, `${label}.${locale}`)]));
}

function point(value, label) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 100)) {
    throw new Error(`Invalid schematic ${label}`);
  }
  return [value[0], value[1]];
}

function pointList(value, minimum, maximum, label) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`Invalid ${label} length`);
  }
  return value.map((item) => point(item, label));
}

function version(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 9999) throw new Error(`Invalid ${label}`);
  return value;
}

export function validateMapBootstrap(value) {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.bundleId !== "hc-demo-map-bootstrap" || value.revision !== 1 || value.status !== "DEMO_NOT_OPERATIONAL" || !Array.isArray(value.regions) || value.regions.length !== 2) {
    throw new Error("Unsupported map bootstrap");
  }
  const ids = new Set();
  const regions = value.regions.map((region) => {
    if (!isRecord(region)) throw new Error("Invalid bootstrap region");
    const id = boundedString(region.id, 40, "region id");
    const path = boundedString(region.path, 100, "region path");
    if (ids.has(id) || path !== `regions/${id}.min.json`) throw new Error("Duplicate region or invalid path");
    ids.add(id);
    return { id, path, baseVersion: version(region.baseVersion, "base version"), label: localizedLabel(region.label, "region label") };
  });
  return { schemaVersion: 1, bundleId: "hc-demo-map-bootstrap", revision: 1, status: "DEMO_NOT_OPERATIONAL", regions };
}

export function validateMapRegion(value, expectedRegionId, directoryIds) {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.bundleId !== "hc-demo-map-region" || value.revision !== 1 || value.regionId !== expectedRegionId || value.status !== "DEMO_NOT_OPERATIONAL" || value.geometryKind !== "SCHEMATIC_NOT_GEOGRAPHIC") {
    throw new Error("Unsupported map region");
  }
  for (const forbidden of ["latitude", "longitude", "coordinates", "features", "geometry", "contact", "validator"]) {
    if (forbidden in value) throw new Error(`Forbidden regional field: ${forbidden}`);
  }
  const datasetVersion = version(value.datasetVersion, "dataset version");
  const boundary = pointList(value.boundary, 3, 16, "boundary");
  if (!Array.isArray(value.roads) || value.roads.length < 1 || value.roads.length > 8) throw new Error("Invalid roads");
  const roads = value.roads.map((road) => pointList(road, 2, 16, "road"));
  if (!Array.isArray(value.districts) || value.districts.length < 1 || value.districts.length > 8) throw new Error("Invalid districts");
  const districts = value.districts.map((district) => {
    if (!isRecord(district)) throw new Error("Invalid district");
    return { label: localizedLabel(district.label, "district label"), anchor: point(district.anchor, "district anchor") };
  });
  if (!Array.isArray(value.points) || value.points.length < 1 || value.points.length > 12) throw new Error("Invalid region points");
  const seen = new Set();
  const points = value.points.map((entry) => {
    if (!isRecord(entry)) throw new Error("Invalid region point");
    const directoryId = boundedString(entry.directoryId, 60, "directory point id");
    if (seen.has(directoryId) || !directoryIds.has(directoryId)) throw new Error("Unknown or duplicate directory point");
    seen.add(directoryId);
    return { directoryId, position: point(entry.position, "point position") };
  });
  return { schemaVersion: 1, bundleId: "hc-demo-map-region", revision: 1, datasetVersion, regionId: expectedRegionId, status: "DEMO_NOT_OPERATIONAL", geometryKind: "SCHEMATIC_NOT_GEOGRAPHIC", boundary, roads, districts, points };
}
