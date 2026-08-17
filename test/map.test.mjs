import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateDirectoryBundle } from "../scripts/directory-schema.mjs";
import { validateMapBootstrap, validateMapRegion } from "../scripts/map-schema.mjs";

const directory = validateDirectoryBundle(JSON.parse(await readFile(new URL("../public/directory.json", import.meta.url), "utf8")));
const directoryIds = new Set(directory.points.map((point) => point.id));
const bootstrap = validateMapBootstrap(JSON.parse(await readFile(new URL("../public/bootstrap.json", import.meta.url), "utf8")));

test("the map bootstrap exposes only two bounded regional chunks", () => {
  assert.equal(bootstrap.regions.length, 2);
  assert.deepEqual(bootstrap.regions.map((region) => region.path), ["regions/demo-north.min.json", "regions/demo-south.min.json"]);
});

for (const metadata of bootstrap.regions) {
  test(`${metadata.id} is a valid pre-simplified schematic region`, async () => {
    const raw = JSON.parse(await readFile(new URL(`../public/${metadata.path}`, import.meta.url), "utf8"));
    const region = validateMapRegion(raw, metadata.id, directoryIds);
    assert.equal(region.points.length, 3);
    assert.equal(region.geometryKind, "SCHEMATIC_NOT_GEOGRAPHIC");
  });
}

test("regional assets reject geographic, contact, and unknown-point claims", async () => {
  const original = JSON.parse(await readFile(new URL("../public/regions/demo-north.min.json", import.meta.url), "utf8"));
  for (const mutation of [
    { latitude: 15 },
    { coordinates: [1, 2] },
    { contact: "person" },
    { geometryKind: "GEOGRAPHIC" }
  ]) {
    assert.throws(() => validateMapRegion({ ...structuredClone(original), ...mutation }, "demo-north", directoryIds));
  }
  const unknownPoint = structuredClone(original);
  unknownPoint.points[0].directoryId = "unknown";
  assert.throws(() => validateMapRegion(unknownPoint, "demo-north", directoryIds));
});
