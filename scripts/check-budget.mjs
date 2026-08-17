import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { budgets, coreOfflineAssets, deployableAssets, directoryAssets, initialAssets, integrityAssets, optionalFirstAidAssets, optionalRegionAssets, optionalUpdateAssets, updateDeltaAssets } from "./build-config.mjs";
import { assertBudgets, compressedSizes, evaluateBudgets, sumAssets } from "./budget-lib.mjs";
import { listRelativeFiles } from "./file-inventory.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "dist");
const reportDirectory = path.join(projectRoot, "reports");
const discoveredAssets = await listRelativeFiles(outputDirectory);

const unexpectedAssets = discoveredAssets.filter((name) => !deployableAssets.includes(name));
const missingAssets = deployableAssets.filter((name) => !discoveredAssets.includes(name));

if (unexpectedAssets.length > 0 || missingAssets.length > 0) {
  throw new Error(`Invalid dist inventory. Missing: ${missingAssets.join(", ") || "none"}; unexpected: ${unexpectedAssets.join(", ") || "none"}`);
}

const assets = await Promise.all(discoveredAssets.map(async (name) => ({
  name,
  ...compressedSizes(await readFile(path.join(outputDirectory, name)))
})));

const javascriptAssets = assets.filter((asset) => asset.name.endsWith(".js")).map((asset) => asset.name);
const cssAssets = assets.filter((asset) => asset.name.endsWith(".css")).map((asset) => asset.name);
const firstAidAssetRows = assets.filter((asset) => optionalFirstAidAssets.includes(asset.name));
const regionAssetRows = assets.filter((asset) => optionalRegionAssets.includes(asset.name));
const updateDeltaAssetRows = assets.filter((asset) => updateDeltaAssets.includes(asset.name));
const allBrotliBytes = sumAssets(assets, discoveredAssets);
const metrics = {
  initialBrotliBytes: sumAssets(assets, initialAssets),
  coreOfflineBrotliBytes: sumAssets(assets, coreOfflineAssets),
  hardLimitBrotliBytes: Math.max(
    sumAssets(assets, initialAssets),
    sumAssets(assets, coreOfflineAssets),
    allBrotliBytes
  ),
  javascriptBrotliBytes: sumAssets(assets, javascriptAssets),
  cssBrotliBytes: sumAssets(assets, cssAssets),
  directoryBrotliBytes: sumAssets(assets, directoryAssets),
  mapAllBrotliBytes: sumAssets(assets, optionalRegionAssets),
  mapSingleBrotliBytes: Math.max(...regionAssetRows.map((asset) => asset.brotliBytes)),
  updateAllBrotliBytes: sumAssets(assets, optionalUpdateAssets),
  updateDeltaSingleBrotliBytes: Math.max(...updateDeltaAssetRows.map((asset) => asset.brotliBytes)),
  integrityAllBrotliBytes: sumAssets(assets, integrityAssets),
  firstAidAllBrotliBytes: sumAssets(assets, optionalFirstAidAssets),
  firstAidSingleBrotliBytes: Math.max(...firstAidAssetRows.map((asset) => asset.brotliBytes)),
  allRawBytes: assets.reduce((total, asset) => total + asset.rawBytes, 0),
  allGzipBytes: assets.reduce((total, asset) => total + asset.gzipBytes, 0),
  allBrotliBytes
};
const checks = evaluateBudgets(metrics, budgets);
const report = {
  generatedAt: new Date().toISOString(),
  compression: {
    gzipLevel: 9,
    brotliQuality: 11,
    kibibyte: 1024
  },
  assetGroups: {
    initial: initialAssets,
    coreOffline: coreOfflineAssets,
    directory: directoryAssets,
    mapOptional: optionalRegionAssets,
    updatesOptional: optionalUpdateAssets,
    integrity: integrityAssets,
    firstAidOptional: optionalFirstAidAssets
  },
  assets,
  metrics,
  budgets,
  checks
};

await mkdir(reportDirectory, { recursive: true });
await writeFile(path.join(reportDirectory, "weight-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");

console.table(assets.map((asset) => ({
  asset: asset.name,
  raw: asset.rawBytes,
  gzip: asset.gzipBytes,
  brotli: asset.brotliBytes
})));
console.table(checks.map((check) => ({
  budget: check.name,
  actual: check.actual,
  limit: check.limit,
  status: check.passed ? "PASS" : "FAIL"
})));

assertBudgets(checks);
