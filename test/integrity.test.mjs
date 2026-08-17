import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  encodeBase64url,
  sha256Base64url,
  signatureStatement,
  validateTrustKeyring,
  verifyArtifact,
  verifyEnvelopeWithJwk
} from "../shared/integrity.js";
import { verifySignedAssetSet } from "../scripts/integrity-verify-lib.mjs";

const publicRoot = new URL("../public/", import.meta.url);
const rootConfigUrl = new URL("../config/demo-root.public.json", import.meta.url);
const verificationTime = new Date("2026-08-18T12:00:00Z");
const readBytes = async (path) => new Uint8Array(await readFile(new URL(path, publicRoot)));
const readJson = async (path) => JSON.parse(await readFile(new URL(path, publicRoot), "utf8"));

async function fixture() {
  const keyring = validateTrustKeyring(await readJson("trust/keyring.json"));
  const bytes = await readBytes("directory.json");
  const envelope = await readJson("directory.json.sig.json");
  return { bytes, envelope, keyring };
}

test("the complete release verifies from the embedded-root configuration", async () => {
  const result = await verifySignedAssetSet(fileURLToPath(new URL("../public", import.meta.url)), fileURLToPath(rootConfigUrl), verificationTime);
  assert.equal(result.artifactCount, 13);
  assert.equal(result.keyring.revision, 1);
});

test("one altered artifact byte is rejected", async () => {
  const { bytes, envelope, keyring } = await fixture();
  bytes[0] ^= 1;
  await assert.rejects(verifyArtifact({ bytes, envelope, expectedPath: "directory.json", keyring, now: verificationTime }), /digest/i);
});

test("signature tampering and artifact substitution are rejected", async () => {
  const { bytes, envelope, keyring } = await fixture();
  const changedSignature = { ...envelope, signature: `${envelope.signature[0] === "A" ? "B" : "A"}${envelope.signature.slice(1)}` };
  await assert.rejects(verifyArtifact({ bytes, envelope: changedSignature, expectedPath: "directory.json", keyring, now: verificationTime }), /signature/i);
  const substituted = { ...envelope, artifact_path: "bootstrap.json" };
  await assert.rejects(verifyArtifact({ bytes, envelope: substituted, expectedPath: "bootstrap.json", keyring, now: verificationTime }), /signature/i);
});

test("rollback, expiry, and explicit revocation fail closed", async () => {
  const { bytes, envelope, keyring } = await fixture();
  await assert.rejects(verifyArtifact({ bytes, envelope, expectedPath: "directory.json", keyring, minimumSequence: envelope.sequence + 1, now: verificationTime }), /sequence/i);
  await assert.rejects(verifyArtifact({ bytes, envelope, expectedPath: "directory.json", keyring, now: new Date("2032-01-01T00:00:00Z") }), /time window/i);
  const revoked = { ...keyring, revoked_key_ids: [envelope.key_id] };
  await assert.rejects(verifyArtifact({ bytes, envelope, expectedPath: "directory.json", keyring: revoked, now: verificationTime }), /revoked/i);
});

test("a root-signed keyring cannot be altered", async () => {
  const root = JSON.parse(await readFile(rootConfigUrl, "utf8"));
  const bytes = await readBytes("trust/keyring.json");
  const envelope = await readJson("trust/keyring.json.sig.json");
  bytes[bytes.length - 2] ^= 1;
  await assert.rejects(verifyEnvelopeWithJwk({
    bytes,
    envelope,
    expectedPath: "trust/keyring.json",
    publicJwk: root.public_jwk,
    expectedKeyId: root.key_id,
    now: verificationTime
  }), /digest/i);
});

test("a rotated signing key in the trusted keyring verifies new artifacts", async () => {
  const { keyring } = await fixture();
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const rotatedKeyId = "hc-test-data-2027-a";
  const rotatedKeyring = {
    ...keyring,
    keys: [...keyring.keys, {
      id: rotatedKeyId,
      algorithm: "ECDSA_P256_SHA256",
      status: "ACTIVE",
      not_before: "2026-08-17T12:00:00Z",
      not_after: "2031-08-17T12:00:00Z",
      public_jwk: { kty: "EC", crv: "P-256", x: exported.x, y: exported.y, ext: true, key_ops: ["verify"] }
    }]
  };
  const bytes = new TextEncoder().encode("rotated release\n");
  const envelope = {
    schema_version: 1,
    bundle_id: "hc-artifact-signature",
    algorithm: "ECDSA_P256_SHA256",
    key_id: rotatedKeyId,
    artifact_path: "updates/rotation-test.json",
    sequence: 9,
    issued_at: "2026-08-17T12:00:00Z",
    expires_at: "2030-08-17T12:00:00Z",
    sha256: await sha256Base64url(bytes),
    signature: ""
  };
  envelope.signature = encodeBase64url(new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(signatureStatement(envelope))
  )));
  const verified = await verifyArtifact({ bytes, envelope, expectedPath: envelope.artifact_path, keyring: rotatedKeyring, now: verificationTime });
  assert.equal(verified.key_id, rotatedKeyId);
});
