import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { forbiddenPrivacyResponseHeaders } from "../shared/network-privacy.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "dist");
const requirements = JSON.parse(await readFile(path.join(projectRoot, "config", "public-deployment-privacy.requirements.json"), "utf8"));

const expectedRequirements = {
  schema_version: 1,
  claim: "metadata-minimized-not-anonymous",
  public_application: {
    account_required: false,
    application_telemetry: false,
    cookies_issued: false,
    device_identifier: false,
    geolocation_collected: false,
    search_transport: "local-only"
  },
  infrastructure_logs: {
    allowed_fields: ["coarse_time_bucket", "status_class", "cache_result"],
    forbidden_fields: ["client_ip", "cookie", "precise_timestamp", "referer", "request_body", "request_query", "unique_request_id", "user_agent"],
    maximum_raw_retention_hours: 24,
    provider_evidence_required: true
  }
};
if (JSON.stringify(requirements) !== JSON.stringify(expectedRequirements)) throw new Error("Public deployment privacy requirements diverged from the reviewed contract");

const [app, worker, html, manifestText, headers] = await Promise.all([
  readFile(path.join(outputDirectory, "app.js"), "utf8"),
  readFile(path.join(outputDirectory, "service-worker.js"), "utf8"),
  readFile(path.join(outputDirectory, "index.html"), "utf8"),
  readFile(path.join(outputDirectory, "manifest.webmanifest"), "utf8"),
  readFile(path.join(outputDirectory, "_headers"), "utf8")
]);

const runtime = `${app}\n${worker}`;
if (/\b(?:sendBeacon|XMLHttpRequest|WebSocket|EventSource)\b/.test(runtime)) throw new Error("Unapproved outbound browser primitive in the public runtime");
if (/\b(?:analytics|telemetry|fingerprint|sentry|hotjar)\b/i.test(runtime)) throw new Error("Telemetry or fingerprinting marker in the public runtime");
if (/[?&](?:utm_[a-z]+|gclid|fbclid)=/i.test(runtime)) throw new Error("Tracking query parameter in the public runtime");

const searchInputs = html.match(/<input\b[^>]*\bdata-search-input\b[^>]*>/g) ?? [];
if (searchInputs.length === 0) throw new Error("No public search input found");
for (const input of searchInputs) {
  if (/\bname\s*=/.test(input)) throw new Error("A public search input can be serialized by form navigation");
  if (!/\bautocomplete="off"/.test(input)) throw new Error("A public search input allows browser autocomplete persistence");
}
if (/<form\b[^>]*\b(?:action|method)\s*=/i.test(html)) throw new Error("A public form can submit data over the network");

const manifest = JSON.parse(manifestText);
if (manifest.start_url !== "./" || manifest.scope !== "./" || /[?#]/.test(manifest.start_url)) throw new Error("Manifest navigation can carry a query or leave the application scope");

for (const header of forbiddenPrivacyResponseHeaders) {
  if (new RegExp(`^\\s*${header}:`, "im").test(headers)) throw new Error(`Privacy-sensitive response header configured: ${header}`);
}

console.log("Validated local-only search, telemetry-free runtime, clean navigation, and deployment log requirements");
