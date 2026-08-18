export const securityAuditCommand = "node scripts/validate-security-audit.mjs";

const requiredWorkflowFragments = Object.freeze([
  ["Pull Request trigger", /^\s{2}pull_request:\s*$/m],
  ["main push trigger", /^\s{4}branches:\s*\n\s{6}- main\s*$/m],
  ["read-only repository permission", /^permissions:\s*\n\s{2}contents: read\s*$/m],
  ["bounded runtime", /^\s{4}timeout-minutes: 20\s*$/m],
  ["official checkout", /uses: actions\/checkout@v7/],
  ["disabled checkout credentials", /persist-credentials: false/],
  ["official Node setup", /uses: actions\/setup-node@v7/],
  ["Node.js 22", /node-version: 22/],
  ["locked dependency install", /run: npm ci\s*$/m],
  ["dependency vulnerability gate", /run: npm audit --audit-level=low\s*$/m],
  ["complete repository validation", /run: npm run validate\s*$/m],
  ["security report generation", /run: npm run security:audit\s*$/m],
  ["report retained on failure", /if: always\(\)/],
  ["security report artifact", /path: reports\/security-audit-report\.json/]
]);

export function validateSecurityAuditPolicy({ workflow, packageJson, lockfile, sources, candidateFiles = [] }) {
  const violations = [];
  if (packageJson.scripts?.["security:audit"] !== securityAuditCommand) violations.push("package.json lacks the exact security audit command");
  if (packageJson.scripts?.["security:check-operator-deployment"] !== "node scripts/check-operator-deployment.mjs") violations.push("package.json lacks the operator deployment check");
  if (!packageJson.scripts?.validate?.endsWith("&& npm run security:audit")) violations.push("the default validation pipeline must end with the security audit");
  if (packageJson.dependencies && Object.keys(packageJson.dependencies).length > 0) violations.push("the public PWA root must not have runtime dependencies");
  if (!Number.isSafeInteger(lockfile.lockfileVersion) || lockfile.lockfileVersion < 3) violations.push("the dependency lockfile format is too old");
  for (const [label, pattern] of requiredWorkflowFragments) if (!pattern.test(workflow)) violations.push(`security workflow lacks ${label}`);
  if (/pull_request_target\s*:|continue-on-error\s*:\s*true|npm audit[^\r\n]*(?:\|\|\s*true|--audit-level=(?:high|critical))/.test(workflow)) violations.push("security workflow contains a bypass or privileged Pull Request trigger");

  const requiredSourceFragments = [
    ["canonical operator origin", sources.operatorConfig, /origin\.origin !== value/],
    ["exact WebAuthn RP binding", sources.operatorConfig, /rpId !== origin\.hostname/],
    ["startup store integrity verification", sources.operatorServer, /store\.verifyIntegrity\(\)/],
    ["single persistence entry point", sources.operatorServer, /openOperatorStore\(/],
    ["full audit journal revalidation", sources.operatorStore, /validateAuditJournal\(events\)/],
    ["audit chain verified before write", sources.operatorStore, /Broken audit journal chain/],
    ["append-only audit journal", sources.operatorStore, /audit journal is append-only/],
    ["persisted bootstrap single use", sources.operatorStore, /bootstrap_ceremonies/],
    ["bootstrap replay refused", sources.operatorBootstrap, /BOOTSTRAP_ALREADY_CONSUMED/],
    ["bootstrap expiry enforced", sources.operatorBootstrap, /BOOTSTRAP_EXPIRED/],
    ["constant-time bootstrap token comparison", sources.operatorBootstrap, /timingSafeEqual/],
    ["bootstrap identity comes from configuration", sources.operatorBootstrap, /id: settings\.operatorId/],
    ["proxy rate partition", sources.operatorServer, /headers\["x-hc-rate-key"\]/],
    ["JSON body cap", sources.operatorServer, /64 \* 1024/],
    ["loopback binding", sources.operatorServer, /server\.listen\(port, "127\.0\.0\.1"/],
    ["request timeout", sources.operatorServer, /server\.requestTimeout = 10_000/],
    ["deny-by-default CSP", sources.securityHeaders, /default-src 'none'/],
    ["Trusted Types", sources.securityHeaders, /require-trusted-types-for 'script'/],
    ["public passkey denial", sources.securityHeaders, /publickey-credentials-get=\(\)/]
  ];
  for (const [label, source, pattern] of requiredSourceFragments) if (!pattern.test(source)) violations.push(`source lacks ${label}`);

  for (const file of candidateFiles) {
    if (/(?:^|\/)(?:\.env(?:\..*)?|id_rsa|id_ed25519)$|\.(?:key|pem|p12|pfx)$/i.test(file)) violations.push(`secret-like file is forbidden: ${file}`);
  }
  for (const [name, content] of Object.entries(sources.secretScan)) {
    if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content) || /"(?:d|p|q|dp|dq|qi)"\s*:/.test(content)) violations.push(`private key material detected in ${name}`);
  }
  return violations;
}
