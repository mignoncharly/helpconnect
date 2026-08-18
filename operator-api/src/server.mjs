import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { createSecurityService, clearSessionCookie, SecurityError, sessionCookie } from "./security-core.mjs";
import { openOperatorStore } from "./store.mjs";
import { createBootstrapCeremony } from "./bootstrap-enrollment.mjs";
import { createWebAuthnAdapter } from "./webauthn-adapter.mjs";
import { validateOperatorBoundaryConfiguration } from "./config-validation.mjs";
import { validatePrivateRecord } from "../../scripts/publication-workflow.mjs";
import { operatorApiHeaders } from "../../shared/security-headers.js";

const boundary = validateOperatorBoundaryConfiguration({
  expectedOrigin: requiredEnvironment("HC_OPERATOR_ORIGIN"),
  rpId: requiredEnvironment("HC_WEBAUTHN_RP_ID")
});
const { expectedOrigin, rpId } = boundary;
const storePath = requiredEnvironment("HC_STORE_PATH");
const port = Number.parseInt(process.env.HC_OPERATOR_PORT ?? "8443", 10);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error("Invalid private API configuration");

// ADR-013 : l'ouverture du store revalide integralement le journal d'audit,
// pas seulement son dernier evenement. Une chaine rompue empeche le demarrage.
const store = openOperatorStore({ databasePath: storePath });
store.verifyIntegrity();

const operators = store.readOperators();
applyPersistedRevocations(operators, store.readRevocations());
const recordIds = new Set();
const records = new Map(store.readRecords().map((record) => {
  validatePrivateRecord(record);
  if (recordIds.has(record.id)) throw new Error("Duplicate private record id");
  recordIds.add(record.id);
  return [record.id, structuredClone(record)];
}));
const authenticator = createWebAuthnAdapter({ rpId, expectedOrigin });
const auditHead = store.auditHead();

// Mode bootstrap : actif uniquement si la configuration est fournie. Sans elle,
// aucune route d'enrolement n'existe. Retirer ces variables de l'environnement
// suffit donc a supprimer la ceremonie, sans redeploiement de code.
const bootstrapDigestFile = process.env.HC_BOOTSTRAP_TOKEN_DIGEST_FILE;
const bootstrap = bootstrapDigestFile
  ? createBootstrapCeremony({
      authenticator,
      store,
      configuration: {
        tokenDigest: readFileSync(bootstrapDigestFile, "utf8").trim(),
        expiresAt: requiredEnvironment("HC_BOOTSTRAP_EXPIRES_AT"),
        operatorId: requiredEnvironment("HC_BOOTSTRAP_OPERATOR_ID"),
        displayName: requiredEnvironment("HC_BOOTSTRAP_DISPLAY_NAME"),
        grants: JSON.parse(requiredEnvironment("HC_BOOTSTRAP_GRANTS"))
      }
    })
  : undefined;

// Une operation de securite peut emettre une revocation ET son evenement
// d'audit. Les deux sinks sont appeles separement par le service, donc on les
// tamponne et on les ecrit dans UNE transaction : sans cela, un arret entre les
// deux laisserait une revocation sans trace d'audit.
let pendingEvents = null;

function collectPersistentEvent(kind, event) {
  if (pendingEvents === null) throw new Error("Persistent event emitted outside a unit of work");
  pendingEvents.push({ event, kind });
}

function flushPendingEvents(buffered) {
  if (buffered.length === 0) return;
  store.transaction((tx) => {
    for (const item of buffered) {
      if (item.kind === "AUDIT") tx.appendAudit(item.event);
      else if (item.kind === "RECORD") tx.putRecord(item.event);
      else tx.appendRevocation(item.event);
    }
  });
}

async function unitOfWork(work) {
  if (pendingEvents !== null) throw new Error("Nested units of work are not supported");
  pendingEvents = [];
  let outcome;
  try {
    outcome = { value: await work() };
  } catch (error) {
    outcome = { error };
  }
  const buffered = pendingEvents;
  pendingEvents = null;
  // Les refus produisent eux aussi des evenements d'audit : ils doivent etre
  // ecrits meme quand l'operation echoue.
  flushPendingEvents(buffered);
  if (outcome.error) throw outcome.error;
  return outcome.value;
}
// Le registre vide est refuse par createSecurityService, a juste titre. Mais la
// ceremonie d'enrolement existe precisement pour ce cas : sans cette exception,
// l'API ne pourrait jamais demarrer pour creer son premier operateur.
// Registre vide + bootstrap actif => seules les routes d'enrolement repondent.
if (operators.length === 0 && !bootstrap) throw new Error("Empty operator registry and no bootstrap ceremony configured");
const security = operators.length === 0 ? undefined : createSecurityService({
  authenticator,
  expectedOrigin,
  operators,
  auditSeed: auditHead.sequence > 0 ? auditHead : undefined,
  auditSink(event) {
    collectPersistentEvent("AUDIT", event);
  },
  revocationSink(event) {
    collectPersistentEvent("REVOCATION", event);
  }
});

const server = createServer(async (request, response) => {
  const requestId = randomBytes(12).toString("base64url");
  setSecurityHeaders(response, requestId);
  try {
    // Toute la requete est une unite de travail : les evenements persistants
    // qu'elle emet sont ecrits ensemble, dans une seule transaction.
    await unitOfWork(async () => {
      const requestTarget = request.url ?? "/";
      if (!requestTarget.startsWith("/") || requestTarget.startsWith("//")) throw new SecurityError(400, "INVALID_REQUEST_TARGET");
      const url = new URL(requestTarget, expectedOrigin);
      if (url.origin !== expectedOrigin || url.search || url.hash) throw new SecurityError(400, "INVALID_REQUEST_TARGET");
      const method = request.method ?? "GET";
      const token = readCookie(request.headers.cookie, "__Host-hc_operator");
      const csrfToken = singleHeader(request.headers["x-csrf-token"]);
      const origin = singleHeader(request.headers.origin);

      if (method === "POST" && origin !== expectedOrigin) throw new SecurityError(403, "REQUEST_FORBIDDEN");

      if (url.pathname.startsWith("/v1/bootstrap/")) {
        if (!bootstrap) throw new SecurityError(404, "NOT_FOUND");
        const body = await jsonBody(request);
        try {
          if (method === "POST" && url.pathname === "/v1/bootstrap/options") {
            requireExactBody(body, ["token"]);
            return sendJson(response, 200, await bootstrap.beginEnrollment({ token: body.token }));
          }
          if (method === "POST" && url.pathname === "/v1/bootstrap/verify") {
            requireExactBody(body, ["flow_id", "response", "token"]);
            const result = await bootstrap.completeEnrollment({ flowId: body.flow_id, requestId, response: body.response, token: body.token });
            return sendJson(response, 201, result);
          }
        } catch (error) {
          if (error instanceof SecurityError) throw error;
          const code = typeof error?.message === "string" && error.message.startsWith("BOOTSTRAP_") ? error.message : "BOOTSTRAP_FAILED";
          throw new SecurityError(code === "BOOTSTRAP_FLOW_INVALID" ? 400 : 403, code);
        }
        throw new SecurityError(404, "NOT_FOUND");
      }
      // Hors ceremonie, aucune route ne repond tant qu'aucun operateur n'existe.
      if (!security) throw new SecurityError(503, "OPERATOR_REGISTRY_EMPTY");
      if (method === "POST" && url.pathname === "/v1/auth/options") {
        const body = await jsonBody(request);
        requireExactBody(body, []);
        const result = await security.beginAuthentication({ ip: rateLimitIdentity(request), requestId });
        return sendJson(response, 200, result);
      }
      if (method === "POST" && url.pathname === "/v1/auth/verify") {
        const body = await jsonBody(request);
        requireExactBody(body, ["flow_id", "response"]);
        const result = await security.completeAuthentication({ flowId: body.flow_id, response: body.response, ip: rateLimitIdentity(request), requestId });
        response.setHeader("Set-Cookie", sessionCookie(result.session_token));
        return sendJson(response, 200, { csrf_token: result.csrf_token, expires_at: result.expires_at, operator: result.operator });
      }
      if (method === "GET" && url.pathname === "/v1/session") {
        return sendJson(response, 200, security.sessionView(token));
      }
      if (method === "GET" && url.pathname === "/v1/records") {
        return sendJson(response, 200, { records: security.readableRecords({ token, records: [...records.values()], requestId }) });
      }
      if (method === "POST" && url.pathname === "/v1/logout") {
        const body = await jsonBody(request);
        requireExactBody(body, []);
        security.logout({ token, csrfToken, origin, requestId });
        response.setHeader("Set-Cookie", clearSessionCookie());
        return sendJson(response, 204, undefined);
      }
      const transitionMatch = url.pathname.match(/^\/v1\/records\/([a-z0-9-]{1,60})\/transition$/);
      if (method === "POST" && transitionMatch) {
        const record = records.get(transitionMatch[1]);
        if (!record) throw new SecurityError(404, "RECORD_NOT_FOUND");
        const body = await jsonBody(request);
        requireExactBody(body, ["context", "event"]);
        const next = security.mutateRecord({ token, csrfToken, origin, record, event: body.event, context: body.context, requestId });
        records.set(next.id, next);
        collectPersistentEvent("RECORD", next);
        return sendJson(response, 200, { record: next });
      }
      const revokeMatch = url.pathname.match(/^\/v1\/operators\/([a-z0-9-]{1,80})\/revoke$/);
      if (method === "POST" && revokeMatch) {
        const body = await jsonBody(request);
        requireExactBody(body, []);
        security.revokeOperator({ token, csrfToken, origin, targetOperatorId: revokeMatch[1], requestId });
        return sendJson(response, 204, undefined);
      }
      const credentialRevokeMatch = url.pathname.match(/^\/v1\/credentials\/([A-Za-z0-9_-]{1,1024})\/revoke$/);
      if (method === "POST" && credentialRevokeMatch) {
        const body = await jsonBody(request);
        requireExactBody(body, []);
        security.revokeCredential({ token, csrfToken, origin, credentialId: credentialRevokeMatch[1], requestId });
        return sendJson(response, 204, undefined);
      }
      throw new SecurityError(404, "NOT_FOUND");
    });
  } catch (error) {
    const status = error instanceof SecurityError ? error.status : 500;
    const code = error instanceof SecurityError ? error.code : "INTERNAL_ERROR";
    if (status >= 500) console.error(`[${requestId}] private API failure`);
    sendJson(response, status, { error: code, request_id: requestId });
  }
});

server.requestTimeout = 10_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 50;

server.listen(port, "127.0.0.1", () => {
  console.log(`Private operator API listening on loopback:${port}; TLS termination is required upstream`);
  if (bootstrap) {
    const status = bootstrap.status();
    console.log(`BOOTSTRAP ENROLMENT ACTIVE for operator ${status.operatorId} (expired=${status.expired}, consumed=${status.consumed}); disable it once the ceremony is done`);
  }
});

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function applyPersistedRevocations(operators, revocations) {
  const operatorById = new Map(operators.map((operator) => [operator.id, operator]));
  const credentialById = new Map(operators.flatMap((operator) => operator.credentials.map((credential) => [credential.id, credential])));
  for (const event of revocations) {
    if (event.kind === "OPERATOR") {
      const operator = operatorById.get(event.target_id);
      if (operator) {
        operator.status = "REVOKED";
        for (const credential of operator.credentials) credential.status = "REVOKED";
      }
    } else if (event.kind === "CREDENTIAL") {
      const credential = credentialById.get(event.target_id);
      if (credential) credential.status = "REVOKED";
    } else {
      throw new Error("Invalid revocation journal event");
    }
  }
}

function singleHeader(value) {
  return Array.isArray(value) ? value[0] : value;
}

function rateLimitIdentity(request) {
  const value = singleHeader(request.headers["x-hc-rate-key"]);
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(value)) throw new SecurityError(400, "RATE_KEY_REQUIRED");
  return `proxy:${value}`;
}

function requireExactBody(value, keys) {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) throw new SecurityError(400, "INVALID_BODY_ENVELOPE");
}

function readCookie(header, name) {
  if (typeof header !== "string") return undefined;
  for (const item of header.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

async function jsonBody(request) {
  if (request.headers["content-type"]?.split(";", 1)[0] !== "application/json") throw new SecurityError(415, "JSON_REQUIRED");
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 64 * 1024) throw new SecurityError(413, "BODY_TOO_LARGE");
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required");
    return value;
  } catch {
    throw new SecurityError(400, "INVALID_JSON");
  }
}

function setSecurityHeaders(response, requestId) {
  for (const [name, value] of Object.entries(operatorApiHeaders)) response.setHeader(name, value);
  response.setHeader("X-Request-Id", requestId);
}

function sendJson(response, status, value) {
  response.statusCode = status;
  if (value === undefined) return response.end();
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}
