import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function startApi(environment, root) {
  const port = await availablePort();
  const child = spawn(process.execPath, ["operator-api/src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, HC_OPERATOR_ORIGIN: "https://operators.helpconnect.test", HC_WEBAUTHN_RP_ID: "operators.helpconnect.test", HC_STORE_PATH: path.join(root, "store.db"), HC_OPERATOR_PORT: String(port), ...environment },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("API did not start")), 30_000);
    child.stdout.once("data", () => { clearTimeout(timeout); resolve(); });
    child.once("exit", (code) => { clearTimeout(timeout); reject(new Error(`API exited ${code}`)); });
  });
  return { child, endpoint: `http://127.0.0.1:${port}` };
}

const post = (endpoint, path, body) => fetch(`${endpoint}${path}`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-HC-Rate-Key": "abcdefghijklmnop0123", Origin: "https://operators.helpconnect.test" },
  body: JSON.stringify(body)
});

test("bootstrap routes do not exist unless the ceremony is configured", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hc-bootstrap-http-"));
  const seed = openOperatorStore({ databasePath: path.join(root, "store.db") });
  seed.transaction((tx) => tx.putOperator({
    id: "editor-a", display_name: "Editor A", status: "ACTIVE",
    credentials: [{ id: "credential-editor", public_key: "cHVibGljLWtleQ", counter: 0, transports: ["internal"], status: "ACTIVE" }],
    grants: [{ actions: ["READ"], regions: ["demo-north"], categories: ["water"] }]
  }));
  seed.close();

  const api = await startApi({}, root);
  try {
    for (const route of ["/v1/bootstrap/options", "/v1/bootstrap/verify"]) {
      const response = await post(api.endpoint, route, { token: "x".repeat(48) });
      assert.equal(response.status, 404, `${route} must not exist`);
    }
  } finally {
    api.child.kill("SIGKILL");
    await rm(root, { force: true, recursive: true });
  }
});

test("a configured ceremony issues options only for the exact token", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hc-bootstrap-http-"));
  openOperatorStore({ databasePath: path.join(root, "store.db") }).close();
  const token = "z".repeat(48);
  const digestFile = path.join(root, "token.digest");
  await writeFile(digestFile, createHash("sha256").update(token).digest("hex"));

  const api = await startApi({
    HC_BOOTSTRAP_TOKEN_DIGEST_FILE: digestFile,
    HC_BOOTSTRAP_EXPIRES_AT: new Date(Date.now() + 600_000).toISOString(),
    HC_BOOTSTRAP_OPERATOR_ID: "security-admin",
    HC_BOOTSTRAP_DISPLAY_NAME: "Security Admin",
    HC_BOOTSTRAP_GRANTS: JSON.stringify([{ actions: ["REVOKE_ACCOUNT"], regions: ["*"], categories: ["*"] }])
  }, root);
  try {
    const wrong = await post(api.endpoint, "/v1/bootstrap/options", { token: "y".repeat(48) });
    assert.equal(wrong.status, 403);
    assert.equal((await wrong.json()).error, "BOOTSTRAP_TOKEN_INVALID");

    const right = await post(api.endpoint, "/v1/bootstrap/options", { token });
    assert.equal(right.status, 200);
    const payload = await right.json();
    assert.ok(typeof payload.flow_id === "string" && payload.flow_id.length > 20);
    assert.equal(payload.options.rp.id, "operators.helpconnect.test");
    assert.equal(payload.options.authenticatorSelection.userVerification, "required");
    assert.equal(payload.options.authenticatorSelection.residentKey, "required");

    // Un corps inattendu doit etre refuse, comme sur les autres routes.
    const extra = await post(api.endpoint, "/v1/bootstrap/options", { token, operator_id: "attacker" });
    assert.equal(extra.status >= 400, true);

    // En mode ceremonie seule, aucune route applicative ne repond.
    const session = await fetch(`${api.endpoint}/v1/session`, { headers: { "X-HC-Rate-Key": "abcdefghijklmnop0123" } });
    assert.equal(session.status, 503);
    assert.equal((await session.json()).error, "OPERATOR_REGISTRY_EMPTY");
  } finally {
    api.child.kill("SIGKILL");
    await rm(root, { force: true, recursive: true });
  }
});

test("an expired ceremony refuses even the exact token", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hc-bootstrap-http-"));
  openOperatorStore({ databasePath: path.join(root, "store.db") }).close();
  const token = "w".repeat(48);
  const digestFile = path.join(root, "token.digest");
  await writeFile(digestFile, createHash("sha256").update(token).digest("hex"));

  const api = await startApi({
    HC_BOOTSTRAP_TOKEN_DIGEST_FILE: digestFile,
    HC_BOOTSTRAP_EXPIRES_AT: new Date(Date.now() - 1000).toISOString(),
    HC_BOOTSTRAP_OPERATOR_ID: "security-admin",
    HC_BOOTSTRAP_DISPLAY_NAME: "Security Admin",
    HC_BOOTSTRAP_GRANTS: JSON.stringify([{ actions: ["REVOKE_ACCOUNT"], regions: ["*"], categories: ["*"] }])
  }, root);
  try {
    const response = await post(api.endpoint, "/v1/bootstrap/options", { token });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "BOOTSTRAP_EXPIRED");
  } finally {
    api.child.kill("SIGKILL");
    await rm(root, { force: true, recursive: true });
  }
});
