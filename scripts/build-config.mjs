import { signatureAssets, trustAssets } from "./integrity-config.mjs";

export const coreAssets = Object.freeze([
  "index.html",
  "styles.css",
  "app.js",
  "service-worker.js",
  "manifest.webmanifest",
  "icons.svg",
  "ui-icons.svg",
  "directory.json",
  "directory.json.sig.json",
  "bootstrap.json",
  "bootstrap.json.sig.json",
  ...trustAssets
]);

export const directoryAssets = Object.freeze(["directory.json"]);
export const mapBootstrapAssets = Object.freeze(["bootstrap.json"]);
export const baseRegionAssets = Object.freeze([
  "regions/demo-north.min.json",
  "regions/demo-south.min.json"
]);

export const regionalSnapshotAssets = Object.freeze([
  "regions/demo-north.v3.min.json",
  "regions/demo-south.v4.min.json"
]);

export const optionalRegionAssets = Object.freeze([
  ...baseRegionAssets,
  ...regionalSnapshotAssets
]);

export const updateManifestAssets = Object.freeze(["updates/index.json"]);
export const updateDeltaAssets = Object.freeze([
  "updates/demo-north.1-2.delta.json",
  "updates/demo-north.2-3.delta.json",
  "updates/demo-south.3-4.delta.json"
]);
export const optionalUpdateAssets = Object.freeze([
  ...updateManifestAssets,
  ...updateDeltaAssets,
  ...regionalSnapshotAssets
]);

export const optionalLocaleAssets = Object.freeze([
  "i18n/en.json",
  "i18n/fr.json",
  "i18n/ur.json"
]);

export const optionalFirstAidDataAssets = Object.freeze([
  "first-aid/en.json",
  "first-aid/fr.json",
  "first-aid/ur.json"
]);

export const generatedFirstAidAssets = Object.freeze([
  "first-aid/complete-en.html",
  "first-aid/complete-fr.html",
  "first-aid/complete-ur.html"
]);

export const deploymentAssets = Object.freeze(["_headers"]);

export const integrityAssets = Object.freeze([
  ...signatureAssets,
  ...trustAssets
]);

export const staticAssets = Object.freeze([
  "manifest.webmanifest",
  "icons.svg",
  "ui-icons.svg",
  ...directoryAssets,
  ...mapBootstrapAssets,
  ...optionalRegionAssets,
  ...updateManifestAssets,
  ...updateDeltaAssets,
  ...optionalLocaleAssets,
  ...optionalFirstAidDataAssets,
  ...signatureAssets,
  ...trustAssets
]);

export const deployableAssets = Object.freeze([...new Set([
  ...coreAssets,
  ...optionalLocaleAssets,
  ...optionalFirstAidDataAssets,
  ...generatedFirstAidAssets,
  ...optionalRegionAssets,
  ...updateManifestAssets,
  ...updateDeltaAssets,
  ...signatureAssets,
  ...trustAssets,
  ...deploymentAssets
])]);

export const initialAssets = Object.freeze([...coreAssets]);

export const coreOfflineAssets = Object.freeze([...coreAssets]);

export const serviceWorkerPrecacheAssets = Object.freeze([
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./icons.svg",
  "./ui-icons.svg",
  "./directory.json",
  "./directory.json.sig.json",
  "./bootstrap.json",
  "./bootstrap.json.sig.json",
  ...trustAssets.map((asset) => `./${asset}`)
]);

export const serviceWorkerRuntimeAssets = Object.freeze(
  optionalLocaleAssets.map((asset) => `./${asset}`)
);

export const serviceWorkerInstallableAssets = Object.freeze(
  optionalFirstAidDataAssets.map((asset) => `./${asset}`)
);

export const serviceWorkerRegionAssets = Object.freeze(
  baseRegionAssets.map((asset) => `./${asset}`)
);

export const optionalFirstAidAssets = Object.freeze([
  ...optionalFirstAidDataAssets,
  ...generatedFirstAidAssets
]);

export const budgets = Object.freeze({
  initialBrotliBytes: 200 * 1024,
  coreOfflineBrotliBytes: 300 * 1024,
  hardLimitBrotliBytes: 500 * 1024,
  javascriptBrotliBytes: 80 * 1024,
  cssBrotliBytes: 30 * 1024,
  directoryBrotliBytes: 20 * 1024,
  mapAllBrotliBytes: 40 * 1024,
  mapSingleBrotliBytes: 20 * 1024,
  updateAllBrotliBytes: 40 * 1024,
  updateDeltaSingleBrotliBytes: 5 * 1024,
  integrityAllBrotliBytes: 20 * 1024,
  firstAidAllBrotliBytes: 150 * 1024,
  firstAidSingleBrotliBytes: 50 * 1024
});
