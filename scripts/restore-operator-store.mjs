// Preuve de restauration : restaure une sauvegarde dans une base ISOLEE et
// revalide integralement son contenu (ADR-013).
//
//   node scripts/restore-operator-store.mjs --backup FILE --into DIR [--expect-head-hash HASH]
//
// La restauration n'ecrit jamais sur la base de production : elle exige un
// repertoire cible distinct, et refuse d'ecraser une base existante.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { openOperatorStore } from "../operator-api/src/store.mjs";

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--backup") options.backup = argv[index += 1];
    else if (argv[index] === "--into") options.into = argv[index += 1];
    else if (argv[index] === "--expect-head-hash") options.expectHeadHash = argv[index += 1];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!options.backup || !options.into) throw new Error("--backup and --into are required");
  return options;
}

const options = parseArguments(process.argv.slice(2));
if (!existsSync(options.backup)) throw new Error(`No backup at ${options.backup}`);
mkdirSync(options.into, { recursive: true, mode: 0o700 });
const restoredPath = path.join(options.into, "restored-store.db");
if (existsSync(restoredPath)) throw new Error(`Refusing to overwrite an existing restore: ${restoredPath}`);
copyFileSync(options.backup, restoredPath);

const restored = openOperatorStore({ databasePath: restoredPath });
const integrity = restored.verifyIntegrity();
const proof = {
  backup: options.backup,
  backup_sha256: createHash("sha256").update(readFileSync(options.backup)).digest("hex"),
  counts: {
    audit_events: restored.readAuditEvents().length,
    operators: restored.readOperators().length,
    private_records: restored.readRecords().length,
    revocations: restored.readRevocations().length
  },
  head: integrity.head,
  restored_at: new Date().toISOString(),
  restored_to: restoredPath
};
restored.close();

if (options.expectHeadHash && proof.head.hash !== options.expectHeadHash) {
  throw new Error(`Restored head ${proof.head.hash} does not match the expected head ${options.expectHeadHash}`);
}

console.log(JSON.stringify({ ...proof, verified: true }, null, 2));
