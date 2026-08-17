import { readFile } from "node:fs/promises";
import path from "node:path";
import { encodeBase64url, sha256Base64url, signatureStatement } from "../shared/integrity.js";

export function requireInstant(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO-8601 UTC instant without milliseconds`);
  }
  return value;
}

export async function loadExternalPrivateKey(projectRoot, configuredPath, expectedPublicJwk) {
  if (!configuredPath) throw new Error("A private JWK path is required");
  const resolvedPath = path.resolve(configuredPath);
  const relative = path.relative(projectRoot, resolvedPath);
  if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
    throw new Error("Private signing keys must be stored outside the project workspace");
  }
  const jwk = JSON.parse(await readFile(resolvedPath, "utf8"));
  if (jwk?.kty !== "EC" || jwk.crv !== "P-256" || typeof jwk.d !== "string" || jwk.x !== expectedPublicJwk.x || jwk.y !== expectedPublicJwk.y) {
    throw new Error("Private key does not match the configured P-256 public key");
  }
  return crypto.subtle.importKey("jwk", { ...jwk, key_ops: ["sign"], ext: false }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

export async function createSignedEnvelope({ artifactPath, bytes, expiresAt, issuedAt, keyId, privateKey, sequence }) {
  const envelope = {
    schema_version: 1,
    bundle_id: "hc-artifact-signature",
    algorithm: "ECDSA_P256_SHA256",
    key_id: keyId,
    artifact_path: artifactPath,
    sequence,
    issued_at: issuedAt,
    expires_at: expiresAt,
    sha256: await sha256Base64url(bytes),
    signature: ""
  };
  envelope.signature = encodeBase64url(new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    new TextEncoder().encode(signatureStatement(envelope))
  )));
  return envelope;
}
