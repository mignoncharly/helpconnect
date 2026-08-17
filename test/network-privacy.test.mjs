import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createPublicAssetRequest, forbiddenPrivacyResponseHeaders, resolvePublicAssetUrl } from "../shared/network-privacy.js";

const execFileAsync = promisify(execFile);

test("public asset requests omit credentials, referrers, cache reuse, and redirects", () => {
  const request = createPublicAssetRequest("data/item.json", "https://public.example/app/index.html");
  assert.equal(request.url, "https://public.example/app/data/item.json");
  assert.equal(request.method, "GET");
  assert.equal(request.credentials, "omit");
  assert.equal(request.referrerPolicy, "no-referrer");
  assert.equal(request.cache, "no-store");
  assert.equal(request.mode, "same-origin");
  assert.equal(request.redirect, "error");
});

test("public asset resolution rejects origins, scope escapes, credentials, queries, and fragments", () => {
  const base = "https://public.example/app/";
  for (const value of [
    "https://third-party.example/item.json",
    "../private/item.json",
    "item.json?search=sensitive",
    "item.json#sensitive",
    "https://user:secret@public.example/app/item.json"
  ]) assert.throws(() => resolvePublicAssetUrl(value, base), TypeError);
});

test("the public privacy contract rejects identity and request metadata collection", async () => {
  const contract = JSON.parse(await readFile(new URL("../config/public-deployment-privacy.requirements.json", import.meta.url), "utf8"));
  assert.equal(contract.claim, "metadata-minimized-not-anonymous");
  assert.equal(contract.public_application.search_transport, "local-only");
  assert.equal(contract.public_application.application_telemetry, false);
  assert.equal(contract.public_application.cookies_issued, false);
  assert.deepEqual(contract.infrastructure_logs.forbidden_fields, ["client_ip", "cookie", "precise_timestamp", "referer", "request_body", "request_query", "unique_request_id", "user_agent"]);
  assert.equal(contract.infrastructure_logs.maximum_raw_retention_hours, 24);
  assert.equal(contract.infrastructure_logs.provider_evidence_required, true);
  assert.deepEqual(forbiddenPrivacyResponseHeaders, ["accept-ch", "critical-ch", "etag", "nel", "report-to", "reporting-endpoints", "server-timing", "set-cookie"]);
});

test("deployment privacy evidence is current, exact, and capped at 24 hours", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "hc-privacy-evidence-"));
  const evidencePath = path.join(directory, "evidence.json");
  const evidence = {
    schema_version: 1,
    origin: "https://public.example/",
    provider: "Reviewed provider",
    reviewed_at: new Date().toISOString(),
    controls: {
      application_telemetry: "disabled",
      cdn_analytics: "disabled",
      client_ip: "discarded-or-anonymized-at-ingress",
      cookies: "not-issued",
      dns_provider_reviewed: true,
      raw_access_log_retention_hours: 24,
      referer: "discarded",
      request_body: "discarded",
      request_query: "discarded",
      user_agent: "discarded"
    }
  };
  try {
    await writeFile(evidencePath, JSON.stringify(evidence), "utf8");
    const script = fileURLToPath(new URL("../scripts/check-public-privacy-evidence.mjs", import.meta.url));
    const accepted = await execFileAsync(process.execPath, [script, evidencePath]);
    assert.match(accepted.stdout, /privacy evidence passed/);
    evidence.controls.raw_access_log_retention_hours = 25;
    await writeFile(evidencePath, JSON.stringify(evidence), "utf8");
    await assert.rejects(execFileAsync(process.execPath, [script, evidencePath]), /retention exceeds 24 hours/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
