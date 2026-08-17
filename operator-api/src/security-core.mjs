import { createHash, randomBytes as systemRandomBytes, timingSafeEqual } from "node:crypto";
import { transitionRecord } from "../../scripts/publication-workflow.mjs";
import { validateOperatorOrigin } from "./config-validation.mjs";

const actions = Object.freeze(["READ", "EDIT", "VALIDATE", "PUBLISH", "REVOKE_ACCOUNT"]);
const categories = Object.freeze(["water", "hospital", "food", "shelter", "first-aid", "generator"]);
const sessionIdleMs = 15 * 60 * 1000;
const sessionAbsoluteMs = 8 * 60 * 60 * 1000;
const challengeLifetimeMs = 5 * 60 * 1000;
const rateWindowMs = 5 * 60 * 1000;
const rateBlockMs = 15 * 60 * 1000;
const maximumFailures = 5;
const maximumRateEntries = 10_000;

export class SecurityError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.name = "SecurityError";
    this.status = status;
    this.code = code;
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected) {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}

function boundedText(value, maximum, label) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) throw new Error(`Invalid ${label}`);
  return value;
}

function hash(value) {
  return createHash("sha256").update(value).digest("base64url");
}

function constantTimeDigestEqual(value, expectedDigest) {
  const a = Buffer.from(hash(value));
  const b = Buffer.from(expectedDigest);
  return a.length === b.length && timingSafeEqual(a, b);
}

function clone(value) {
  return structuredClone(value);
}

function validateOperators(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 1_000) throw new Error("Invalid operator registry");
  const operatorIds = new Set();
  const credentialIds = new Set();
  return input.map((operator) => {
    if (!isRecord(operator) || !exactKeys(operator, ["credentials", "display_name", "grants", "id", "status"]) || !["ACTIVE", "REVOKED"].includes(operator.status)) throw new Error("Invalid operator");
    const id = boundedText(operator.id, 80, "operator id");
    if (operatorIds.has(id)) throw new Error("Duplicate operator id");
    operatorIds.add(id);
    boundedText(operator.display_name, 120, "display name");
    if (!Array.isArray(operator.credentials) || operator.credentials.length < 1 || operator.credentials.length > 10) throw new Error("Invalid credential count");
    const credentials = operator.credentials.map((credential) => {
      if (!isRecord(credential) || !exactKeys(credential, ["counter", "id", "public_key", "status", "transports"]) || !["ACTIVE", "REVOKED"].includes(credential.status)) throw new Error("Invalid credential");
      const credentialId = boundedText(credential.id, 1024, "credential id");
      if (credentialIds.has(credentialId)) throw new Error("Duplicate credential id");
      credentialIds.add(credentialId);
      boundedText(credential.public_key, 4096, "credential public key");
      if (!Number.isSafeInteger(credential.counter) || credential.counter < 0 || !Array.isArray(credential.transports) || credential.transports.some((item) => typeof item !== "string" || item.length > 30)) throw new Error("Invalid credential metadata");
      return clone(credential);
    });
    if (!Array.isArray(operator.grants) || operator.grants.length < 1 || operator.grants.length > 50) throw new Error("Invalid operator grants");
    const grants = operator.grants.map((grant) => {
      if (!isRecord(grant) || !exactKeys(grant, ["actions", "categories", "regions"]) || !Array.isArray(grant.actions) || !Array.isArray(grant.categories) || !Array.isArray(grant.regions)) throw new Error("Invalid grant");
      if (grant.actions.length < 1 || grant.actions.some((action) => !actions.includes(action))) throw new Error("Invalid grant action");
      if (grant.categories.length < 1 || grant.categories.some((category) => category !== "*" && !categories.includes(category))) throw new Error("Invalid grant category");
      if (grant.regions.length < 1 || grant.regions.some((region) => typeof region !== "string" || region.length < 1 || region.length > 60)) throw new Error("Invalid grant region");
      return clone(grant);
    });
    return { ...clone(operator), credentials, grants };
  });
}

function grantAllows(grant, action, region, category) {
  if (!grant.actions.includes(action)) return false;
  if (action === "REVOKE_ACCOUNT") return grant.regions.includes("*") && grant.categories.includes("*");
  return typeof region === "string" && typeof category === "string"
    && (grant.regions.includes("*") || grant.regions.includes(region))
    && (grant.categories.includes("*") || grant.categories.includes(category));
}

export function createSecurityService(configuration) {
  if (!isRecord(configuration) || typeof configuration.authenticator?.createOptions !== "function" || typeof configuration.authenticator?.verify !== "function") throw new Error("Missing WebAuthn adapter");
  const expectedOrigin = validateOperatorOrigin(configuration.expectedOrigin).origin;
  const now = typeof configuration.now === "function" ? configuration.now : () => Date.now();
  const randomBytes = typeof configuration.randomBytes === "function" ? configuration.randomBytes : systemRandomBytes;
  const operators = validateOperators(configuration.operators);
  const operatorById = new Map(operators.map((operator) => [operator.id, operator]));
  const credentialOwners = new Map();
  for (const operator of operators) for (const credential of operator.credentials) credentialOwners.set(credential.id, { operator, credential });
  const challenges = new Map();
  const sessions = new Map();
  const rateEntries = new Map();
  const auditEvents = [];
  const rateSalt = randomBytes(32).toString("base64url");
  let previousAuditHash = configuration.auditSeed?.hash ?? "GENESIS";
  let auditSequence = configuration.auditSeed?.sequence ?? 0;

  function randomToken(bytes = 32) {
    return randomBytes(bytes).toString("base64url");
  }

  function appendAudit(event) {
    const base = {
      sequence: auditSequence += 1,
      at: new Date(now()).toISOString(),
      request_id: boundedText(event.requestId, 100, "request id"),
      actor_id: event.actorId ?? null,
      action: boundedText(event.action, 80, "audit action"),
      outcome: event.outcome,
      target: event.target ?? null,
      reason: event.reason ?? null,
      previous_hash: previousAuditHash
    };
    const next = { ...base, hash: hash(JSON.stringify(base)) };
    previousAuditHash = next.hash;
    auditEvents.push(next);
    configuration.auditSink?.(clone(next));
  }

  function rateKey(ip) {
    return hash(`${rateSalt}\0${boundedText(ip, 200, "client address")}`);
  }

  function rateEntry(ip) {
    const key = rateKey(ip);
    const current = rateEntries.get(key);
    const timestamp = now();
    if (current?.blockedUntil > timestamp) return { key, entry: current };
    if (!current || timestamp - current.windowStartedAt >= rateWindowMs) {
      const next = { failures: 0, windowStartedAt: timestamp, blockedUntil: 0 };
      rateEntries.set(key, next);
      if (rateEntries.size > maximumRateEntries) rateEntries.delete(rateEntries.keys().next().value);
      return { key, entry: next };
    }
    return { key, entry: current };
  }

  function enforceRateLimit(ip) {
    const { entry } = rateEntry(ip);
    if (entry.blockedUntil > now()) throw new SecurityError(429, "AUTH_RATE_LIMITED");
  }

  function recordFailure(ip) {
    const { entry } = rateEntry(ip);
    entry.failures += 1;
    if (entry.failures >= maximumFailures) entry.blockedUntil = now() + rateBlockMs;
  }

  function clearFailures(ip) {
    rateEntries.delete(rateKey(ip));
  }

  function activeSession(token) {
    if (typeof token !== "string" || token.length < 32) throw new SecurityError(401, "AUTH_REQUIRED");
    const digest = hash(token);
    const session = sessions.get(digest);
    if (!session) throw new SecurityError(401, "AUTH_REQUIRED");
    const timestamp = now();
    const operator = operatorById.get(session.operatorId);
    if (!operator || operator.status !== "ACTIVE" || timestamp >= session.absoluteExpiresAt || timestamp - session.lastSeenAt >= sessionIdleMs) {
      sessions.delete(digest);
      throw new SecurityError(401, "SESSION_EXPIRED");
    }
    session.lastSeenAt = timestamp;
    return { digest, session, operator };
  }

  async function beginAuthentication({ ip, requestId }) {
    enforceRateLimit(ip);
    const flowId = randomToken(24);
    const challenge = randomToken(32);
    challenges.set(hash(flowId), { challenge, expiresAt: now() + challengeLifetimeMs });
    if (challenges.size > 10_000) challenges.delete(challenges.keys().next().value);
    const options = await configuration.authenticator.createOptions(challenge);
    appendAudit({ requestId, action: "AUTHENTICATION_BEGIN", outcome: "ALLOW" });
    return { flow_id: flowId, options };
  }

  async function completeAuthentication({ flowId, response, ip, requestId }) {
    enforceRateLimit(ip);
    const challengeKey = hash(typeof flowId === "string" ? flowId : "invalid");
    const flow = challenges.get(challengeKey);
    challenges.delete(challengeKey);
    let credentialRateIdentity;
    try {
      if (!flow || now() >= flow.expiresAt || !isRecord(response)) throw new Error("Invalid authentication flow");
      const credentialId = boundedText(response.id, 1024, "asserted credential id");
      credentialRateIdentity = `credential:${credentialId}`;
      enforceRateLimit(credentialRateIdentity);
      const owner = credentialOwners.get(credentialId);
      if (!owner || owner.operator.status !== "ACTIVE" || owner.credential.status !== "ACTIVE") throw new Error("Inactive credential");
      const verification = await configuration.authenticator.verify({ response, challenge: flow.challenge, credential: clone(owner.credential) });
      if (!verification?.verified || !Number.isSafeInteger(verification.newCounter) || verification.newCounter < owner.credential.counter) throw new Error("Invalid assertion");
      owner.credential.counter = verification.newCounter;
      clearFailures(ip);
      clearFailures(credentialRateIdentity);
      const token = randomToken(32);
      const csrfToken = randomToken(32);
      const timestamp = now();
      sessions.set(hash(token), {
        operatorId: owner.operator.id,
        csrfDigest: hash(csrfToken),
        createdAt: timestamp,
        lastSeenAt: timestamp,
        absoluteExpiresAt: timestamp + sessionAbsoluteMs
      });
      appendAudit({ requestId, actorId: owner.operator.id, action: "AUTHENTICATION_COMPLETE", outcome: "ALLOW" });
      return {
        session_token: token,
        csrf_token: csrfToken,
        operator: { id: owner.operator.id, display_name: owner.operator.display_name, grants: clone(owner.operator.grants) },
        expires_at: new Date(timestamp + sessionAbsoluteMs).toISOString()
      };
    } catch {
      recordFailure(ip);
      if (credentialRateIdentity) recordFailure(credentialRateIdentity);
      appendAudit({ requestId, action: "AUTHENTICATION_COMPLETE", outcome: "DENY", reason: "INVALID_ASSERTION" });
      throw new SecurityError(401, "AUTHENTICATION_FAILED");
    }
  }

  function sessionView(token) {
    const { operator, session } = activeSession(token);
    const csrfToken = randomToken(32);
    session.csrfDigest = hash(csrfToken);
    return {
      operator: { id: operator.id, display_name: operator.display_name, grants: clone(operator.grants) },
      expires_at: new Date(session.absoluteExpiresAt).toISOString(),
      csrf_token: csrfToken
    };
  }

  function authorizeMutation({ token, csrfToken, origin, action, region, category, requestId, target }) {
    const { operator } = activeSession(token);
    const baseAudit = { requestId, actorId: operator.id, action, target };
    if (origin !== expectedOrigin || typeof csrfToken !== "string") {
      appendAudit({ ...baseAudit, outcome: "DENY", reason: "CSRF_ORIGIN" });
      throw new SecurityError(403, "REQUEST_FORBIDDEN");
    }
    const session = sessions.get(hash(token));
    if (!session || !constantTimeDigestEqual(csrfToken, session.csrfDigest)) {
      appendAudit({ ...baseAudit, outcome: "DENY", reason: "CSRF_TOKEN" });
      throw new SecurityError(403, "REQUEST_FORBIDDEN");
    }
    if (!actions.includes(action) || !operator.grants.some((grant) => grantAllows(grant, action, region, category))) {
      appendAudit({ ...baseAudit, outcome: "DENY", reason: "SCOPE" });
      throw new SecurityError(403, "NOT_AUTHORIZED");
    }
    return operator;
  }

  function mutateRecord({ token, csrfToken, origin, record, event, context = {}, requestId }) {
    const permissionByEvent = { SUBMIT_FOR_REVIEW: "EDIT", VALIDATE: "VALIDATE", PUBLISH: "PUBLISH", REVALIDATE: "EDIT" };
    const action = permissionByEvent[event];
    if (!action || !isRecord(record)) throw new SecurityError(400, "INVALID_MUTATION");
    const operator = authorizeMutation({ token, csrfToken, origin, action, region: record.region, category: record.category, requestId, target: record.id });
    try {
      const next = transitionRecord(record, event, { ...context, actor_id: operator.id, at: new Date(now()).toISOString().replace(".000Z", "Z") });
      appendAudit({ requestId, actorId: operator.id, action, outcome: "ALLOW", target: record.id });
      return next;
    } catch (error) {
      appendAudit({ requestId, actorId: operator.id, action, outcome: "DENY", target: record.id, reason: "WORKFLOW" });
      throw new SecurityError(409, "WORKFLOW_REJECTED", error instanceof Error ? error.message : "Workflow rejected");
    }
  }

  function readableRecords({ token, records, requestId }) {
    const { operator } = activeSession(token);
    if (!Array.isArray(records)) throw new SecurityError(400, "INVALID_RECORDS");
    const allowed = records.filter((record) => isRecord(record) && operator.grants.some((grant) => grantAllows(grant, "READ", record.region, record.category)));
    appendAudit({ requestId, actorId: operator.id, action: "READ", outcome: "ALLOW", target: `${allowed.length}_RECORDS` });
    return clone(allowed);
  }

  function revokeOperator({ token, csrfToken, origin, targetOperatorId, requestId }) {
    const actor = authorizeMutation({ token, csrfToken, origin, action: "REVOKE_ACCOUNT", region: null, category: null, requestId, target: targetOperatorId });
    if (actor.id === targetOperatorId) throw new SecurityError(409, "SELF_REVOCATION_FORBIDDEN");
    const target = operatorById.get(targetOperatorId);
    if (!target) throw new SecurityError(404, "OPERATOR_NOT_FOUND");
    configuration.revocationSink?.({ at: new Date(now()).toISOString(), actor_id: actor.id, kind: "OPERATOR", target_id: targetOperatorId });
    target.status = "REVOKED";
    for (const credential of target.credentials) credential.status = "REVOKED";
    for (const [digest, session] of sessions) if (session.operatorId === targetOperatorId) sessions.delete(digest);
    appendAudit({ requestId, actorId: actor.id, action: "REVOKE_ACCOUNT", outcome: "ALLOW", target: targetOperatorId });
  }

  function revokeCredential({ token, csrfToken, origin, credentialId, requestId }) {
    const owner = credentialOwners.get(credentialId);
    if (!owner) throw new SecurityError(404, "CREDENTIAL_NOT_FOUND");
    const actor = authorizeMutation({ token, csrfToken, origin, action: "REVOKE_ACCOUNT", region: null, category: null, requestId, target: owner.operator.id });
    if (actor.id === owner.operator.id) throw new SecurityError(409, "SELF_REVOCATION_FORBIDDEN");
    configuration.revocationSink?.({ at: new Date(now()).toISOString(), actor_id: actor.id, kind: "CREDENTIAL", target_id: credentialId });
    owner.credential.status = "REVOKED";
    for (const [digest, session] of sessions) if (session.operatorId === owner.operator.id) sessions.delete(digest);
    appendAudit({ requestId, actorId: actor.id, action: "REVOKE_CREDENTIAL", outcome: "ALLOW", target: owner.operator.id });
  }

  function logout({ token, csrfToken, origin, requestId }) {
    const { digest, operator, session } = activeSession(token);
    if (origin !== expectedOrigin || typeof csrfToken !== "string" || !constantTimeDigestEqual(csrfToken, session.csrfDigest)) throw new SecurityError(403, "REQUEST_FORBIDDEN");
    sessions.delete(digest);
    appendAudit({ requestId, actorId: operator.id, action: "LOGOUT", outcome: "ALLOW" });
  }

  return {
    beginAuthentication,
    completeAuthentication,
    logout,
    mutateRecord,
    readableRecords,
    revokeCredential,
    revokeOperator,
    sessionView,
    auditEvents: () => clone(auditEvents),
    activeSessionCount: () => sessions.size
  };
}

export function sessionCookie(token, maximumAgeSeconds = 8 * 60 * 60) {
  return `__Host-hc_operator=${token}; Path=/; Max-Age=${maximumAgeSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

export function clearSessionCookie() {
  return "__Host-hc_operator=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict";
}

export function validateAuditJournal(events) {
  if (!Array.isArray(events) || events.length > 1_000_000) throw new Error("Invalid audit journal");
  let expectedSequence = 1;
  let previousHash = "GENESIS";
  for (const event of events) {
    if (!isRecord(event) || !exactKeys(event, ["action", "actor_id", "at", "hash", "outcome", "previous_hash", "reason", "request_id", "sequence", "target"])) throw new Error("Invalid audit event envelope");
    if (event.sequence !== expectedSequence || event.previous_hash !== previousHash) throw new Error("Broken audit journal sequence");
    if (!Number.isFinite(Date.parse(event.at)) || !["ALLOW", "DENY"].includes(event.outcome)) throw new Error("Invalid audit event metadata");
    boundedText(event.request_id, 100, "request id");
    boundedText(event.action, 80, "audit action");
    for (const field of ["actor_id", "target", "reason"]) if (event[field] !== null && (typeof event[field] !== "string" || event[field].length > 200)) throw new Error("Invalid audit event field");
    const base = {
      sequence: event.sequence,
      at: event.at,
      request_id: event.request_id,
      actor_id: event.actor_id,
      action: event.action,
      outcome: event.outcome,
      target: event.target,
      reason: event.reason,
      previous_hash: event.previous_hash
    };
    if (event.hash !== hash(JSON.stringify(base))) throw new Error("Invalid audit event hash");
    previousHash = event.hash;
    expectedSequence += 1;
  }
  return events;
}

export function validateRevocationJournal(events) {
  if (!Array.isArray(events) || events.length > 100_000) throw new Error("Invalid revocation journal");
  for (const event of events) {
    if (!isRecord(event) || !exactKeys(event, ["actor_id", "at", "kind", "target_id"])) throw new Error("Invalid revocation event envelope");
    if (!Number.isFinite(Date.parse(event.at)) || !["OPERATOR", "CREDENTIAL"].includes(event.kind)) throw new Error("Invalid revocation event metadata");
    boundedText(event.actor_id, 80, "revocation actor");
    boundedText(event.target_id, 1024, "revocation target");
  }
  return events;
}

export const operatorActions = actions;
export const securityDurations = Object.freeze({ challengeLifetimeMs, rateBlockMs, rateWindowMs, sessionAbsoluteMs, sessionIdleMs });
