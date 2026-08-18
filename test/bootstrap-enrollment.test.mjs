import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createBootstrapCeremony, validateBootstrapConfiguration } from "../operator-api/src/bootstrap-enrollment.mjs";
import { openOperatorStore } from "../operator-api/src/store.mjs";
import { validateAuditJournal } from "../operator-api/src/security-core.mjs";

const token = "a".repeat(48);
const tokenDigest = createHash("sha256").update(token).digest("hex");
const grants = [{ actions: ["REVOKE_ACCOUNT"], regions: ["*"], categories: ["*"] }];

function workspace() {
  const directory = mkdtempSync(path.join(tmpdir(), "hc-bootstrap-"));
  return { database: path.join(directory, "store.db"), cleanup: () => rmSync(directory, { force: true, recursive: true }) };
}

function authenticator(overrides = {}) {
  return {
    async createRegistrationOptions({ challenge }) {
      return { challenge, rp: { id: "operators.helpconnect.test" } };
    },
    async verifyRegistration({ response, challenge }) {
      if (response?.proof !== `valid:${challenge}`) return { verified: false };
      return {
        verified: true,
        backedUp: false,
        deviceType: "singleDevice",
        credential: { id: overrides.credentialId ?? "credential-physical-key", public_key: "cHVibGljLWtleQ", counter: 0, transports: ["usb"], status: "ACTIVE" }
      };
    }
  };
}

function ceremony(store, options = {}) {
  return createBootstrapCeremony({
    authenticator: options.authenticator ?? authenticator(),
    store,
    now: options.now ?? (() => Date.parse("2026-08-18T10:00:00Z")),
    configuration: {
      tokenDigest,
      expiresAt: options.expiresAt ?? "2026-08-18T11:00:00Z",
      operatorId: "security-admin",
      displayName: "Security Admin",
      grants
    }
  });
}

async function enrol(subject) {
  const started = await subject.beginEnrollment({ token });
  return subject.completeEnrollment({ token, flowId: started.flow_id, requestId: "req-bootstrap", response: { proof: `valid:${started.options.challenge}` } });
}

test("a successful ceremony writes operator, passkey, consumption and audit atomically", async () => {
  const space = workspace();
  const store = openOperatorStore({ databasePath: space.database });
  try {
    const result = await enrol(ceremony(store));
    assert.equal(result.operator_id, "security-admin");

    const operators = store.readOperators();
    assert.equal(operators.length, 1);
    assert.equal(operators[0].status, "ACTIVE");
    assert.equal(operators[0].credentials[0].id, "credential-physical-key");
    assert.deepEqual(operators[0].grants, grants);

    const events = store.readAuditEvents();
    assert.equal(events.length, 1);
    assert.equal(events[0].action, "BOOTSTRAP_ENROLLMENT");
    assert.equal(events[0].previous_hash, "GENESIS");
    assert.doesNotThrow(() => validateAuditJournal(events));
    assert.equal(store.readBootstrapCeremonies().length, 1);
  } finally {
    store.close();
    space.cleanup();
  }
});

test("the token cannot be reused, even after a restart", async () => {
  const space = workspace();
  const first = openOperatorStore({ databasePath: space.database });
  await enrol(ceremony(first));
  first.close();

  // Nouveau processus, nouvelle instance : l'usage unique doit venir du store,
  // pas d'un etat en memoire.
  const reopened = openOperatorStore({ databasePath: space.database });
  try {
    await assert.rejects(() => enrol(ceremony(reopened)), /BOOTSTRAP_ALREADY_CONSUMED|BOOTSTRAP_OPERATOR_EXISTS/);
    assert.equal(reopened.readOperators().length, 1);
    assert.equal(reopened.readAuditEvents().length, 1);
  } finally {
    reopened.close();
    space.cleanup();
  }
});

test("a wrong token is rejected without revealing ceremony state", async () => {
  const space = workspace();
  const store = openOperatorStore({ databasePath: space.database });
  try {
    const subject = ceremony(store);
    await assert.rejects(() => subject.beginEnrollment({ token: "b".repeat(48) }), /BOOTSTRAP_TOKEN_INVALID/);
    await assert.rejects(() => subject.beginEnrollment({ token: "short" }), /BOOTSTRAP_TOKEN_INVALID/);
    assert.equal(store.readOperators().length, 0);
  } finally {
    store.close();
    space.cleanup();
  }
});

test("an expired ceremony refuses to start", async () => {
  const space = workspace();
  const store = openOperatorStore({ databasePath: space.database });
  try {
    const subject = ceremony(store, { now: () => Date.parse("2026-08-18T12:00:00Z") });
    await assert.rejects(() => subject.beginEnrollment({ token }), /BOOTSTRAP_EXPIRED/);
  } finally {
    store.close();
    space.cleanup();
  }
});

test("a failed attestation leaves no operator, no audit event and no consumption", async () => {
  const space = workspace();
  const store = openOperatorStore({ databasePath: space.database });
  try {
    const subject = ceremony(store);
    const started = await subject.beginEnrollment({ token });
    await assert.rejects(
      () => subject.completeEnrollment({ token, flowId: started.flow_id, requestId: "req", response: { proof: "forged" } }),
      /BOOTSTRAP_ATTESTATION_INVALID/
    );
    assert.equal(store.readOperators().length, 0);
    assert.equal(store.readAuditEvents().length, 0);
    assert.equal(store.readBootstrapCeremonies().length, 0);
  } finally {
    store.close();
    space.cleanup();
  }
});

test("a replayed flow id cannot enrol a second passkey", async () => {
  const space = workspace();
  const store = openOperatorStore({ databasePath: space.database });
  try {
    const subject = ceremony(store);
    const started = await subject.beginEnrollment({ token });
    await subject.completeEnrollment({ token, flowId: started.flow_id, requestId: "req", response: { proof: `valid:${started.options.challenge}` } });
    await assert.rejects(
      () => subject.completeEnrollment({ token, flowId: started.flow_id, requestId: "req", response: { proof: `valid:${started.options.challenge}` } }),
      /BOOTSTRAP_ALREADY_CONSUMED|BOOTSTRAP_OPERATOR_EXISTS/
    );
    assert.equal(store.readOperators().length, 1);
  } finally {
    store.close();
    space.cleanup();
  }
});

test("the configuration contract rejects unusable bootstrap settings", () => {
  const base = { tokenDigest, expiresAt: "2026-08-18T11:00:00Z", operatorId: "security-admin", displayName: "Security Admin", grants };
  assert.doesNotThrow(() => validateBootstrapConfiguration(base));
  assert.throws(() => validateBootstrapConfiguration({ ...base, tokenDigest: "not-a-digest" }), /SHA-256/);
  assert.throws(() => validateBootstrapConfiguration({ ...base, expiresAt: "never" }), /instant/);
  assert.throws(() => validateBootstrapConfiguration({ ...base, operatorId: "Bad Id" }), /operator id/);
  assert.throws(() => validateBootstrapConfiguration({ ...base, grants: [] }), /grants/);
});
