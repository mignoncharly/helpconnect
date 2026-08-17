function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value, maximum, label) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) throw new Error(`Invalid ${label}`);
  return value;
}

function version(value, label) {
  if (!Number.isInteger(value) || value < 1 || value > 9999) throw new Error(`Invalid ${label}`);
  return value;
}

function schematicPoint(value, label) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 100)) throw new Error(`Invalid ${label}`);
  return [value[0], value[1]];
}

export function validateUpdateManifest(value, regionIds) {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.bundleId !== "hc-demo-map-updates" || value.status !== "DEMO_NOT_OPERATIONAL" || !Array.isArray(value.regions) || value.regions.length !== regionIds.size) throw new Error("Unsupported update manifest");
  const seen = new Set();
  const regions = value.regions.map((entry) => {
    if (!isRecord(entry)) throw new Error("Invalid update region");
    const regionId = boundedString(entry.regionId, 40, "update region id");
    const currentVersion = version(entry.currentVersion, "current version");
    const snapshotPath = boundedString(entry.snapshotPath, 120, "snapshot path");
    if (!regionIds.has(regionId) || seen.has(regionId) || snapshotPath !== `regions/${regionId}.v${currentVersion}.min.json`) throw new Error("Invalid update region identity");
    seen.add(regionId);
    if (!Array.isArray(entry.deltas) || entry.deltas.length > 12) throw new Error("Invalid delta catalog");
    const deltas = entry.deltas.map((delta) => {
      if (!isRecord(delta)) throw new Error("Invalid delta metadata");
      const from = version(delta.from, "delta from");
      const to = version(delta.to, "delta to");
      const path = boundedString(delta.path, 140, "delta path");
      if (to !== from + 1 || to > currentVersion || path !== `updates/${regionId}.${from}-${to}.delta.json`) throw new Error("Invalid delta transition");
      return { from, to, path };
    });
    return { regionId, currentVersion, snapshotPath, deltas };
  });
  return { schemaVersion: 1, bundleId: "hc-demo-map-updates", status: "DEMO_NOT_OPERATIONAL", regions };
}

export function findDeltaChain(metadata, localVersion) {
  const chain = [];
  let versionCursor = localVersion;
  while (versionCursor < metadata.currentVersion) {
    const next = metadata.deltas.find((delta) => delta.from === versionCursor && delta.to === versionCursor + 1);
    if (!next) return undefined;
    chain.push(next);
    versionCursor = next.to;
  }
  return chain;
}

export function validateMapDelta(value, expectedRegionId, expectedFrom, expectedTo) {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.bundleId !== "hc-demo-map-delta" || value.status !== "DEMO_NOT_OPERATIONAL" || value.regionId !== expectedRegionId || value.from !== expectedFrom || value.to !== expectedTo || !Array.isArray(value.changes) || value.changes.length < 1 || value.changes.length > 20) throw new Error("Unsupported map delta");
  const changes = value.changes.map((change) => {
    if (!isRecord(change)) throw new Error("Invalid delta change");
    if (change.op === "move-point") {
      return { op: "move-point", directoryId: boundedString(change.directoryId, 60, "delta point id"), position: schematicPoint(change.position, "delta point position") };
    }
    if (change.op === "replace-road") {
      if (!Number.isInteger(change.roadIndex) || change.roadIndex < 0 || change.roadIndex > 7 || !Array.isArray(change.points) || change.points.length < 2 || change.points.length > 16) throw new Error("Invalid road replacement");
      return { op: "replace-road", roadIndex: change.roadIndex, points: change.points.map((point) => schematicPoint(point, "delta road point")) };
    }
    throw new Error("Unsupported delta operation");
  });
  return { schemaVersion: 1, bundleId: "hc-demo-map-delta", status: "DEMO_NOT_OPERATIONAL", regionId: expectedRegionId, from: expectedFrom, to: expectedTo, changes };
}

export function applyMapDelta(region, delta) {
  if (region.regionId !== delta.regionId || region.datasetVersion !== delta.from) throw new Error("Delta does not follow the local version");
  const next = structuredClone(region);
  for (const change of delta.changes) {
    if (change.op === "move-point") {
      const point = next.points.find((entry) => entry.directoryId === change.directoryId);
      if (!point) throw new Error("Delta references an unknown point");
      point.position = [...change.position];
    } else {
      if (!next.roads[change.roadIndex]) throw new Error("Delta references an unknown road");
      next.roads[change.roadIndex] = change.points.map((point) => [...point]);
    }
  }
  next.datasetVersion = delta.to;
  return next;
}
