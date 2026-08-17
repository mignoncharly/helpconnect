const envelopeKeys = Object.freeze(["algorithm", "artifact_path", "bundle_id", "expires_at", "issued_at", "key_id", "schema_version", "sequence", "sha256", "signature"]);
const keyringKeys = Object.freeze(["bundle_id", "expires_at", "issued_at", "keys", "revision", "revoked_key_ids", "schema_version"]);
const signingKeyKeys = Object.freeze(["algorithm", "id", "not_after", "not_before", "public_jwk", "status"]);
const jwkKeys = Object.freeze(["crv", "ext", "key_ops", "kty", "x", "y"]);
const base64urlPattern = /^[A-Za-z0-9_-]+$/;
const artifactPathPattern = /^(?:[a-z0-9][a-z0-9-]*\/)*[a-z0-9][a-z0-9._-]*$/;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function text(value, maximum, label) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) throw new Error(`Invalid ${label}`);
  return value;
}

function instant(value, label) {
  text(value, 30, label);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value) || Number.isNaN(Date.parse(value))) throw new Error(`Invalid ${label}`);
  return value;
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`Invalid ${label}`);
  return value;
}

function validateJwk(value) {
  if (!isRecord(value) || !exactKeys(value, jwkKeys) || value.kty !== "EC" || value.crv !== "P-256" || value.ext !== true || JSON.stringify(value.key_ops) !== JSON.stringify(["verify"])) throw new Error("Invalid P-256 public JWK");
  for (const coordinate of [value.x, value.y]) if (typeof coordinate !== "string" || coordinate.length !== 43 || !base64urlPattern.test(coordinate)) throw new Error("Invalid P-256 coordinate");
  return { kty: "EC", crv: "P-256", x: value.x, y: value.y, ext: true, key_ops: ["verify"] };
}

export function validateSignatureEnvelope(value, expectedPath) {
  if (!isRecord(value) || !exactKeys(value, envelopeKeys) || value.schema_version !== 1 || value.bundle_id !== "hc-artifact-signature" || value.algorithm !== "ECDSA_P256_SHA256") throw new Error("Unsupported signature envelope");
  const artifactPath = text(value.artifact_path, 160, "artifact path");
  if (!artifactPathPattern.test(artifactPath) || artifactPath !== expectedPath) throw new Error("Signature path mismatch");
  const sha256 = text(value.sha256, 43, "artifact digest");
  const signature = text(value.signature, 86, "artifact signature");
  if (!base64urlPattern.test(sha256) || !base64urlPattern.test(signature)) throw new Error("Invalid signature encoding");
  if (Date.parse(value.issued_at) >= Date.parse(value.expires_at)) throw new Error("Invalid signature validity window");
  return {
    schema_version: 1,
    bundle_id: "hc-artifact-signature",
    algorithm: "ECDSA_P256_SHA256",
    key_id: text(value.key_id, 80, "key id"),
    artifact_path: artifactPath,
    sequence: positiveInteger(value.sequence, "artifact sequence"),
    issued_at: instant(value.issued_at, "signature issue time"),
    expires_at: instant(value.expires_at, "signature expiry"),
    sha256,
    signature
  };
}

export function signatureStatement(envelope) {
  return [
    "HELP_CONNECT_ARTIFACT_V1",
    envelope.key_id,
    envelope.artifact_path,
    String(envelope.sequence),
    envelope.issued_at,
    envelope.expires_at,
    envelope.sha256,
    ""
  ].join("\n");
}

export function validateTrustKeyring(value) {
  if (!isRecord(value) || !exactKeys(value, keyringKeys) || value.schema_version !== 1 || value.bundle_id !== "hc-signing-keyring") throw new Error("Unsupported trust keyring");
  const revision = positiveInteger(value.revision, "keyring revision");
  const issuedAt = instant(value.issued_at, "keyring issue time");
  const expiresAt = instant(value.expires_at, "keyring expiry");
  if (Date.parse(issuedAt) >= Date.parse(expiresAt)) throw new Error("Invalid keyring validity window");
  if (!Array.isArray(value.revoked_key_ids) || value.revoked_key_ids.length > 20) throw new Error("Invalid revoked key list");
  const revokedKeyIds = value.revoked_key_ids.map((id) => text(id, 80, "revoked key id"));
  if (new Set(revokedKeyIds).size !== revokedKeyIds.length) throw new Error("Duplicate revoked key id");
  if (!Array.isArray(value.keys) || value.keys.length < 1 || value.keys.length > 5) throw new Error("Invalid signing key count");
  const ids = new Set();
  const keys = value.keys.map((key) => {
    if (!isRecord(key) || !exactKeys(key, signingKeyKeys) || key.algorithm !== "ECDSA_P256_SHA256" || !["ACTIVE", "RETIRED"].includes(key.status)) throw new Error("Invalid signing key");
    const id = text(key.id, 80, "signing key id");
    if (ids.has(id)) throw new Error("Duplicate signing key id");
    ids.add(id);
    const notBefore = instant(key.not_before, "key not-before");
    const notAfter = instant(key.not_after, "key not-after");
    if (Date.parse(notBefore) >= Date.parse(notAfter)) throw new Error("Invalid signing key validity window");
    return { id, algorithm: "ECDSA_P256_SHA256", status: key.status, not_before: notBefore, not_after: notAfter, public_jwk: validateJwk(key.public_jwk) };
  });
  return { schema_version: 1, bundle_id: "hc-signing-keyring", revision, issued_at: issuedAt, expires_at: expiresAt, keys, revoked_key_ids: revokedKeyIds };
}

export function encodeBase64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeBase64url(value) {
  if (typeof value !== "string" || !base64urlPattern.test(value)) throw new Error("Invalid base64url value");
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function sha256Base64url(bytes, cryptoApi = globalThis.crypto) {
  if (!(bytes instanceof Uint8Array) || !cryptoApi?.subtle) throw new Error("Web Crypto unavailable");
  return encodeBase64url(new Uint8Array(await cryptoApi.subtle.digest("SHA-256", bytes)));
}

export async function verifyEnvelopeWithJwk({ bytes, envelope: rawEnvelope, expectedPath, publicJwk, expectedKeyId, now = new Date(), minimumSequence = 0, cryptoApi = globalThis.crypto }) {
  const envelope = validateSignatureEnvelope(rawEnvelope, expectedPath);
  if (envelope.key_id !== expectedKeyId || envelope.sequence < minimumSequence) throw new Error("Signature key or sequence rejected");
  const timestamp = now.getTime();
  if (Date.parse(envelope.issued_at) > timestamp + 5 * 60 * 1000 || timestamp >= Date.parse(envelope.expires_at)) throw new Error("Signature time window rejected");
  if (await sha256Base64url(bytes, cryptoApi) !== envelope.sha256) throw new Error("Artifact digest mismatch");
  const key = await cryptoApi.subtle.importKey("jwk", validateJwk(publicJwk), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const valid = await cryptoApi.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, decodeBase64url(envelope.signature), new TextEncoder().encode(signatureStatement(envelope)));
  if (!valid) throw new Error("Invalid artifact signature");
  return envelope;
}

export async function verifyArtifact({ bytes, envelope, expectedPath, keyring: rawKeyring, now = new Date(), minimumSequence = 0, cryptoApi = globalThis.crypto }) {
  const keyring = validateTrustKeyring(rawKeyring);
  const parsedEnvelope = validateSignatureEnvelope(envelope, expectedPath);
  const timestamp = now.getTime();
  if (Date.parse(keyring.issued_at) > timestamp + 5 * 60 * 1000 || timestamp >= Date.parse(keyring.expires_at)) throw new Error("Trust keyring time window rejected");
  if (keyring.revoked_key_ids.includes(parsedEnvelope.key_id)) throw new Error("Signing key revoked");
  const key = keyring.keys.find((candidate) => candidate.id === parsedEnvelope.key_id);
  if (!key || timestamp < Date.parse(key.not_before) || timestamp >= Date.parse(key.not_after)) throw new Error("Signing key unavailable or expired");
  if (Date.parse(parsedEnvelope.issued_at) < Date.parse(key.not_before) || Date.parse(parsedEnvelope.expires_at) > Date.parse(key.not_after)) throw new Error("Artifact validity exceeds its signing key window");
  return verifyEnvelopeWithJwk({ bytes, envelope: parsedEnvelope, expectedPath, publicJwk: key.public_jwk, expectedKeyId: key.id, now, minimumSequence, cryptoApi });
}
