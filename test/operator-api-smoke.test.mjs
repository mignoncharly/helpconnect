import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { openOperatorStore } from "../operator-api/src/store.mjs";

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No test port"));
      server.close(() => resolve(address.port));
    });
  });
}

test("the private HTTP boundary enforces origin, no-store and authentication", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "help-connect-operator-api-"));
  const port = await availablePort();
  const origin = "https://operators.helpconnect.test";

  // L'API ne lit plus de fichiers plats : on seme le store depuis les memes
  // fixtures, par l'API transactionnelle, seul chemin d'ecriture autorise.
  const storePath = path.join(temporaryRoot, "store.db");
  const operators = JSON.parse(await readFile(path.resolve("operator-api/config/operators.example.json"), "utf8")).operators;
  const records = JSON.parse(await readFile(path.resolve("operator-portal/data/demo-records.json"), "utf8")).records;
  const seed = openOperatorStore({ databasePath: storePath });
  seed.transaction((tx) => {
    for (const operator of operators) tx.putOperator(operator);
    for (const record of records) tx.putRecord(record);
  });
  seed.close();

  const child = spawn(process.execPath, ["operator-api/src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      HC_OPERATOR_ORIGIN: origin,
      HC_WEBAUTHN_RP_ID: "operators.helpconnect.test",
      HC_STORE_PATH: storePath,
      HC_OPERATOR_PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Private API did not start")), 30_000);
      child.stdout.once("data", () => { clearTimeout(timeout); resolve(); });
      child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`Private API exited ${code}`)); });
    });
    const endpoint = `http://127.0.0.1:${port}`;
    const rateHeaders = { "Content-Type": "application/json", Origin: origin, "X-HC-Rate-Key": "test-client-key-0001" };
    const options = await fetch(`${endpoint}/v1/auth/options`, { method: "POST", headers: rateHeaders, body: "{}" });
    assert.equal(options.status, 200);
    assert.equal(options.headers.get("cache-control"), "no-store");
    assert.equal(options.headers.get("strict-transport-security"), "max-age=63072000; includeSubDomains");
    assert.equal(options.headers.get("cross-origin-opener-policy"), "same-origin");
    assert.equal(options.headers.get("cross-origin-resource-policy"), "same-origin");
    assert.equal(options.headers.get("origin-agent-cluster"), "?1");
    assert.equal(options.headers.get("referrer-policy"), "no-referrer");
    assert.equal(options.headers.get("x-content-type-options"), "nosniff");
    assert.equal(options.headers.get("x-frame-options"), "DENY");
    assert.match(options.headers.get("permissions-policy") ?? "", /publickey-credentials-get=\(\)/);
    assert.equal((await options.json()).options.userVerification, "required");

    const crossOrigin = await fetch(`${endpoint}/v1/auth/options`, { method: "POST", headers: { ...rateHeaders, Origin: "https://public.helpconnect.test" }, body: "{}" });
    assert.equal(crossOrigin.status, 403);
    const missingRateKey = await fetch(`${endpoint}/v1/auth/options`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: "{}" });
    assert.equal(missingRateKey.status, 400);
    const pollutedBody = await fetch(`${endpoint}/v1/auth/options`, { method: "POST", headers: rateHeaders, body: '{"unexpected":true}' });
    assert.equal(pollutedBody.status, 400);
    const pollutedQuery = await fetch(`${endpoint}/v1/session?token=ignored`);
    assert.equal(pollutedQuery.status, 400);
    const unauthenticated = await fetch(`${endpoint}/v1/session`);
    assert.equal(unauthenticated.status, 401);
  } finally {
    child.kill();
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
