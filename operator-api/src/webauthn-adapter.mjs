import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { validateOperatorBoundaryConfiguration } from "./config-validation.mjs";

export function createWebAuthnAdapter({ rpId, expectedOrigin }) {
  const validated = validateOperatorBoundaryConfiguration({ rpId, expectedOrigin });
  return {
    async createOptions(challenge) {
      return generateAuthenticationOptions({
        rpID: validated.rpId,
        challenge,
        timeout: 60_000,
        userVerification: "required"
      });
    },
    // Ceremonie d'enrolement : utilisee uniquement par le mode bootstrap, jamais
    // par une route permanente. La cle resident et la verification utilisateur
    // sont exigees pour qu'une passkey physique soit obligatoire.
    async createRegistrationOptions({ challenge, operatorId, displayName, excludeCredentialIds = [] }) {
      return generateRegistrationOptions({
        rpID: validated.rpId,
        rpName: "HELP CONNECT operators",
        userName: operatorId,
        userDisplayName: displayName,
        challenge,
        timeout: 120_000,
        attestationType: "none",
        excludeCredentials: excludeCredentialIds.map((id) => ({ id })),
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required"
        }
      });
    },
    async verifyRegistration({ response, challenge }) {
      const verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: validated.expectedOrigin,
        expectedRPID: validated.rpId,
        requireUserVerification: true
      });
      if (!verification.verified) return { verified: false };
      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
      return {
        verified: true,
        backedUp: credentialBackedUp,
        deviceType: credentialDeviceType,
        credential: {
          id: credential.id,
          public_key: Buffer.from(credential.publicKey).toString("base64url"),
          counter: credential.counter,
          transports: Array.isArray(credential.transports) ? [...credential.transports] : [],
          status: "ACTIVE"
        }
      };
    },
    async verify({ response, challenge, credential }) {
      const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: validated.expectedOrigin,
        expectedRPID: validated.rpId,
        requireUserVerification: true,
        credential: {
          id: credential.id,
          publicKey: new Uint8Array(Buffer.from(credential.public_key, "base64url")),
          counter: credential.counter,
          transports: credential.transports
        }
      });
      return {
        verified: verification.verified,
        newCounter: verification.authenticationInfo.newCounter
      };
    }
  };
}
