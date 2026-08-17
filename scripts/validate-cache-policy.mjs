import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  serviceWorkerInstallableAssets,
  serviceWorkerPrecacheAssets,
  serviceWorkerRegionAssets,
  serviceWorkerRuntimeAssets,
  updateDeltaAssets,
  updateManifestAssets,
  regionalSnapshotAssets
} from "./build-config.mjs";
import { publicCachePolicy } from "../shared/cache-policy.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const groups = {
  shell: serviceWorkerPrecacheAssets,
  runtime: serviceWorkerRuntimeAssets,
  firstAid: serviceWorkerInstallableAssets,
  region: serviceWorkerRegionAssets
};
const seen = new Map();
for (const [group, assets] of Object.entries(groups)) {
  if (assets.length === 0 || new Set(assets).size !== assets.length) throw new Error(`Empty or duplicate cache allow-list: ${group}`);
  for (const asset of assets) {
    if (!/^\.\/[a-z0-9][a-z0-9./-]*$/.test(asset) || /[?#]/.test(asset)) throw new Error(`Unsafe cache asset path: ${asset}`);
    if (seen.has(asset)) throw new Error(`Cache asset belongs to both ${seen.get(asset)} and ${group}: ${asset}`);
    seen.set(asset, group);
  }
}
if (serviceWorkerPrecacheAssets.some((asset) => asset.startsWith("./regions/") || asset.startsWith("./first-aid/"))) throw new Error("Optional user-selected content entered the app-shell cache");
if (serviceWorkerInstallableAssets.some((asset) => !/^\.\/first-aid\/(?:fr|en|ur)\.json$/.test(asset))) throw new Error("Unexpected first-aid cache entry");
if (serviceWorkerRegionAssets.some((asset) => !/^\.\/regions\/[a-z0-9-]+\.min\.json$/.test(asset))) throw new Error("Unexpected regional cache entry");
const forbiddenAutomaticAssets = [...updateManifestAssets, ...updateDeltaAssets, ...regionalSnapshotAssets].map((asset) => `./${asset}`);
if (forbiddenAutomaticAssets.some((asset) => seen.has(asset))) throw new Error("Updates or snapshots entered an automatic cache allow-list");
if (new Set([publicCachePolicy.data, publicCachePolicy.firstAid]).size !== 2 || !publicCachePolicy.shellPrefix.endsWith("-") || !publicCachePolicy.firstAid.startsWith(publicCachePolicy.firstAidPrefix)) throw new Error("Invalid cache compartment names");

const worker = await readFile(path.join(projectRoot, "dist", "service-worker.js"), "utf8");
if (!worker.includes(publicCachePolicy.data) || !worker.includes(publicCachePolicy.firstAid) || !worker.includes(publicCachePolicy.shellPrefix)) throw new Error("Built Service Worker omits a cache compartment");
if (/ignoreSearch\s*:\s*true/.test(worker)) throw new Error("Built Service Worker permits query-insensitive cache matching");

console.log("Validated disjoint shell, regional, first-aid, runtime, and never-cache policies");
