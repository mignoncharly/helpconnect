import assert from "node:assert/strict";
import test from "node:test";
import {
  regionalSnapshotAssets,
  serviceWorkerInstallableAssets,
  serviceWorkerPrecacheAssets,
  serviceWorkerRegionAssets,
  serviceWorkerRuntimeAssets,
  updateDeltaAssets,
  updateManifestAssets
} from "../scripts/build-config.mjs";
import { isOwnedPublicCacheName, publicCachePolicy } from "../shared/cache-policy.js";

test("public cache names are explicit, versioned, and ownership-bounded", () => {
  assert.equal(publicCachePolicy.data, "hc-data-v1");
  assert.equal(publicCachePolicy.firstAid, "hc-first-aid-v1");
  assert.equal(isOwnedPublicCacheName("hc-shell-release"), true);
  assert.equal(isOwnedPublicCacheName(publicCachePolicy.data), true);
  assert.equal(isOwnedPublicCacheName(publicCachePolicy.firstAid), true);
  assert.equal(isOwnedPublicCacheName("unrelated-cache"), false);
});

test("cache allow-lists are disjoint and optional data never enters the shell", () => {
  const groups = [serviceWorkerPrecacheAssets, serviceWorkerRuntimeAssets, serviceWorkerInstallableAssets, serviceWorkerRegionAssets];
  const flattened = groups.flat();
  assert.equal(new Set(flattened).size, flattened.length);
  assert.equal(serviceWorkerPrecacheAssets.some((asset) => asset.startsWith("./regions/") || asset.startsWith("./first-aid/")), false);
  assert.deepEqual(serviceWorkerInstallableAssets, ["./first-aid/en.json", "./first-aid/fr.json", "./first-aid/ur.json"]);
  assert.deepEqual(serviceWorkerRuntimeAssets, ["./i18n/en.json", "./i18n/fr.json", "./i18n/ur.json"]);
});

test("updates, deltas, final snapshots, and sensitive pseudo-paths are never automatically cached", () => {
  const automatic = new Set([...serviceWorkerPrecacheAssets, ...serviceWorkerRuntimeAssets, ...serviceWorkerInstallableAssets, ...serviceWorkerRegionAssets]);
  for (const asset of [...updateManifestAssets, ...updateDeltaAssets, ...regionalSnapshotAssets]) assert.equal(automatic.has(`./${asset}`), false);
  for (const value of ["./search", "./history", "./navigation", "./position", "./profile"]) assert.equal(automatic.has(value), false);
});
