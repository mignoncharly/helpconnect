import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { deployableAssets } from "../scripts/build-config.mjs";
import {
  operatorApiHeaders,
  operatorMetaCsp,
  operatorPortalCsp,
  operatorPortalHeaders,
  publicDocumentCsp,
  publicHeadersForAsset,
  publicMetaCsp,
  publicResourceHeaders,
  renderPublicStaticHeaders,
  standaloneFirstAidCsp,
  standaloneFirstAidMetaCsp
} from "../shared/security-headers.js";

const sortedEntries = (value) => Object.entries(value).sort(([left], [right]) => left.localeCompare(right));

function assertCommonHeaders(headers) {
  assert.equal(headers["Cache-Control"], "no-store");
  assert.equal(headers["Strict-Transport-Security"], "max-age=63072000; includeSubDomains");
  assert.equal(headers["Cross-Origin-Opener-Policy"], "same-origin");
  assert.equal(headers["Cross-Origin-Resource-Policy"], "same-origin");
  assert.equal(headers["Origin-Agent-Cluster"], "?1");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["X-XSS-Protection"], "0");
}

test("the public document policy is deny-by-default with header-only anti-framing", () => {
  assert.match(publicDocumentCsp, /^default-src 'none'/);
  assert.match(publicDocumentCsp, /frame-ancestors 'none'/);
  assert.match(publicDocumentCsp, /require-trusted-types-for 'script'/);
  assert.match(publicDocumentCsp, /trusted-types help-connect-static/);
  assert.doesNotMatch(publicDocumentCsp, /unsafe-(?:inline|eval)|https?:\/\//);
  assert.doesNotMatch(publicMetaCsp, /frame-ancestors/);
  assert.equal(publicMetaCsp, publicDocumentCsp.split("; ").filter((directive) => !directive.startsWith("frame-ancestors ")).join("; "));
});

test("only standalone script-free first-aid exports allow inline CSS", () => {
  assert.match(standaloneFirstAidCsp, /script-src 'none'/);
  assert.match(standaloneFirstAidCsp, /style-src 'unsafe-inline'/);
  assert.match(standaloneFirstAidCsp, /connect-src 'none'/);
  assert.doesNotMatch(standaloneFirstAidMetaCsp, /frame-ancestors/);
  assert.doesNotMatch(publicDocumentCsp, /unsafe-inline/);
  assert.doesNotMatch(operatorPortalCsp, /unsafe-inline/);
});

test("every public artifact receives no-store and origin/privacy boundaries", () => {
  for (const asset of deployableAssets) assertCommonHeaders(publicHeadersForAsset(asset));
  assert.match(publicHeadersForAsset("index.html")["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(publicHeadersForAsset("first-aid/complete-fr.html")["Content-Security-Policy"], /script-src 'none'/);
  assert.equal(publicHeadersForAsset("app.js")["Content-Security-Policy"], undefined);
  assert.match(publicResourceHeaders["Permissions-Policy"], /geolocation=\(\)/);
  assert.match(publicResourceHeaders["Permissions-Policy"], /publickey-credentials-get=\(\)/);
});

test("generated static-host policy carries the complete canonical document profiles", () => {
  const value = renderPublicStaticHeaders();
  assert.match(value, /^\/\*/);
  assert.match(value, /\/index\.html\n/);
  assert.match(value, /\/first-aid\/\*/);
  assert.match(value, /Strict-Transport-Security: max-age=63072000; includeSubDomains/);
  assert.match(value, /require-trusted-types-for 'script'/);
});

test("operator portal and API retain passkey separation and exact checked-in headers", async () => {
  assertCommonHeaders(operatorPortalHeaders);
  assertCommonHeaders(operatorApiHeaders);
  assert.match(operatorPortalHeaders["Permissions-Policy"], /publickey-credentials-get=\(self\)/);
  assert.match(operatorApiHeaders["Permissions-Policy"], /publickey-credentials-get=\(\)/);
  assert.doesNotMatch(operatorPortalCsp, /unsafe-(?:inline|eval)/);
  assert.equal(operatorMetaCsp, operatorPortalCsp.split("; ").filter((directive) => !directive.startsWith("frame-ancestors ")).join("; "));
  const checkedIn = JSON.parse(await readFile(new URL("../operator-portal/security-headers.json", import.meta.url), "utf8"));
  assert.deepEqual(sortedEntries(checkedIn), sortedEntries(operatorPortalHeaders));
});
