import { rm, mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { buildFirstAidExports } from "./build-first-aid.mjs";
import { validateDirectoryBundle } from "./directory-schema.mjs";
import { validateMapBootstrap, validateMapRegion } from "./map-schema.mjs";
import { validateMapDelta, validateUpdateManifest } from "./update-schema.mjs";
import { verifySignedAssetSet } from "./integrity-verify-lib.mjs";
import { renderPublicStaticHeaders } from "../shared/security-headers.js";
import {
  serviceWorkerPrecacheAssets,
  serviceWorkerInstallableAssets,
  serviceWorkerRegionAssets,
  serviceWorkerRuntimeAssets,
  staticAssets
} from "./build-config.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "dist");
const rootConfigPath = path.join(projectRoot, "config", "trust-root.public.json");

const trust = await verifySignedAssetSet(path.join(projectRoot, "public"), rootConfigPath);

const directory = validateDirectoryBundle(JSON.parse(await readFile(path.join(projectRoot, "public", "directory.json"), "utf8")));
const directoryIds = new Set(directory.points.map((point) => point.id));
const mapBootstrap = validateMapBootstrap(JSON.parse(await readFile(path.join(projectRoot, "public", "bootstrap.json"), "utf8")));
for (const region of mapBootstrap.regions) {
  const baseRegion = validateMapRegion(JSON.parse(await readFile(path.join(projectRoot, "public", region.path), "utf8")), region.id, directoryIds);
  if (baseRegion.datasetVersion !== region.baseVersion) throw new Error(`Base version mismatch for ${region.id}`);
}
const updateManifest = validateUpdateManifest(
  JSON.parse(await readFile(path.join(projectRoot, "public", "updates", "index.json"), "utf8")),
  new Set(mapBootstrap.regions.map((region) => region.id))
);
for (const updateRegion of updateManifest.regions) {
  const snapshot = validateMapRegion(JSON.parse(await readFile(path.join(projectRoot, "public", updateRegion.snapshotPath), "utf8")), updateRegion.regionId, directoryIds);
  if (snapshot.datasetVersion !== updateRegion.currentVersion) throw new Error(`Snapshot version mismatch for ${updateRegion.regionId}`);
  for (const delta of updateRegion.deltas) {
    validateMapDelta(JSON.parse(await readFile(path.join(projectRoot, "public", delta.path), "utf8")), updateRegion.regionId, delta.from, delta.to);
  }
}

if (outputDirectory !== path.resolve(projectRoot, "dist")) {
  throw new Error("Refusing to clean an unexpected output directory");
}

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

const commonBuildOptions = {
  bundle: true,
  charset: "utf8",
  legalComments: "none",
  minify: true,
  sourcemap: false,
  target: ["es2020"]
};

await Promise.all([
  build({
    ...commonBuildOptions,
    entryPoints: [path.join(projectRoot, "src", "app.ts")],
    define: {
      __ROOT_KEY_ID__: JSON.stringify(trust.root.key_id),
      __ROOT_PUBLIC_JWK__: JSON.stringify(trust.root.public_jwk)
    },
    format: "esm",
    outfile: path.join(outputDirectory, "app.js"),
    platform: "browser"
  }),
  build({
    bundle: true,
    entryPoints: [path.join(projectRoot, "src", "styles.css")],
    legalComments: "none",
    minify: true,
    outfile: path.join(outputDirectory, "styles.css"),
    sourcemap: false
  })
]);

const sourceHtml = await readFile(path.join(projectRoot, "src", "index.html"), "utf8");
const minifiedHtml = sourceHtml
  .replace(/<!--(?!\!)[\s\S]*?-->/g, "")
  .replace(/>\s+</g, "><")
  .trim();

await writeFile(path.join(outputDirectory, "index.html"), `${minifiedHtml}\n`, "utf8");
await writeFile(path.join(outputDirectory, "_headers"), renderPublicStaticHeaders(), "utf8");
await Promise.all(staticAssets.map(async (asset) => {
  const destination = path.join(outputDirectory, asset);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(projectRoot, "public", asset), destination);
}));
await buildFirstAidExports(projectRoot, outputDirectory, ["fr", "en", "ur"]);

const shellHash = createHash("sha256");
for (const asset of [...serviceWorkerPrecacheAssets, ...serviceWorkerRuntimeAssets, ...serviceWorkerInstallableAssets, ...serviceWorkerRegionAssets]) {
  const assetName = asset.replace(/^\.\//, "");
  shellHash.update(assetName);
  shellHash.update(await readFile(path.join(outputDirectory, assetName)));
}
const cacheName = `hc-shell-${shellHash.digest("hex").slice(0, 12)}`;

await build({
  ...commonBuildOptions,
  define: {
    __CACHE_NAME__: JSON.stringify(cacheName),
    __PRECACHE_ASSETS__: JSON.stringify(serviceWorkerPrecacheAssets),
    __INSTALLABLE_ASSETS__: JSON.stringify(serviceWorkerInstallableAssets),
    __REGION_ASSETS__: JSON.stringify(serviceWorkerRegionAssets),
    __RUNTIME_ASSETS__: JSON.stringify(serviceWorkerRuntimeAssets)
  },
  entryPoints: [path.join(projectRoot, "src", "sw.ts")],
  format: "iife",
  outfile: path.join(outputDirectory, "service-worker.js"),
  platform: "browser"
});

console.log(`Built ${outputDirectory} with cache ${cacheName}`);
