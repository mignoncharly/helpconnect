import path from "node:path";
import { fileURLToPath } from "node:url";
import { verifySignedAssetSet } from "./integrity-verify-lib.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = process.argv[2] ? path.resolve(process.argv[2]) : path.join(projectRoot, "public");
const result = await verifySignedAssetSet(sourceRoot, path.join(projectRoot, "config", "trust-root.public.json"));
console.log(`Verified root-signed keyring and ${result.artifactCount} signed artifacts in ${sourceRoot}`);
