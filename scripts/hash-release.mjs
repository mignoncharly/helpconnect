import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hashReleaseDirectory } from "./release-hash-lib.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(projectRoot, "reports", "release-digests.json");
const [publicArtifact, operatorArtifact] = await Promise.all([
  hashReleaseDirectory(path.join(projectRoot, "dist")),
  hashReleaseDirectory(path.join(projectRoot, "operator-portal", "dist"))
]);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  algorithm: "HELP_CONNECT_RELEASE_TREE_V1_SHA256",
  artifacts: {
    public: { path: "dist", ...publicArtifact },
    operator: { path: "operator-portal/dist", ...operatorArtifact }
  }
};
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(`Release digests written to ${reportPath}`);
