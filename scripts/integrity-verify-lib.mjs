import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateTrustKeyring, verifyArtifact, verifyEnvelopeWithJwk } from "../shared/integrity.js";
import { signedArtifacts } from "./integrity-config.mjs";

export async function verifySignedAssetSet(sourceRoot, rootConfigPath, now = new Date()) {
  const root = JSON.parse(await readFile(rootConfigPath, "utf8"));
  const keyringBytes = new Uint8Array(await readFile(path.join(sourceRoot, "trust", "keyring.json")));
  const keyringEnvelope = JSON.parse(await readFile(path.join(sourceRoot, "trust", "keyring.json.sig.json"), "utf8"));
  await verifyEnvelopeWithJwk({ bytes: keyringBytes, envelope: keyringEnvelope, expectedPath: "trust/keyring.json", publicJwk: root.public_jwk, expectedKeyId: root.key_id, minimumSequence: 1, now });
  const keyring = validateTrustKeyring(JSON.parse(new TextDecoder().decode(keyringBytes)));
  if (keyring.revision !== keyringEnvelope.sequence) throw new Error("Keyring revision and signature sequence differ");
  for (const artifact of signedArtifacts) {
    const bytes = new Uint8Array(await readFile(path.join(sourceRoot, artifact.path)));
    const envelope = JSON.parse(await readFile(path.join(sourceRoot, `${artifact.path}.sig.json`), "utf8"));
    const verified = await verifyArtifact({ bytes, envelope, expectedPath: artifact.path, keyring, minimumSequence: artifact.sequence, now });
    if (verified.sequence !== artifact.sequence) throw new Error(`Unexpected signed sequence for ${artifact.path}`);
  }
  return { artifactCount: signedArtifacts.length, keyring, root };
}
