import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodeBase64url, sha256Base64url, signatureStatement } from "../shared/integrity.js";
import { signedArtifacts } from "./integrity-config.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(projectRoot, "public");
const configurationRoot = path.join(projectRoot, "config");
const issuedAt = "2026-08-17T12:00:00Z";
const artifactExpiresAt = "2030-08-17T12:00:00Z";
const keyringExpiresAt = "2031-08-17T12:00:00Z";
const rootKeyId = "hc-demo-root-2026-a";
const dataKeyId = "hc-demo-data-2026-a";

for (const artifact of signedArtifacts.filter((item) => item.path.startsWith("regions/"))) {
  const artifactPath = path.join(publicRoot, artifact.path);
  const parsed = JSON.parse(await readFile(artifactPath, "utf8"));
  await writeFile(artifactPath, `${JSON.stringify(parsed)}\n`, "utf8");
}

const [rootPair, dataPair] = await Promise.all([
  crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]),
  crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])
]);
const rootPublicJwk = publicJwk(await crypto.subtle.exportKey("jwk", rootPair.publicKey));
const dataPublicJwk = publicJwk(await crypto.subtle.exportKey("jwk", dataPair.publicKey));

await mkdir(configurationRoot, { recursive: true });
await mkdir(path.join(publicRoot, "trust"), { recursive: true });
await writeFile(path.join(configurationRoot, "demo-root.public.json"), `${JSON.stringify({ key_id: rootKeyId, public_jwk: rootPublicJwk }, null, 2)}\n`, "utf8");

const keyring = {
  schema_version: 1,
  bundle_id: "hc-signing-keyring",
  revision: 1,
  issued_at: issuedAt,
  expires_at: keyringExpiresAt,
  keys: [{
    id: dataKeyId,
    algorithm: "ECDSA_P256_SHA256",
    status: "ACTIVE",
    not_before: issuedAt,
    not_after: keyringExpiresAt,
    public_jwk: dataPublicJwk
  }],
  revoked_key_ids: []
};
const keyringContent = `${JSON.stringify(keyring, null, 2)}\n`;
await writeFile(path.join(publicRoot, "trust", "keyring.json"), keyringContent, "utf8");
await writeEnvelope({
  artifactPath: "trust/keyring.json",
  bytes: new TextEncoder().encode(keyringContent),
  expiresAt: keyringExpiresAt,
  keyId: rootKeyId,
  privateKey: rootPair.privateKey,
  sequence: keyring.revision
});

for (const artifact of signedArtifacts) {
  const bytes = new Uint8Array(await readFile(path.join(publicRoot, artifact.path)));
  await writeEnvelope({ artifactPath: artifact.path, bytes, expiresAt: artifactExpiresAt, keyId: dataKeyId, privateKey: dataPair.privateKey, sequence: artifact.sequence });
}

console.log(`Generated demo trust root, keyring and ${signedArtifacts.length} detached signatures. Private keys were discarded.`);

function publicJwk(jwk) {
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true, key_ops: ["verify"] };
}

async function writeEnvelope({ artifactPath, bytes, expiresAt, keyId, privateKey, sequence }) {
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
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, new TextEncoder().encode(signatureStatement(envelope))));
  envelope.signature = encodeBase64url(signature);
  const destination = path.join(publicRoot, `${artifactPath}.sig.json`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
}
