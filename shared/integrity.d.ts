export interface SignatureEnvelope { readonly schema_version: 1; readonly bundle_id: "hc-artifact-signature"; readonly algorithm: "ECDSA_P256_SHA256"; readonly key_id: string; readonly artifact_path: string; readonly sequence: number; readonly issued_at: string; readonly expires_at: string; readonly sha256: string; readonly signature: string; }
export interface TrustKeyring { readonly schema_version: 1; readonly bundle_id: "hc-signing-keyring"; readonly revision: number; readonly issued_at: string; readonly expires_at: string; readonly keys: readonly { readonly id: string; readonly algorithm: "ECDSA_P256_SHA256"; readonly status: "ACTIVE" | "RETIRED"; readonly not_before: string; readonly not_after: string; readonly public_jwk: JsonWebKey }[]; readonly revoked_key_ids: readonly string[]; }
export function validateSignatureEnvelope(value: unknown, expectedPath: string): SignatureEnvelope;
export function signatureStatement(envelope: SignatureEnvelope): string;
export function validateTrustKeyring(value: unknown): TrustKeyring;
export function encodeBase64url(bytes: Uint8Array): string;
export function decodeBase64url(value: string): Uint8Array;
export function sha256Base64url(bytes: Uint8Array, cryptoApi?: Crypto): Promise<string>;
export function verifyEnvelopeWithJwk(input: { bytes: Uint8Array; envelope: unknown; expectedPath: string; publicJwk: JsonWebKey; expectedKeyId: string; now?: Date; minimumSequence?: number; cryptoApi?: Crypto }): Promise<SignatureEnvelope>;
export function verifyArtifact(input: { bytes: Uint8Array; envelope: unknown; expectedPath: string; keyring: unknown; now?: Date; minimumSequence?: number; cryptoApi?: Crypto }): Promise<SignatureEnvelope>;
