import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditEventHash } from "../operator-api/src/security-core.mjs";
import { createDraft } from "../scripts/publication-workflow.mjs";
import { openOperatorStore } from "../operator-api/src/store.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storeModule = path.join(projectRoot, "operator-api", "src", "store.mjs");

function workspace() {
  const directory = mkdtempSync(path.join(tmpdir(), "hc-store-"));
  return { directory, database: path.join(directory, "store.db"), cleanup: () => rmSync(directory, { force: true, recursive: true }) };
}

function auditEvent(sequence, previousHash, action = "CREATE_DRAFT") {
  const base = {
    sequence,
    at: new Date(Date.parse("2026-08-17T12:00:00Z") + sequence * 1000).toISOString(),
    request_id: `req-${sequence}`,
    actor_id: "editor-a",
    action,
    outcome: "ALLOW",
    target: null,
    reason: null,
    previous_hash: previousHash
  };
  return { ...base, hash: auditEventHash(base) };
}

function operator() {
  return {
    id: "editor-a",
    display_name: "Editor A",
    status: "ACTIVE",
    credentials: [{ id: "credential-editor", public_key: "cHVibGljLWtleQ", counter: 0, transports: ["internal"], status: "ACTIVE" }],
    grants: [{ actions: ["READ", "EDIT"], regions: ["demo-north"], categories: ["water"] }]
  };
}

function draft(id = "point-1") {
  return createDraft(
    { id, category: "water", region: "demo-north", coarse_location: { fr: "Nord", en: "North", ur: "shumal" }, internal_notes: "note" },
    "editor-a",
    "2026-08-17T12:00:00Z"
  );
}

test("the audit chain is verified before every write, not after", () => {
  const space = workspace();
  const store = openOperatorStore({ databasePath: space.database });
  try {
    store.transaction((tx) => tx.appendAudit(auditEvent(1, "GENESIS")));
    const head = store.auditHead();

    assert.throws(() => store.transaction((tx) => tx.appendAudit(auditEvent(5, head.hash))), /Broken audit journal sequence/);
    assert.throws(() => store.transaction((tx) => tx.appendAudit(auditEvent(2, "GENESIS"))), /Broken audit journal chain/);

    const forged = auditEvent(2, head.hash);
    forged.hash = auditEventHash(auditEvent(2, head.hash, "OTHER_ACTION"));
    assert.throws(() => store.transaction((tx) => tx.appendAudit(forged)), /Invalid audit event hash/);

    assert.equal(store.readAuditEvents().length, 1);
  } finally {
    store.close();
    space.cleanup();
  }
});

test("a transaction spanning operators, records, revocations and audit is all-or-nothing", () => {
  const space = workspace();
  const store = openOperatorStore({ databasePath: space.database });
  try {
    store.transaction((tx) => {
      tx.putOperator(operator());
      tx.putRecord(draft());
      tx.appendAudit(auditEvent(1, "GENESIS"));
    });
    assert.equal(store.readOperators().length, 1);

    // La revocation est invalide : rien de cette transaction ne doit subsister.
    assert.throws(() => store.transaction((tx) => {
      tx.putRecord(draft("point-2"));
      tx.appendAudit(auditEvent(2, store.auditHead().hash));
      tx.appendRevocation({ at: "not-a-date", kind: "OPERATOR", actor_id: "a", target_id: "b" });
    }), /Invalid revocation event metadata/);

    assert.equal(store.readRecords().length, 1);
    assert.equal(store.readAuditEvents().length, 1);
    assert.equal(store.readRevocations().length, 0);
  } finally {
    store.close();
    space.cleanup();
  }
});

test("a process killed mid-transaction leaves no partial write", () => {
  const space = workspace();
  const seed = openOperatorStore({ databasePath: space.database });
  seed.transaction((tx) => tx.appendAudit(auditEvent(1, "GENESIS")));
  const headBefore = seed.auditHead();
  seed.close();

  const child = `
    import { openOperatorStore } from ${JSON.stringify(storeModule)};
    import { auditEventHash } from ${JSON.stringify(path.join(projectRoot, "operator-api", "src", "security-core.mjs"))};
    const store = openOperatorStore({ databasePath: ${JSON.stringify(space.database)} });
    store.transaction((tx) => {
      const head = tx.auditHead();
      const base = { sequence: head.sequence + 1, at: new Date().toISOString(), request_id: "crash", actor_id: null, action: "CRASH", outcome: "ALLOW", target: null, reason: null, previous_hash: head.hash };
      tx.appendAudit({ ...base, hash: auditEventHash(base) });
      process.kill(process.pid, "SIGKILL");
    });
  `;
  assert.throws(() => execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", child], { stdio: "pipe" }));

  const reopened = openOperatorStore({ databasePath: space.database });
  try {
    assert.equal(reopened.readAuditEvents().length, 1);
    assert.deepEqual(reopened.auditHead(), headBefore);
    assert.doesNotThrow(() => reopened.verifyIntegrity());
  } finally {
    reopened.close();
    space.cleanup();
  }
});

test("reopening revalidates the whole journal, not only the last event", () => {
  const space = workspace();
  const store = openOperatorStore({ databasePath: space.database });
  let head = "GENESIS";
  for (let sequence = 1; sequence <= 4; sequence += 1) {
    const event = auditEvent(sequence, head);
    store.transaction((tx) => tx.appendAudit(event));
    head = event.hash;
  }
  store.close();

  // On contourne les declencheurs pour abimer un evenement ANCIEN : seule une
  // revalidation complete peut le detecter.
  const raw = new DatabaseSync(space.database);
  raw.exec("DROP TRIGGER audit_events_append_only_update");
  raw.exec("UPDATE audit_events SET action = 'TAMPERED' WHERE sequence = 2");
  raw.close();

  const reopened = openOperatorStore({ databasePath: space.database });
  try {
    assert.throws(() => reopened.verifyIntegrity(), /Invalid audit event hash/);
  } finally {
    reopened.close();
    space.cleanup();
  }
});

test("the engine itself refuses to rewrite or delete audit history", () => {
  const space = workspace();
  const store = openOperatorStore({ databasePath: space.database });
  store.transaction((tx) => {
    tx.appendAudit(auditEvent(1, "GENESIS"));
    // Un declencheur DELETE ne se declenche que sur des lignes existantes :
    // la table doit etre peuplee pour que l'assertion ait un sens.
    tx.appendRevocation({ at: "2026-08-17T12:10:00.000Z", kind: "CREDENTIAL", actor_id: "security-admin", target_id: "credential-editor" });
  });
  store.close();

  const raw = new DatabaseSync(space.database);
  try {
    assert.throws(() => raw.exec("UPDATE audit_events SET action = 'X' WHERE sequence = 1"), /append-only/);
    assert.throws(() => raw.exec("DELETE FROM audit_events WHERE sequence = 1"), /append-only/);
    assert.throws(() => raw.exec("DELETE FROM revocations"), /append-only/);
    // Meme un ecrivain SQL direct ne peut pas rompre la chaine.
    assert.throws(() => raw.exec("INSERT INTO audit_events (sequence, at, request_id, actor_id, action, outcome, target, reason, previous_hash, hash) VALUES (9, '2026-08-17T12:00:00Z', 'r', null, 'X', 'ALLOW', null, null, 'GENESIS', 'h')"), /broken audit chain/);
  } finally {
    raw.close();
    space.cleanup();
  }
});

test("concurrent writers serialise instead of forking the chain", () => {
  const space = workspace();
  const seed = openOperatorStore({ databasePath: space.database });
  seed.transaction((tx) => tx.appendAudit(auditEvent(1, "GENESIS")));
  seed.close();

  const writer = (label) => `
    import { openOperatorStore } from ${JSON.stringify(storeModule)};
    import { auditEventHash } from ${JSON.stringify(path.join(projectRoot, "operator-api", "src", "security-core.mjs"))};
    const store = openOperatorStore({ databasePath: ${JSON.stringify(space.database)} });
    for (let index = 0; index < 8; index += 1) {
      store.transaction((tx) => {
        const head = tx.auditHead();
        const base = { sequence: head.sequence + 1, at: new Date().toISOString(), request_id: "${label}-" + index, actor_id: null, action: "CONCURRENT", outcome: "ALLOW", target: null, reason: null, previous_hash: head.hash };
        tx.appendAudit({ ...base, hash: auditEventHash(base) });
      });
    }
    store.close();
  `;
  const run = (label) => execFileSync(process.execPath, ["--no-warnings", "--input-type=module", "-e", writer(label)], { stdio: "pipe" });
  run("a");
  run("b");

  const store = openOperatorStore({ databasePath: space.database });
  try {
    assert.equal(store.readAuditEvents().length, 17);
    assert.doesNotThrow(() => store.verifyIntegrity());
  } finally {
    store.close();
    space.cleanup();
  }
});

test("migration is dry-run by default and rolls back to the original files", () => {
  const space = workspace();
  const sourceDir = path.join(space.directory, "sources");
  const migrate = path.join(projectRoot, "scripts", "migrate-operator-store.mjs");
  const run = (args) => execFileSync(process.execPath, ["--no-warnings", migrate, ...args], { encoding: "utf8", stdio: "pipe" });

  rmSync(sourceDir, { force: true, recursive: true });
  mkdirSync(sourceDir, { recursive: true });
  const events = [auditEvent(1, "GENESIS")];
  events.push(auditEvent(2, events[0].hash));
  writeFileSync(path.join(sourceDir, "operators.json"), JSON.stringify({ operators: [operator()] }));
  writeFileSync(path.join(sourceDir, "records.json"), JSON.stringify({ records: [draft()] }));
  writeFileSync(path.join(sourceDir, "audit.jsonl"), `${events.map((event) => JSON.stringify(event)).join("\n")}\n`);
  writeFileSync(path.join(sourceDir, "revocations.jsonl"), `${JSON.stringify({ at: "2026-08-17T12:10:00.000Z", kind: "CREDENTIAL", actor_id: "security-admin", target_id: "credential-editor" })}\n`);

  const dry = run(["--source-dir", sourceDir, "--database", space.database]);
  assert.match(dry, /DRY RUN/);
  assert.equal(existsSync(space.database), false, "a dry run must not create the database");

  const committed = JSON.parse(run(["--source-dir", sourceDir, "--database", space.database, "--commit"]).replace(/\nMigration committed\.\n?$/, ""));
  assert.equal(committed.integrity.auditEventCount, 2);

  const store = openOperatorStore({ databasePath: space.database });
  assert.equal(store.readOperators().length, 1);
  store.close();

  writeFileSync(path.join(sourceDir, "operators.json"), "corrupted");
  run(["--rollback", committed.backup_dir, "--source-dir", sourceDir, "--database", space.database]);
  assert.equal(JSON.parse(readFileSync(path.join(sourceDir, "operators.json"), "utf8")).operators.length, 1);
  space.cleanup();
});

test("a backup restores into an isolated database with an identical head", () => {
  const space = workspace();
  const store = openOperatorStore({ databasePath: space.database });
  let head = "GENESIS";
  for (let sequence = 1; sequence <= 3; sequence += 1) {
    const event = auditEvent(sequence, head);
    store.transaction((tx) => tx.appendAudit(event));
    head = event.hash;
  }
  store.transaction((tx) => tx.putOperator(operator()));
  const expected = store.auditHead();
  store.close();

  const backupPath = path.join(space.directory, "backup.db");
  const backupReport = JSON.parse(execFileSync(process.execPath, ["--no-warnings", path.join(projectRoot, "scripts", "backup-operator-store.mjs"), "--database", space.database, "--output", backupPath], { encoding: "utf8", stdio: "pipe" }));
  assert.equal(backupReport.verified, true);
  assert.deepEqual(backupReport.head, expected);

  const restoreReport = JSON.parse(execFileSync(process.execPath, ["--no-warnings", path.join(projectRoot, "scripts", "restore-operator-store.mjs"), "--backup", backupPath, "--into", path.join(space.directory, "isolated"), "--expect-head-hash", expected.hash], { encoding: "utf8", stdio: "pipe" }));
  assert.equal(restoreReport.verified, true);
  assert.deepEqual(restoreReport.head, expected);
  assert.equal(restoreReport.counts.operators, 1);
  assert.equal(restoreReport.counts.audit_events, 3);
  space.cleanup();
});
