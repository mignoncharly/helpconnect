import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateDirectoryBundle } from "../scripts/directory-schema.mjs";
import { validateMapBootstrap, validateMapRegion } from "../scripts/map-schema.mjs";
import { applyMapDelta, findDeltaChain, validateMapDelta, validateUpdateManifest } from "../scripts/update-schema.mjs";

const readJson = async (path) => JSON.parse(await readFile(new URL(`../public/${path}`, import.meta.url), "utf8"));
const directory = validateDirectoryBundle(await readJson("directory.json"));
const directoryIds = new Set(directory.points.map((point) => point.id));
const bootstrap = validateMapBootstrap(await readJson("bootstrap.json"));
const manifest = validateUpdateManifest(await readJson("updates/index.json"), new Set(bootstrap.regions.map((region) => region.id)));

test("north reaches version 3 through two sequential micro-deltas", async () => {
  const metadata = manifest.regions.find((region) => region.regionId === "demo-north");
  const chain = findDeltaChain(metadata, 1);
  assert.deepEqual(chain.map(({ from, to }) => [from, to]), [[1, 2], [2, 3]]);
  let region = validateMapRegion(await readJson("regions/demo-north.min.json"), "demo-north", directoryIds);
  for (const transition of chain) {
    const delta = validateMapDelta(await readJson(transition.path), "demo-north", transition.from, transition.to);
    region = applyMapDelta(region, delta);
  }
  const snapshot = validateMapRegion(await readJson("regions/demo-north.v3.min.json"), "demo-north", directoryIds);
  assert.deepEqual(region, snapshot);
  const snapshotBytes = await readFile(new URL("../public/regions/demo-north.v3.min.json", import.meta.url), "utf8");
  assert.equal(`${JSON.stringify(region)}\n`, snapshotBytes, "the reconstructed bytes must match the signed final snapshot exactly");
});

test("south falls back to its snapshot when the local delta chain is unavailable", () => {
  const metadata = manifest.regions.find((region) => region.regionId === "demo-south");
  assert.equal(findDeltaChain(metadata, 1), undefined);
  assert.equal(metadata.snapshotPath, "regions/demo-south.v4.min.json");
});

test("invalid delta transitions and operations are rejected without mutating the region", async () => {
  const original = validateMapRegion(await readJson("regions/demo-north.min.json"), "demo-north", directoryIds);
  const before = structuredClone(original);
  const invalid = await readJson("updates/demo-north.1-2.delta.json");
  invalid.changes[0].position = [101, 0];
  assert.throws(() => validateMapDelta(invalid, "demo-north", 1, 2));
  assert.deepEqual(original, before);
});
