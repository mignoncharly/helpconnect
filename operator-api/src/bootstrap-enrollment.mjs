// Ceremonie d'enrolement bootstrap : lie UNE passkey physique a UN operateur
// predefini, une seule fois.
//
// Contraintes de conception :
//   - l'identite de l'operateur et ses habilitations viennent de la
//     configuration du service, jamais de la requete HTTP. Le client ne peut
//     donc pas choisir qui il devient ni ce qu'il obtient ;
//   - l'usage unique est PERSISTE dans le store, pas garde en memoire : un
//     redemarrage ne reouvre pas la fenetre ;
//   - operateur, passkey, consommation du jeton et evenement d'audit sont
//     ecrits dans une seule transaction ;
//   - aucune route n'existe si le mode bootstrap n'est pas configure.
//
// La restriction par adresse IP n'est PAS faite ici : le proxy ne transmet
// deliberement pas l'adresse du client, pour respecter le contrat de
// minimisation. Elle est appliquee en amont, dans la configuration du proxy.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { auditEventHash } from "./security-core.mjs";

const challengeLifetimeMs = 120_000;

function digest(value) {
  return createHash("sha256").update(value).digest();
}

function constantTimeEquals(candidate, expectedDigest) {
  const a = digest(candidate);
  const b = Buffer.from(expectedDigest, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validateBootstrapConfiguration(input) {
  if (!input || typeof input !== "object") throw new Error("Invalid bootstrap configuration");
  const { tokenDigest, expiresAt, operatorId, displayName, grants } = input;
  if (typeof tokenDigest !== "string" || !/^[a-f0-9]{64}$/.test(tokenDigest)) throw new Error("Bootstrap token digest must be a SHA-256 hex digest");
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) throw new Error("Bootstrap expiry must be an instant");
  if (typeof operatorId !== "string" || !/^[a-z0-9][a-z0-9-]{1,78}[a-z0-9]$/.test(operatorId)) throw new Error("Invalid bootstrap operator id");
  if (typeof displayName !== "string" || displayName.length < 1 || displayName.length > 120) throw new Error("Invalid bootstrap display name");
  if (!Array.isArray(grants) || grants.length < 1) throw new Error("Bootstrap grants are required");
  return Object.freeze({ displayName, expiresAt: expiry, grants, operatorId, tokenDigest });
}

export function createBootstrapCeremony({ authenticator, store, configuration, now = Date.now }) {
  const settings = validateBootstrapConfiguration(configuration);
  const flows = new Map();

  function assertUsable(token) {
    if (typeof token !== "string" || token.length < 32 || token.length > 200) throw new Error("BOOTSTRAP_TOKEN_INVALID");
    if (now() >= settings.expiresAt) throw new Error("BOOTSTRAP_EXPIRED");
    if (!constantTimeEquals(token, settings.tokenDigest)) throw new Error("BOOTSTRAP_TOKEN_INVALID");
    if (store.isBootstrapTokenConsumed(settings.tokenDigest)) throw new Error("BOOTSTRAP_ALREADY_CONSUMED");
    if (store.readOperators().some((operator) => operator.id === settings.operatorId)) throw new Error("BOOTSTRAP_OPERATOR_EXISTS");
  }

  return {
    status() {
      return Object.freeze({
        consumed: store.isBootstrapTokenConsumed(settings.tokenDigest),
        expired: now() >= settings.expiresAt,
        operatorId: settings.operatorId
      });
    },

    async beginEnrollment({ token }) {
      assertUsable(token);
      const flowId = randomBytes(24).toString("base64url");
      const challenge = randomBytes(32).toString("base64url");
      flows.clear();
      flows.set(createHash("sha256").update(flowId).digest("hex"), { challenge, expiresAt: now() + challengeLifetimeMs });
      const options = await authenticator.createRegistrationOptions({
        challenge,
        displayName: settings.displayName,
        operatorId: settings.operatorId
      });
      return { flow_id: flowId, options };
    },

    async completeEnrollment({ token, flowId, response, requestId }) {
      assertUsable(token);
      const key = createHash("sha256").update(typeof flowId === "string" ? flowId : "invalid").digest("hex");
      const flow = flows.get(key);
      flows.delete(key);
      if (!flow || now() >= flow.expiresAt) throw new Error("BOOTSTRAP_FLOW_INVALID");

      const verification = await authenticator.verifyRegistration({ response, challenge: flow.challenge });
      if (!verification?.verified) throw new Error("BOOTSTRAP_ATTESTATION_INVALID");

      const operator = {
        id: settings.operatorId,
        display_name: settings.displayName,
        status: "ACTIVE",
        credentials: [verification.credential],
        grants: settings.grants
      };

      // Tout-ou-rien : operateur, consommation du jeton et audit ensemble.
      // Si l'insertion du jeton echoue parce qu'il a deja servi, l'operateur
      // n'est pas cree non plus.
      const at = new Date(now()).toISOString();
      store.transaction((tx) => {
        tx.putOperator(operator);
        tx.consumeBootstrapToken({ at, operatorId: settings.operatorId, tokenDigest: settings.tokenDigest });
        const head = tx.auditHead();
        const base = {
          sequence: head.sequence + 1,
          at,
          request_id: requestId,
          actor_id: settings.operatorId,
          action: "BOOTSTRAP_ENROLLMENT",
          outcome: "ALLOW",
          target: verification.credential.id,
          reason: null,
          previous_hash: head.hash
        };
        tx.appendAudit({ ...base, hash: auditEventHash(base) });
      });

      return {
        credential_id: verification.credential.id,
        device_type: verification.deviceType,
        operator_id: settings.operatorId
      };
    }
  };
}
