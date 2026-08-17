import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateTrustKeyring } from "../shared/integrity.js";
import { createSignedEnvelope, loadExternalPrivateKey, requireInstant } from "./signing-node-lib.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keyringPath = path.join(projectRoot, "public", "trust", "keyring.json");
const rootConfig = JSON.parse(await readFile(path.join(projectRoot, "config", "demo-root.public.json"), "utf8"));
const keyringBytes = new Uint8Array(await readFile(keyringPath));
const keyring = validateTrustKeyring(JSON.parse(new TextDecoder().decode(keyringBytes)));
const issuedAt = requireInstant(process.env.HC_ROOT_SIGNING_ISSUED_AT ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), "HC_ROOT_SIGNING_ISSUED_AT");
const expiresAt = requireInstant(process.env.HC_ROOT_SIGNING_EXPIRES_AT ?? keyring.expires_at, "HC_ROOT_SIGNING_EXPIRES_AT");
if (Date.parse(expiresAt) <= Date.parse(issuedAt) || expiresAt !== keyring.expires_at) throw new Error("Keyring signature expiry must equal the keyring expiry and follow its issue time");
const privateKey = await loadExternalPrivateKey(projectRoot, process.env.HC_ROOT_SIGNING_PRIVATE_JWK_FILE, rootConfig.public_jwk);
const envelope = await createSignedEnvelope({
  artifactPath: "trust/keyring.json",
  bytes: keyringBytes,
  expiresAt,
  issuedAt,
  keyId: rootConfig.key_id,
  privateKey,
  sequence: keyring.revision
});
await writeFile(`${keyringPath}.sig.json`, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
console.log(`Signed trust keyring revision ${keyring.revision}; no root private key was copied into the workspace.`);
