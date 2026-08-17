import { readFile } from "node:fs/promises";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { listRelativeFiles } from "./file-inventory.mjs";
import { operatorMetaCsp, operatorPortalHeaders } from "../shared/security-headers.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const operatorDist = path.join(projectRoot, "operator-portal", "dist");
const publicDist = path.join(projectRoot, "dist");
const files = await listRelativeFiles(operatorDist);
if (JSON.stringify(files) !== JSON.stringify(["app.js", "index.html", "styles.css"])) throw new Error(`Unexpected operator inventory: ${files.join(", ")}`);

let totalBrotli = 0;
for (const name of files) {
  const content = await readFile(path.join(operatorDist, name));
  totalBrotli += brotliCompressSync(content, { params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 } }).length;
  const text = content.toString("utf8");
  if (/\bhttps?:\/\//i.test(text) || /sourceMappingURL/.test(text)) throw new Error(`Network URL or source map in operator ${name}`);
  if (/\b(?:localStorage|sessionStorage|document\.cookie)\b/.test(text)) throw new Error(`Browser credential storage primitive in operator ${name}`);
  if (/humanitarian_contact|Demo contact|\+000-000-|replace-with-base64url/.test(text)) throw new Error(`Private fixture or provisioning marker in operator ${name}`);
}
if (totalBrotli > 100 * 1024) throw new Error(`Operator portal exceeds its 100 KiB Brotli budget: ${totalBrotli}`);

const html = await readFile(path.join(operatorDist, "index.html"), "utf8");
if (!html.includes('name="robots" content="noindex,nofollow"') || !html.includes("./app.js") || !html.includes("./styles.css")) throw new Error("Operator HTML lacks isolation metadata or local assets");
if (!html.includes(`<meta http-equiv="Content-Security-Policy" content="${operatorMetaCsp}">`)) throw new Error("Operator HTML CSP fallback differs from the canonical policy");
const operatorJs = await readFile(path.join(operatorDist, "app.js"), "utf8");
for (const required of ["/v1/auth/options", "/v1/auth/verify", "/v1/session", "X-CSRF-Token"]) if (!operatorJs.includes(required)) throw new Error(`Operator bundle lacks ${required}`);

const publicFiles = await listRelativeFiles(publicDist);
for (const name of publicFiles) {
  const content = await readFile(path.join(publicDist, name), "utf8");
  if (/\/v1\/auth|__Host-hc_operator|X-CSRF-Token|credential-editor|operator-demo-disabled/.test(content)) throw new Error(`Private operator surface leaked into public dist/${name}`);
}

const headers = JSON.parse(await readFile(path.join(projectRoot, "operator-portal", "security-headers.json"), "utf8"));
const sortedEntries = (value) => Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
if (JSON.stringify(sortedEntries(headers)) !== JSON.stringify(sortedEntries(operatorPortalHeaders))) throw new Error("Private portal headers differ from the canonical security policy");

console.log(`Validated isolated operator portal: ${totalBrotli} bytes Brotli, 100 KiB limit`);
