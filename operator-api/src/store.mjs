// Store transactionnel du systeme operateur (ADR-013).
//
// Ce module est le SEUL a importer le moteur de base de donnees. Tout le reste
// du systeme passe par l'API exposee ici, pour que le moteur reste remplacable
// et qu'aucun composant ne puisse ecrire hors transaction.

import { DatabaseSync, backup } from "node:sqlite";
import { auditEventHash, validateAuditJournal, validateOperators, validateRevocationJournal } from "./security-core.mjs";
import { validatePrivateRecord } from "../../scripts/publication-workflow.mjs";

export const storeSchemaVersion = 1;
export const auditGenesisHash = "GENESIS";

const schema = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS operators (
  id TEXT PRIMARY KEY,
  document TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS private_records (
  id TEXT PRIMARY KEY,
  document TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS audit_events (
  sequence INTEGER PRIMARY KEY CHECK (sequence > 0),
  at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('ALLOW', 'DENY')),
  target TEXT,
  reason TEXT,
  previous_hash TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE
) STRICT;

CREATE TABLE IF NOT EXISTS revocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('OPERATOR', 'CREDENTIAL')),
  actor_id TEXT NOT NULL,
  target_id TEXT NOT NULL
) STRICT;

-- Defense en profondeur : meme un ecrivain SQL direct ne peut ni rompre la
-- chaine de hash, ni reecrire l'histoire. La verification applicative reste
-- en place ; ces declencheurs la doublent au niveau du moteur.
CREATE TRIGGER IF NOT EXISTS audit_events_chain_guard
BEFORE INSERT ON audit_events
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'broken audit chain')
  WHERE NEW.sequence IS NOT (SELECT IFNULL(MAX(sequence), 0) + 1 FROM audit_events)
     OR NEW.previous_hash IS NOT (SELECT IFNULL((SELECT hash FROM audit_events ORDER BY sequence DESC LIMIT 1), 'GENESIS'));
END;

CREATE TRIGGER IF NOT EXISTS audit_events_append_only_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit journal is append-only');
END;

CREATE TRIGGER IF NOT EXISTS audit_events_append_only_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit journal is append-only');
END;

CREATE TRIGGER IF NOT EXISTS revocations_append_only_update
BEFORE UPDATE ON revocations
BEGIN
  SELECT RAISE(ABORT, 'revocation journal is append-only');
END;

CREATE TRIGGER IF NOT EXISTS revocations_append_only_delete
BEFORE DELETE ON revocations
BEGIN
  SELECT RAISE(ABORT, 'revocation journal is append-only');
END;
`;

function readSchemaVersion(database) {
  const row = database.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get();
  return row ? Number.parseInt(String(row.value), 10) : undefined;
}

function auditRowToEvent(row) {
  return {
    sequence: row.sequence,
    at: row.at,
    request_id: row.request_id,
    actor_id: row.actor_id,
    action: row.action,
    outcome: row.outcome,
    target: row.target,
    reason: row.reason,
    previous_hash: row.previous_hash,
    hash: row.hash
  };
}

function revocationRowToEvent(row) {
  return { at: row.at, kind: row.kind, actor_id: row.actor_id, target_id: row.target_id };
}

export function openOperatorStore(options) {
  const databasePath = options?.databasePath;
  if (typeof databasePath !== "string" || databasePath.length === 0) throw new Error("A store path is required");
  const database = new DatabaseSync(databasePath);
  let inTransaction = false;
  let closed = false;

  try {
    // synchronous = FULL : une transaction confirmee a bien atteint le disque,
    // ce qui est la condition pour que le test de crash ait un sens.
    database.exec("PRAGMA journal_mode = WAL");
    database.exec("PRAGMA synchronous = FULL");
    // Deux ecrivains concurrents se serialisent au lieu d'echouer immediatement.
    database.exec("PRAGMA busy_timeout = 5000");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(schema);
    const existingVersion = readSchemaVersion(database);
    if (existingVersion === undefined) {
      database.prepare("INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?)").run(String(storeSchemaVersion));
    } else if (existingVersion !== storeSchemaVersion) {
      throw new Error(`Unsupported store schema version: ${existingVersion}`);
    }
  } catch (error) {
    database.close();
    throw error;
  }

  function assertOpen() {
    if (closed) throw new Error("The operator store is closed");
  }

  function readAuditEvents() {
    assertOpen();
    return database.prepare("SELECT * FROM audit_events ORDER BY sequence ASC").all().map(auditRowToEvent);
  }

  function readRevocations() {
    assertOpen();
    return database.prepare("SELECT * FROM revocations ORDER BY id ASC").all().map(revocationRowToEvent);
  }

  function readOperators() {
    assertOpen();
    return database.prepare("SELECT document FROM operators ORDER BY id ASC").all().map((row) => JSON.parse(row.document));
  }

  function readRecords() {
    assertOpen();
    return database.prepare("SELECT document FROM private_records ORDER BY id ASC").all().map((row) => JSON.parse(row.document));
  }

  function auditHead() {
    const row = database.prepare("SELECT sequence, hash FROM audit_events ORDER BY sequence DESC LIMIT 1").get();
    return row ? { sequence: row.sequence, hash: row.hash } : { sequence: 0, hash: auditGenesisHash };
  }

  // Relit et revalide TOUT le journal, pas seulement le dernier evenement.
  // Une chaine rompue empeche le demarrage au lieu de le laisser continuer.
  function verifyIntegrity() {
    assertOpen();
    const events = readAuditEvents();
    validateAuditJournal(events);
    validateRevocationJournal(readRevocations());
    const operators = readOperators();
    if (operators.length > 0) validateOperators(operators);
    for (const record of readRecords()) validatePrivateRecord(record);
    return { auditEventCount: events.length, head: auditHead() };
  }

  const transactionApi = {
    putOperator(document) {
      validateOperators([document]);
      database.prepare("INSERT INTO operators (id, document) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document = excluded.document")
        .run(document.id, JSON.stringify(document));
    },
    putRecord(document) {
      validatePrivateRecord(document);
      database.prepare("INSERT INTO private_records (id, document) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document = excluded.document")
        .run(document.id, JSON.stringify(document));
    },
    appendAudit(event) {
      // Verification AVANT ecriture : sequence, chainage et condensat.
      const head = auditHead();
      if (event.sequence !== head.sequence + 1) throw new Error("Broken audit journal sequence");
      if (event.previous_hash !== head.hash) throw new Error("Broken audit journal chain");
      if (event.hash !== auditEventHash(event)) throw new Error("Invalid audit event hash");
      database.prepare(`INSERT INTO audit_events
        (sequence, at, request_id, actor_id, action, outcome, target, reason, previous_hash, hash)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(event.sequence, event.at, event.request_id, event.actor_id, event.action, event.outcome, event.target, event.reason, event.previous_hash, event.hash);
    },
    appendRevocation(event) {
      validateRevocationJournal([event]);
      database.prepare("INSERT INTO revocations (at, kind, actor_id, target_id) VALUES (?, ?, ?, ?)")
        .run(event.at, event.kind, event.actor_id, event.target_id);
    },
    auditHead
  };

  return {
    readOperators,
    readRecords,
    readAuditEvents,
    readRevocations,
    auditHead,
    verifyIntegrity,

    // Tout-ou-rien sur les quatre domaines : ils vivent dans une seule base,
    // donc dans une seule transaction.
    transaction(work) {
      assertOpen();
      if (inTransaction) throw new Error("Nested store transactions are not supported");
      if (typeof work !== "function") throw new Error("A transaction body is required");
      inTransaction = true;
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = work(transactionApi);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          database.exec("ROLLBACK");
        } catch {
          // La transaction etait deja annulee par le moteur ; l'erreur d'origine prime.
        }
        throw error;
      } finally {
        inTransaction = false;
      }
    },

    // Copie coherente en ligne, sans arreter le service.
    async backupTo(destinationPath) {
      assertOpen();
      if (typeof destinationPath !== "string" || destinationPath.length === 0) throw new Error("A backup path is required");
      return backup(database, destinationPath);
    },

    close() {
      if (closed) return;
      closed = true;
      database.close();
    }
  };
}
