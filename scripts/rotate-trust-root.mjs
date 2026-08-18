import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256Base64url, validateTrustKeyring } from "../shared/integrity.js";
import { requireInstant } from "./signing-node-lib.mjs";

// Genere une nouvelle racine de confiance et une nouvelle cle de donnees.
// Les moities privees sont ecrites hors du workspace, en 0600, et ne sont
// jamais affichees ni journalisees. Le script refuse d'ecraser une cle
// existante : une rotation cree toujours de nouveaux fichiers.
//
//   HC_SIGNING_KEY_DIR=/chemin/hors/depot \
//   node scripts/rotate-trust-root.mjs --confirm-rotation

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const keyringPath = path.join(projectRoot, "public", "trust", "keyring.json");
const rootConfigPath = path.join(projectRoot, "config", "trust-root.public.json");

if (!process.argv.includes("--confirm-rotation")) {
  throw new Error("Refusing to rotate without --confirm-rotation: this replaces the published trust anchor");
}
const keyDirectory = process.env.HC_SIGNING_KEY_DIR;
if (!keyDirectory) throw new Error("HC_SIGNING_KEY_DIR is required");
const resolvedKeyDirectory = path.resolve(keyDirectory);
const relativeToWorkspace = path.relative(projectRoot, resolvedKeyDirectory);
if (!relativeToWorkspace.startsWith("..") && relativeToWorkspace !== "") {
  throw new Error("Private signing keys must be stored outside the project workspace");
}

const issuedAt = requireInstant(process.env.HC_ROTATION_ISSUED_AT ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z"), "HC_ROTATION_ISSUED_AT");
const keyringExpiresAt = requireInstant(process.env.HC_ROTATION_KEYRING_EXPIRES_AT, "HC_ROTATION_KEYRING_EXPIRES_AT");
const rootKeyId = process.env.HC_ROTATION_ROOT_KEY_ID;
const dataKeyId = process.env.HC_ROTATION_DATA_KEY_ID;
for (const [label, value] of [["HC_ROTATION_ROOT_KEY_ID", rootKeyId], ["HC_ROTATION_DATA_KEY_ID", dataKeyId]]) {
  if (!value || !/^[a-z0-9][a-z0-9-]{2,60}[a-z0-9]$/.test(value)) throw new Error(`${label} must be a short lowercase identifier`);
}
if (Date.parse(keyringExpiresAt) <= Date.parse(issuedAt)) throw new Error("The keyring must expire after it is issued");

const previousKeyring = validateTrustKeyring(JSON.parse(await readFile(keyringPath, "utf8")));
const previousRootConfig = await readPreviousRootConfig();
const retiredIds = [...new Set([
  ...previousKeyring.revoked_key_ids,
  ...previousKeyring.keys.map((key) => key.id),
  ...(previousRootConfig ? [previousRootConfig.key_id] : [])
])];
if (retiredIds.includes(rootKeyId) || retiredIds.includes(dataKeyId)) throw new Error("A rotated key id must never reuse a retired one");

await mkdir(resolvedKeyDirectory, { mode: 0o700, recursive: true });
const rootPair = await generate();
const dataPair = await generate();
const rootPrivatePath = await writePrivateKey(rootKeyId, rootPair);
const dataPrivatePath = await writePrivateKey(dataKeyId, dataPair);

const rootPublicJwk = await exportPublicJwk(rootPair);
const dataPublicJwk = await exportPublicJwk(dataPair);
await writeFile(rootConfigPath, `${JSON.stringify({ key_id: rootKeyId, public_jwk: rootPublicJwk }, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });

const keyring = validateTrustKeyring({
  schema_version: 1,
  bundle_id: "hc-signing-keyring",
  revision: previousKeyring.revision + 1,
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
  revoked_key_ids: retiredIds
});
await writeFile(keyringPath, `${JSON.stringify(keyring, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });

console.log([
  `Rotated the trust root to revision ${keyring.revision}.`,
  `  root key   ${rootKeyId}  thumbprint ${await thumbprint(rootPublicJwk)}`,
  `  data key   ${dataKeyId}  thumbprint ${await thumbprint(dataPublicJwk)}`,
  `  revoked    ${retiredIds.join(", ")}`,
  `  private halves written to ${resolvedKeyDirectory} (0600), never printed`,
  "",
  "Next, with the same key directory:",
  `  HC_ROOT_SIGNING_PRIVATE_JWK_FILE=${rootPrivatePath} npm run integrity:sign-keyring`,
  `  HC_SIGNING_KEY_ID=${dataKeyId} HC_SIGNING_PRIVATE_JWK_FILE=${dataPrivatePath} \\`,
  `    HC_SIGNING_EXPIRES_AT=<artifact expiry> npm run integrity:sign-release`
].join("\n"));

async function generate() {
  return crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
}

async function exportPublicJwk(pair) {
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, ext: true, key_ops: ["verify"] };
}

async function writePrivateKey(keyId, pair) {
  const destination = path.join(resolvedKeyDirectory, `${keyId}.private.jwk.json`);
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  await writeFile(destination, `${JSON.stringify({ kty: "EC", crv: "P-256", d: jwk.d, x: jwk.x, y: jwk.y }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return destination;
}

async function thumbprint(publicJwk) {
  const canonical = JSON.stringify({ crv: publicJwk.crv, kty: publicJwk.kty, x: publicJwk.x, y: publicJwk.y });
  return (await sha256Base64url(new TextEncoder().encode(canonical))).slice(0, 16);
}

async function readPreviousRootConfig() {
  for (const candidate of ["trust-root.public.json", "demo-root.public.json"]) {
    try {
      return JSON.parse(await readFile(path.join(projectRoot, "config", candidate), "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return undefined;
}
