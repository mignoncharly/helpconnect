import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateTrustKeyring } from "../shared/integrity.js";
import { signedArtifacts } from "./integrity-config.mjs";
import { createSignedEnvelope, loadExternalPrivateKey, requireInstant } from "./signing-node-lib.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(projectRoot, "public");
const keyId = process.env.HC_SIGNING_KEY_ID;
if (!keyId) throw new Error("HC_SIGNING_KEY_ID is required");
const issuedAt = requireInstant(process.env.HC_SIGNING_ISSUED_AT ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), "HC_SIGNING_ISSUED_AT");
const expiresAt = requireInstant(process.env.HC_SIGNING_EXPIRES_AT, "HC_SIGNING_EXPIRES_AT");
const keyring = validateTrustKeyring(JSON.parse(await readFile(path.join(publicRoot, "trust", "keyring.json"), "utf8")));
const signingKey = keyring.keys.find((candidate) => candidate.id === keyId);
if (!signingKey || signingKey.status !== "ACTIVE" || keyring.revoked_key_ids.includes(keyId)) throw new Error("Signing key is not active in the trusted keyring");
if (Date.parse(issuedAt) < Date.parse(signingKey.not_before) || Date.parse(expiresAt) > Date.parse(signingKey.not_after) || Date.parse(expiresAt) > Date.parse(keyring.expires_at) || Date.parse(expiresAt) <= Date.parse(issuedAt)) {
  throw new Error("Release validity is outside the signing key or keyring validity window");
}
const privateKey = await loadExternalPrivateKey(projectRoot, process.env.HC_SIGNING_PRIVATE_JWK_FILE, signingKey.public_jwk);

for (const artifact of signedArtifacts) {
  const bytes = new Uint8Array(await readFile(path.join(publicRoot, artifact.path)));
  const envelope = await createSignedEnvelope({ artifactPath: artifact.path, bytes, expiresAt, issuedAt, keyId, privateKey, sequence: artifact.sequence });
  const destination = path.join(publicRoot, `${artifact.path}.sig.json`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
}

console.log(`Signed ${signedArtifacts.length} public artifacts with ${keyId}; no private key was copied into the workspace.`);
