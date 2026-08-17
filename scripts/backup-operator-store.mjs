// Sauvegarde coherente en ligne du store operateur (ADR-013).
//
//   node scripts/backup-operator-store.mjs --database FILE --output FILE
//
// La copie est prise par l'API de sauvegarde du moteur, donc sans arreter le
// service et sans risque de copie dechiree. La sauvegarde est ensuite rouverte
// et revalidee : une sauvegarde non verifiee ne prouve rien.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { openOperatorStore } from "../operator-api/src/store.mjs";

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--database") options.database = argv[index += 1];
    else if (argv[index] === "--output") options.output = argv[index += 1];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!options.database || !options.output) throw new Error("--database and --output are required");
  return options;
}

const options = parseArguments(process.argv.slice(2));
if (!existsSync(options.database)) throw new Error(`No store at ${options.database}`);
if (existsSync(options.output)) throw new Error(`Refusing to overwrite an existing backup: ${options.output}`);

const source = openOperatorStore({ databasePath: options.database });
const sourceIntegrity = source.verifyIntegrity();
await source.backupTo(options.output);
source.close();

// Revalidation de la copie, pas seulement de l'original.
const copy = openOperatorStore({ databasePath: options.output });
const copyIntegrity = copy.verifyIntegrity();
const counts = {
  audit_events: copy.readAuditEvents().length,
  operators: copy.readOperators().length,
  private_records: copy.readRecords().length,
  revocations: copy.readRevocations().length
};
copy.close();

if (copyIntegrity.head.sequence !== sourceIntegrity.head.sequence || copyIntegrity.head.hash !== sourceIntegrity.head.hash) {
  throw new Error("Backup head does not match the source head");
}

console.log(JSON.stringify({
  backup_sha256: createHash("sha256").update(readFileSync(options.output)).digest("hex"),
  backup_size_bytes: statSync(options.output).size,
  counts,
  head: copyIntegrity.head,
  output: options.output,
  taken_at: new Date().toISOString(),
  verified: true
}, null, 2));
