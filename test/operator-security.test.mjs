import assert from "node:assert/strict";
import test from "node:test";
import { createDraft } from "../scripts/publication-workflow.mjs";
import { clearSessionCookie, createSecurityService, SecurityError, securityDurations, sessionCookie, validateAuditJournal, validateRevocationJournal } from "../operator-api/src/security-core.mjs";
import { validateOperatorBoundaryConfiguration } from "../operator-api/src/config-validation.mjs";
import { createWebAuthnAdapter } from "../operator-api/src/webauthn-adapter.mjs";

function registry() {
  const credential = (id) => ({ id, public_key: "cHVibGljLWtleQ", counter: 0, transports: ["internal"], status: "ACTIVE" });
  return [
    {
      id: "editor-a", display_name: "Editor A", status: "ACTIVE", credentials: [credential("credential-editor")],
      grants: [{ actions: ["READ", "EDIT"], regions: ["demo-north"], categories: ["water", "food"] }]
    },
    {
      id: "reviewer-b", display_name: "Reviewer B", status: "ACTIVE", credentials: [credential("credential-reviewer")],
      grants: [{ actions: ["READ", "VALIDATE"], regions: ["demo-north"], categories: ["water", "food"] }]
    },
    {
      id: "publisher-c", display_name: "Publisher C", status: "ACTIVE", credentials: [credential("credential-publisher")],
      grants: [{ actions: ["READ", "PUBLISH"], regions: ["demo-north"], categories: ["water", "food"] }]
    },
    {
      id: "security-admin", display_name: "Security Admin", status: "ACTIVE", credentials: [credential("credential-admin")],
      grants: [{ actions: ["REVOKE_ACCOUNT"], regions: ["*"], categories: ["*"] }]
    }
  ];
}

function harness() {
  let clock = Date.parse("2026-08-17T12:00:00Z");
  let randomCounter = 0;
  const authenticator = {
    async createOptions(challenge) {
      return { challenge, rpId: "operators.helpconnect.test", userVerification: "required" };
    },
    async verify({ response, challenge, credential }) {
      return { verified: response.proof === `valid:${challenge}`, newCounter: credential.counter + 1 };
    }
  };
  const service = createSecurityService({
    authenticator,
    expectedOrigin: "https://operators.helpconnect.test",
    operators: registry(),
    now: () => clock,
    randomBytes(size) {
      randomCounter += 1;
      return Buffer.alloc(size, randomCounter % 255 || 1);
    }
  });
  return {
    service,
    advance: (milliseconds) => { clock += milliseconds; },
    async login(credentialId, ip = "192.0.2.1") {
      const begin = await service.beginAuthentication({ ip, requestId: `begin-${randomCounter}` });
      return service.completeAuthentication({
        flowId: begin.flow_id,
        response: { id: credentialId, proof: `valid:${begin.options.challenge}` },
        ip,
        requestId: `finish-${randomCounter}`
      });
    }
  };
}

function draft(region = "demo-north", category = "water") {
  return createDraft({
    id: `record-${region}-${category}`,
    category,
    region,
    coarse_location: { fr: "Zone", en: "Zone", ur: "علاقہ" },
    internal_notes: "Private fixture"
  }, "editor-a", "2026-08-17T11:00:00Z");
}

test("operator cookies are host-only, HttpOnly, Secure and strict", () => {
  const cookie = sessionCookie("opaque-token");
  assert.match(cookie, /^__Host-hc_operator=/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(cookie.includes("Domain="), false);
  assert.match(clearSessionCookie(), /Max-Age=0/);
});

test("the production WebAuthn adapter requests mandatory user verification", async () => {
  const adapter = createWebAuthnAdapter({ rpId: "operators.helpconnect.test", expectedOrigin: "https://operators.helpconnect.test" });
  const options = await adapter.createOptions("MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY");
  assert.equal(options.rpId, "operators.helpconnect.test");
  assert.equal(options.userVerification, "required");
  assert.equal(options.timeout, 60_000);
});

test("operator origin and RP ID configuration is exact and path-free", () => {
  assert.deepEqual(validateOperatorBoundaryConfiguration({ expectedOrigin: "https://operators.helpconnect.test", rpId: "operators.helpconnect.test" }), {
    expectedOrigin: "https://operators.helpconnect.test",
    rpId: "operators.helpconnect.test"
  });
  for (const configuration of [
    { expectedOrigin: "https://operators.helpconnect.test/path", rpId: "operators.helpconnect.test" },
    { expectedOrigin: "https://operators.helpconnect.test.evil", rpId: "operators.helpconnect.test" },
    { expectedOrigin: "https://user@operators.helpconnect.test", rpId: "operators.helpconnect.test" },
    { expectedOrigin: "https://operators.helpconnect.test", rpId: "helpconnect.test" }
  ]) assert.throws(() => validateOperatorBoundaryConfiguration(configuration));
});

test("unknown permissions fail registry validation instead of becoming implicit grants", () => {
  const operators = registry();
  operators[0].grants[0].actions.push("DELETE_EVERYTHING");
  assert.throws(() => createSecurityService({
    authenticator: { createOptions() {}, verify() {} },
    expectedOrigin: "https://operators.helpconnect.test",
    operators
  }), /Invalid grant action/);
});

test("WebAuthn challenges are single-use and assertions issue opaque server sessions", async () => {
  const { service } = harness();
  const begin = await service.beginAuthentication({ ip: "192.0.2.2", requestId: "begin" });
  const response = { id: "credential-editor", proof: `valid:${begin.options.challenge}` };
  const authenticated = await service.completeAuthentication({ flowId: begin.flow_id, response, ip: "192.0.2.2", requestId: "finish" });
  assert.equal(authenticated.operator.id, "editor-a");
  assert.ok(authenticated.session_token.length >= 43);
  assert.ok(authenticated.csrf_token.length >= 43);
  await assert.rejects(
    service.completeAuthentication({ flowId: begin.flow_id, response, ip: "192.0.2.2", requestId: "replay" }),
    (error) => error instanceof SecurityError && error.code === "AUTHENTICATION_FAILED"
  );
});

test("sessions enforce idle and absolute expiration", async () => {
  const idle = harness();
  const idleLogin = await idle.login("credential-editor");
  idle.advance(securityDurations.sessionIdleMs);
  assert.throws(() => idle.service.sessionView(idleLogin.session_token), (error) => error.code === "SESSION_EXPIRED");

  const absolute = harness();
  const absoluteLogin = await absolute.login("credential-editor");
  for (let elapsed = 0; elapsed < securityDurations.sessionAbsoluteMs; elapsed += securityDurations.sessionIdleMs - 1) {
    absolute.advance(Math.min(securityDurations.sessionIdleMs - 1, securityDurations.sessionAbsoluteMs - elapsed - 1));
    absolute.service.sessionView(absoluteLogin.session_token);
  }
  absolute.advance(1);
  assert.throws(() => absolute.service.sessionView(absoluteLogin.session_token), (error) => error.code === "SESSION_EXPIRED");
});

test("region, category and action scopes are checked on every workflow mutation", async () => {
  const { service, login } = harness();
  const editor = await login("credential-editor", "192.0.2.3");
  const reviewer = await login("credential-reviewer", "192.0.2.4");
  const publisher = await login("credential-publisher", "192.0.2.5");
  const origin = "https://operators.helpconnect.test";
  const submitted = service.mutateRecord({ token: editor.session_token, csrfToken: editor.csrf_token, origin, record: draft(), event: "SUBMIT_FOR_REVIEW", requestId: "submit" });
  assert.equal(submitted.workflow_state, "IN_REVIEW");
  assert.throws(() => service.mutateRecord({ token: editor.session_token, csrfToken: editor.csrf_token, origin, record: submitted, event: "VALIDATE", context: { status: "VERIFIED", expires_at: "2026-08-18T12:00:00Z" }, requestId: "editor-validate" }), (error) => error.code === "NOT_AUTHORIZED");
  assert.throws(() => service.mutateRecord({ token: editor.session_token, csrfToken: editor.csrf_token, origin, record: draft("demo-south", "shelter"), event: "SUBMIT_FOR_REVIEW", requestId: "outside-scope" }), (error) => error.code === "NOT_AUTHORIZED");
  const validated = service.mutateRecord({ token: reviewer.session_token, csrfToken: reviewer.csrf_token, origin, record: submitted, event: "VALIDATE", context: { status: "VERIFIED", expires_at: "2026-08-18T12:00:00Z" }, requestId: "validate" });
  const published = service.mutateRecord({ token: publisher.session_token, csrfToken: publisher.csrf_token, origin, record: validated, event: "PUBLISH", requestId: "publish" });
  assert.equal(published.workflow_state, "PUBLISHED");
});

test("CSRF requires both the exact private origin and the in-memory token", async () => {
  const { service, login } = harness();
  const editor = await login("credential-editor");
  const input = { token: editor.session_token, record: draft(), event: "SUBMIT_FOR_REVIEW", requestId: "csrf" };
  assert.throws(() => service.mutateRecord({ ...input, csrfToken: "wrong", origin: "https://operators.helpconnect.test" }), (error) => error.code === "REQUEST_FORBIDDEN");
  assert.throws(() => service.mutateRecord({ ...input, csrfToken: editor.csrf_token, origin: "https://public.helpconnect.test" }), (error) => error.code === "REQUEST_FORBIDDEN");
});

test("read access filters records and does not disclose out-of-scope entries", async () => {
  const { service, login } = harness();
  const editor = await login("credential-editor");
  const visible = service.readableRecords({ token: editor.session_token, records: [draft(), draft("demo-south", "shelter")], requestId: "read" });
  assert.deepEqual(visible.map((record) => record.region), ["demo-north"]);
});

test("revocation immediately destroys sessions and disables every credential", async () => {
  const { service, login } = harness();
  const editor = await login("credential-editor", "192.0.2.7");
  const admin = await login("credential-admin", "192.0.2.8");
  service.revokeOperator({ token: admin.session_token, csrfToken: admin.csrf_token, origin: "https://operators.helpconnect.test", targetOperatorId: "editor-a", requestId: "revoke" });
  assert.equal(service.activeSessionCount(), 1);
  assert.throws(() => service.sessionView(editor.session_token), (error) => error.code === "AUTH_REQUIRED");
  const begin = await service.beginAuthentication({ ip: "192.0.2.7", requestId: "after-revoke-begin" });
  await assert.rejects(service.completeAuthentication({ flowId: begin.flow_id, response: { id: "credential-editor", proof: `valid:${begin.options.challenge}` }, ip: "192.0.2.7", requestId: "after-revoke-finish" }), (error) => error.code === "AUTHENTICATION_FAILED");
});

test("a single credential can be revoked and the decision is persisted before activation", async () => {
  let persisted;
  const service = createSecurityService({
    authenticator: {
      async createOptions(challenge) { return { challenge }; },
      async verify({ response, challenge, credential }) { return { verified: response.proof === `valid:${challenge}`, newCounter: credential.counter + 1 }; }
    },
    expectedOrigin: "https://operators.helpconnect.test",
    operators: registry(),
    revocationSink(event) { persisted = event; }
  });
  const loginWith = async (credentialId, ip) => {
    const begin = await service.beginAuthentication({ ip, requestId: `begin-${ip}` });
    return service.completeAuthentication({ flowId: begin.flow_id, response: { id: credentialId, proof: `valid:${begin.options.challenge}` }, ip, requestId: `finish-${ip}` });
  };
  const editor = await loginWith("credential-editor", "192.0.2.20");
  const admin = await loginWith("credential-admin", "192.0.2.21");
  service.revokeCredential({ token: admin.session_token, csrfToken: admin.csrf_token, origin: "https://operators.helpconnect.test", credentialId: "credential-editor", requestId: "revoke-credential" });
  assert.deepEqual({ kind: persisted.kind, target_id: persisted.target_id }, { kind: "CREDENTIAL", target_id: "credential-editor" });
  assert.throws(() => service.sessionView(editor.session_token));
});

test("five failed assertions trigger a bounded temporary rate limit", async () => {
  const { service } = harness();
  for (let index = 0; index < 5; index += 1) {
    const begin = await service.beginAuthentication({ ip: "192.0.2.9", requestId: `rate-begin-${index}` });
    await assert.rejects(service.completeAuthentication({ flowId: begin.flow_id, response: { id: "credential-editor", proof: "invalid" }, ip: "192.0.2.9", requestId: `rate-finish-${index}` }));
  }
  await assert.rejects(service.beginAuthentication({ ip: "192.0.2.9", requestId: "rate-blocked" }), (error) => error.code === "AUTH_RATE_LIMITED");
});

test("audit records are chained and never contain credentials, cookies or CSRF tokens", async () => {
  const { service, login } = harness();
  const editor = await login("credential-editor");
  service.readableRecords({ token: editor.session_token, records: [draft()], requestId: "audit-read" });
  const events = service.auditEvents();
  assert.equal(events[0].previous_hash, "GENESIS");
  for (let index = 1; index < events.length; index += 1) assert.equal(events[index].previous_hash, events[index - 1].hash);
  const serialized = JSON.stringify(events);
  for (const secret of [editor.session_token, editor.csrf_token, "public_key", "proof", "credential-editor"]) assert.equal(serialized.includes(secret), false, secret);
  assert.equal(validateAuditJournal(events), events);
  const altered = structuredClone(events);
  altered.at(-1).target = "tampered";
  assert.throws(() => validateAuditJournal(altered), /hash/);
});

test("revocation journals reject unknown fields and malformed events", () => {
  const valid = [{ at: "2026-08-17T12:00:00.000Z", actor_id: "security-admin", kind: "CREDENTIAL", target_id: "credential-editor" }];
  assert.equal(validateRevocationJournal(valid), valid);
  assert.throws(() => validateRevocationJournal([{ ...valid[0], public_key: "leak" }]), /envelope/);
  assert.throws(() => validateRevocationJournal([{ ...valid[0], kind: "DELETE_ALL" }]), /metadata/);
});
