import { generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
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
