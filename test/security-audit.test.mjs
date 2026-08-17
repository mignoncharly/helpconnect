import assert from "node:assert/strict";
import test from "node:test";
import { securityAuditCommand, validateSecurityAuditPolicy } from "../scripts/security-audit-policy.mjs";

function validInput() {
  return {
    workflow: `on:\n  pull_request:\n  push:\n    branches:\n      - main\npermissions:\n  contents: read\njobs:\n  audit:\n    timeout-minutes: 20\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          persist-credentials: false\n      - uses: actions/setup-node@v7\n        with:\n          node-version: 22\n      - run: npm ci\n      - run: npm audit --audit-level=low\n      - run: npm run validate\n      - run: npm run security:audit\n      - if: always()\n        uses: actions/upload-artifact@v7\n        with:\n          path: reports/security-audit-report.json\n`,
    packageJson: { scripts: { "security:audit": securityAuditCommand, "security:check-operator-deployment": "node scripts/check-operator-deployment.mjs", validate: `npm test && npm run security:audit` } },
    lockfile: { lockfileVersion: 3 },
    sources: {
      operatorConfig: "origin.origin !== value; rpId !== origin.hostname",
      operatorServer: 'validateAuditJournal(readJsonLines(auditPath)); headers["x-hc-rate-key"]; 64 * 1024; server.listen(port, "127.0.0.1"); server.requestTimeout = 10_000',
      securityHeaders: "default-src 'none'; require-trusted-types-for 'script'; publickey-credentials-get=()",
      secretScan: {}
    },
    candidateFiles: []
  };
}

test("the security audit policy accepts the complete local and CI gate", () => {
  assert.deepEqual(validateSecurityAuditPolicy(validInput()), []);
});

test("privileged, warning-only, weak-audit and secret-bearing mutations are rejected", () => {
  const input = validInput();
  input.workflow += "pull_request_target:\ncontinue-on-error: true\n";
  input.workflow = input.workflow.replace("--audit-level=low", "--audit-level=high || true");
  input.sources.secretScan["config/bad.json"] = '{"d":"private-jwk"}';
  input.candidateFiles.push("operator-api/.env.production", "keys/signing.pem");
  assert.ok(validateSecurityAuditPolicy(input).length >= 5);
});
