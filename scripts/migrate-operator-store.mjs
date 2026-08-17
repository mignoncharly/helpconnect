// Migration des quatre fichiers plats vers le store transactionnel (ADR-013).
//
// Dry-run par defaut : rien n'est ecrit sans --commit. La migration lit, valide,
// hashe chaque source, et n'ecrit qu'apres avoir sauvegarde les originaux.
//
//   node scripts/migrate-operator-store.mjs --source-dir DIR --database FILE
//   node scripts/migrate-operator-store.mjs --source-dir DIR --database FILE --commit
//   node scripts/migrate-operator-store.mjs --rollback BACKUP_DIR --source-dir DIR --database FILE

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openOperatorStore } from "../operator-api/src/store.mjs";
import { validateAuditJournal, validateOperators, validateRevocationJournal } from "../operator-api/src/security-core.mjs";
import { validatePrivateRecord } from "./publication-workflow.mjs";

const sourceFiles = Object.freeze(["operators.json", "records.json", "audit.jsonl", "revocations.jsonl"]);

function parseArguments(argv) {
  const options = { commit: false, database: undefined, rollback: undefined, sourceDir: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--commit") options.commit = true;
    else if (flag === "--database") options.database = argv[index += 1];
    else if (flag === "--source-dir") options.sourceDir = argv[index += 1];
    else if (flag === "--rollback") options.rollback = argv[index += 1];
    else throw new Error(`Unknown argument: ${flag}`);
  }
  if (!options.sourceDir || !options.database) throw new Error("--source-dir and --database are required");
  return options;
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readJsonLines(filePath) {
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function readSources(sourceDir) {
  const digests = {};
  for (const file of sourceFiles) {
    const full = path.join(sourceDir, file);
    digests[file] = existsSync(full) ? sha256(readFileSync(full)) : null;
  }
  const operatorsPath = path.join(sourceDir, "operators.json");
  const recordsPath = path.join(sourceDir, "records.json");
  const operators = existsSync(operatorsPath) ? JSON.parse(readFileSync(operatorsPath, "utf8")).operators ?? [] : [];
  const records = existsSync(recordsPath) ? JSON.parse(readFileSync(recordsPath, "utf8")).records ?? [] : [];
  const audit = readJsonLines(path.join(sourceDir, "audit.jsonl"));
  const revocations = readJsonLines(path.join(sourceDir, "revocations.jsonl"));
  return { audit, digests, operators, records, revocations };
}

function validateSources({ audit, operators, records, revocations }) {
  // Les validateurs de production sont la seule source de verite sur la forme.
  if (operators.length > 0) validateOperators(operators);
  for (const record of records) validatePrivateRecord(record);
  validateAuditJournal(audit);
  validateRevocationJournal(revocations);
}

function rollback(options) {
  const manifestPath = path.join(options.rollback, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error(`No migration manifest in ${options.rollback}`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  for (const [file, digest] of Object.entries(manifest.source_digests)) {
    if (digest === null) continue;
    const backupFile = path.join(options.rollback, file);
    if (sha256(readFileSync(backupFile)) !== digest) throw new Error(`Backup file does not match its manifest digest: ${file}`);
  }
  for (const [file, digest] of Object.entries(manifest.source_digests)) {
    if (digest === null) continue;
    copyFileSync(path.join(options.rollback, file), path.join(options.sourceDir, file));
  }
  // La base est ecartee, pas supprimee : un rollback ne doit pas detruire de preuve.
  if (existsSync(options.database)) {
    const aside = `${options.database}.rolled-back-${Date.now()}`;
    renameSync(options.database, aside);
    for (const suffix of ["-wal", "-shm"]) if (existsSync(`${options.database}${suffix}`)) rmSync(`${options.database}${suffix}`);
    console.log(`Database moved aside to ${aside}`);
  }
  console.log(`Rollback complete from ${options.rollback}`);
}

function migrate(options) {
  const sources = readSources(options.sourceDir);
  validateSources(sources);

  const plan = {
    audit_events: sources.audit.length,
    operators: sources.operators.length,
    private_records: sources.records.length,
    revocations: sources.revocations.length,
    source_digests: sources.digests
  };

  if (!options.commit) {
    console.log("DRY RUN — no write performed. Re-run with --commit to apply.");
    console.log(JSON.stringify({ database: options.database, plan }, null, 2));
    return;
  }

  if (existsSync(options.database)) throw new Error(`Refusing to migrate into an existing database: ${options.database}`);

  const backupDir = path.join(options.sourceDir, `migration-backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  for (const file of sourceFiles) {
    const full = path.join(options.sourceDir, file);
    if (existsSync(full)) copyFileSync(full, path.join(backupDir, file));
  }
  writeFileSync(path.join(backupDir, "manifest.json"), `${JSON.stringify({
    migrated_at: new Date().toISOString(),
    database: options.database,
    plan,
    source_digests: sources.digests
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });

  const store = openOperatorStore({ databasePath: options.database });
  try {
    // Une seule transaction pour les quatre domaines : la migration est
    // tout-ou-rien, comme les ecritures de production.
    store.transaction((tx) => {
      for (const operator of sources.operators) tx.putOperator(operator);
      for (const record of sources.records) tx.putRecord(record);
      for (const event of sources.audit) tx.appendAudit(event);
      for (const event of sources.revocations) tx.appendRevocation(event);
    });
    const integrity = store.verifyIntegrity();
    console.log(JSON.stringify({ backup_dir: backupDir, database: options.database, integrity, plan }, null, 2));
    console.log("Migration committed.");
  } catch (error) {
    store.close();
    rmSync(options.database, { force: true });
    for (const suffix of ["-wal", "-shm"]) rmSync(`${options.database}${suffix}`, { force: true });
    throw error;
  }
  store.close();
}

const options = parseArguments(process.argv.slice(2));
if (options.rollback) rollback(options);
else migrate(options);
