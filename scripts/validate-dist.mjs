import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { deployableAssets } from "./build-config.mjs";
import { validateDirectoryBundle } from "./directory-schema.mjs";
import { validateMapBootstrap, validateMapRegion } from "./map-schema.mjs";
import { validateMapDelta, validateUpdateManifest } from "./update-schema.mjs";
import { listRelativeFiles } from "./file-inventory.mjs";
import { verifySignedAssetSet } from "./integrity-verify-lib.mjs";
import { publicMetaCsp, renderPublicStaticHeaders, standaloneFirstAidMetaCsp } from "../shared/security-headers.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "dist");
const files = await listRelativeFiles(outputDirectory);
await verifySignedAssetSet(outputDirectory, path.join(projectRoot, "config", "trust-root.public.json"));

const expected = [...deployableAssets].sort();
if (JSON.stringify(files) !== JSON.stringify(expected)) {
  throw new Error(`Unexpected dist inventory: ${files.join(", ")}`);
}

const textAssets = files.filter((name) => /\.(?:html|css|js|svg|webmanifest)$/.test(name));
for (const name of textAssets) {
  const content = await readFile(path.join(outputDirectory, name), "utf8");
  if (/\bhttps?:\/\/(?!www\.w3\.org\/2000\/svg(?:\b|["']))/i.test(content)) {
    throw new Error(`External URL found in dist/${name}`);
  }
  if (/sourceMappingURL/.test(content)) {
    throw new Error(`Public source map reference found in dist/${name}`);
  }
}

const html = await readFile(path.join(outputDirectory, "index.html"), "utf8");
const staticHeaders = await readFile(path.join(outputDirectory, "_headers"), "utf8");
if (staticHeaders !== renderPublicStaticHeaders()) throw new Error("Public deployment headers differ from the canonical security policy");
if (!html.includes(`<meta http-equiv="Content-Security-Policy" content="${publicMetaCsp}">`)) throw new Error("Public HTML CSP fallback differs from the canonical policy");
if (/unsafe-(?:inline|eval)|\bhttps?:\/\//i.test(publicMetaCsp)) throw new Error("Public document CSP contains an unsafe or external source");
const directory = validateDirectoryBundle(JSON.parse(await readFile(path.join(outputDirectory, "directory.json"), "utf8")));
const directoryIds = new Set(directory.points.map((point) => point.id));
const bootstrap = validateMapBootstrap(JSON.parse(await readFile(path.join(outputDirectory, "bootstrap.json"), "utf8")));
for (const region of bootstrap.regions) {
  const baseRegion = validateMapRegion(JSON.parse(await readFile(path.join(outputDirectory, region.path), "utf8")), region.id, directoryIds);
  if (baseRegion.datasetVersion !== region.baseVersion) throw new Error(`Base version mismatch for ${region.id}`);
}
const updateManifest = validateUpdateManifest(
  JSON.parse(await readFile(path.join(outputDirectory, "updates", "index.json"), "utf8")),
  new Set(bootstrap.regions.map((region) => region.id))
);
for (const updateRegion of updateManifest.regions) {
  const snapshot = validateMapRegion(JSON.parse(await readFile(path.join(outputDirectory, updateRegion.snapshotPath), "utf8")), updateRegion.regionId, directoryIds);
  if (snapshot.datasetVersion !== updateRegion.currentVersion) throw new Error(`Snapshot version mismatch for ${updateRegion.regionId}`);
  for (const delta of updateRegion.deltas) {
    validateMapDelta(JSON.parse(await readFile(path.join(outputDirectory, delta.path), "utf8")), updateRegion.regionId, delta.from, delta.to);
  }
}
for (const reference of ["styles.css", "app.js", "manifest.webmanifest", "icons.svg"]) {
  if (!html.includes(`./${reference}`)) {
    throw new Error(`index.html does not reference ${reference}`);
  }
}

for (const locale of ["fr", "en", "ur"]) {
  const exportHtml = await readFile(path.join(outputDirectory, "first-aid", `complete-${locale}.html`), "utf8");
  if (/<script\b|<link\b|\s(?:src|href)\s*=/i.test(exportHtml)) {
    throw new Error(`Standalone ${locale} first-aid export contains a network-capable element`);
  }
  if (!exportHtml.includes("REVIEW_REQUIRED")) {
    throw new Error(`Standalone ${locale} first-aid export omits its review status`);
  }
  if (!exportHtml.includes(`<meta http-equiv="Content-Security-Policy" content="${standaloneFirstAidMetaCsp}">`)) throw new Error(`Standalone ${locale} first-aid export has a divergent CSP`);
}

console.log("Validated dist inventory, canonical deployment headers, local-only references, and source-map policy");
