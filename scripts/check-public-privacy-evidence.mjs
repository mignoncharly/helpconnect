import { readFile } from "node:fs/promises";

const evidencePath = process.argv[2];
if (!evidencePath) throw new Error("Usage: npm run privacy:check-deployment -- path/to/privacy-evidence.json");
const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
const exactKeys = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

if (!exactKeys(evidence, ["schema_version", "origin", "provider", "reviewed_at", "controls"]) || evidence.schema_version !== 1) throw new Error("Invalid privacy evidence envelope");
const origin = new URL(evidence.origin);
if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== "/") throw new Error("Privacy evidence requires a clean HTTPS origin");
if (typeof evidence.provider !== "string" || evidence.provider.trim().length < 2 || evidence.provider.length > 100) throw new Error("Invalid infrastructure provider name");
const reviewedAt = Date.parse(evidence.reviewed_at);
const age = Date.now() - reviewedAt;
if (!Number.isFinite(reviewedAt) || age < 0 || age > 90 * 24 * 60 * 60 * 1000) throw new Error("Privacy evidence must have been reviewed within the last 90 days");

const controls = evidence.controls;
if (!exactKeys(controls, ["application_telemetry", "cdn_analytics", "client_ip", "cookies", "dns_provider_reviewed", "raw_access_log_retention_hours", "referer", "request_body", "request_query", "user_agent"])) throw new Error("Invalid privacy evidence controls");
if (controls.application_telemetry !== "disabled" || controls.cdn_analytics !== "disabled" || controls.client_ip !== "discarded-or-anonymized-at-ingress" || controls.cookies !== "not-issued" || controls.dns_provider_reviewed !== true || controls.referer !== "discarded" || controls.request_body !== "discarded" || controls.request_query !== "discarded" || controls.user_agent !== "discarded") throw new Error("Deployment does not satisfy the public metadata-minimization contract");
if (!Number.isSafeInteger(controls.raw_access_log_retention_hours) || controls.raw_access_log_retention_hours < 0 || controls.raw_access_log_retention_hours > 24) throw new Error("Raw access-log retention exceeds 24 hours");

console.log(`Public deployment privacy evidence passed: ${origin.origin} via ${evidence.provider}`);
