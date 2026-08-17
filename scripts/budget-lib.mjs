import { brotliCompressSync, constants, gzipSync } from "node:zlib";

export function compressedSizes(content) {
  return {
    rawBytes: content.byteLength,
    gzipBytes: gzipSync(content, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(content, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: 11
      }
    }).byteLength
  };
}

export function sumAssets(assetRows, assetNames, sizeKey = "brotliBytes") {
  const uniqueNames = new Set(assetNames);
  return [...uniqueNames].reduce((total, name) => {
    const row = assetRows.find((candidate) => candidate.name === name);
    if (!row) {
      throw new Error(`Cannot measure missing asset: ${name}`);
    }
    return total + row[sizeKey];
  }, 0);
}

export function evaluateBudgets(metrics, limits) {
  const checks = [
    { name: "initial", actual: metrics.initialBrotliBytes, limit: limits.initialBrotliBytes },
    { name: "core-offline", actual: metrics.coreOfflineBrotliBytes, limit: limits.coreOfflineBrotliBytes },
    { name: "hard-limit", actual: metrics.hardLimitBrotliBytes, limit: limits.hardLimitBrotliBytes },
    { name: "javascript", actual: metrics.javascriptBrotliBytes, limit: limits.javascriptBrotliBytes },
    { name: "css", actual: metrics.cssBrotliBytes, limit: limits.cssBrotliBytes },
    { name: "directory", actual: metrics.directoryBrotliBytes, limit: limits.directoryBrotliBytes },
    { name: "map-all", actual: metrics.mapAllBrotliBytes, limit: limits.mapAllBrotliBytes },
    { name: "map-single", actual: metrics.mapSingleBrotliBytes, limit: limits.mapSingleBrotliBytes },
    { name: "update-all", actual: metrics.updateAllBrotliBytes, limit: limits.updateAllBrotliBytes },
    { name: "update-delta-single", actual: metrics.updateDeltaSingleBrotliBytes, limit: limits.updateDeltaSingleBrotliBytes },
    { name: "integrity-all", actual: metrics.integrityAllBrotliBytes, limit: limits.integrityAllBrotliBytes },
    { name: "first-aid-all", actual: metrics.firstAidAllBrotliBytes, limit: limits.firstAidAllBrotliBytes },
    { name: "first-aid-single", actual: metrics.firstAidSingleBrotliBytes, limit: limits.firstAidSingleBrotliBytes }
  ];

  return checks.map((check) => ({
    ...check,
    passed: check.actual <= check.limit
  }));
}

export function assertBudgets(checks) {
  const failed = checks.filter((check) => !check.passed);
  if (failed.length === 0) return;
  const details = failed.map((check) => `${check.name} ${check.actual}/${check.limit}`).join(", ");
  throw new Error(`BUILD FAILED: one or more build budgets were exceeded (${details})`);
}
