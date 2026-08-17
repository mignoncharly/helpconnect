import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { validateOperatorOrigin } from "../operator-api/src/config-validation.mjs";
import { operatorApiHeaders, operatorPortalHeaders } from "../shared/security-headers.js";

const rawTarget = process.argv[2];
if (!rawTarget) throw new Error("Usage: npm run security:check-operator-deployment -- https://operators.example/");
let deploymentUrl;
try {
  deploymentUrl = new URL(rawTarget);
} catch {
  throw new Error("Operator deployment URL must be a clean HTTPS root URL");
}
if (deploymentUrl.pathname !== "/" || deploymentUrl.search || deploymentUrl.hash || deploymentUrl.username || deploymentUrl.password) throw new Error("Operator deployment URL must be a clean HTTPS root URL");
const target = validateOperatorOrigin(deploymentUrl.origin);

const portal = await readResponse(target);
assertResponse(portal, 200, operatorPortalHeaders, "operator portal");
if (!String(portal.headers["content-type"] ?? "").startsWith("text/html")) throw new Error("Operator root is not HTML");
if (portal.headers["set-cookie"] || portal.headers["access-control-allow-origin"]) throw new Error("Operator root exposes a cookie or CORS policy before authentication");

const sessionUrl = new URL("/v1/session", target);
const session = await readResponse(sessionUrl);
assertResponse(session, 401, operatorApiHeaders, "unauthenticated operator API");
const sessionBody = JSON.parse(session.body);
if (sessionBody.error !== "AUTH_REQUIRED" || typeof sessionBody.request_id !== "string" || sessionBody.request_id !== session.headers["x-request-id"] || session.headers["set-cookie"] || session.headers["access-control-allow-origin"]) throw new Error("Unauthenticated session boundary is inconsistent");

const polluted = await readResponse(new URL("/v1/session?ignored=true", target));
assertResponse(polluted, 400, operatorApiHeaders, "query rejection");
const crossOrigin = await readResponse(new URL("/v1/auth/options", target), {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://cross-origin.invalid" },
  body: "{}"
});
assertResponse(crossOrigin, 403, operatorApiHeaders, "cross-origin authentication rejection");

for (const response of [portal, session, polluted, crossOrigin]) if (!response.tlsProtocol || !["TLSv1.2", "TLSv1.3"].includes(response.tlsProtocol)) throw new Error(`Unsupported TLS protocol: ${String(response.tlsProtocol)}`);

const insecureTarget = new URL(target);
insecureTarget.protocol = "http:";
if (target.port === "443") insecureTarget.port = "80";
const redirect = await readResponse(insecureTarget);
if (![301, 308].includes(redirect.status)) throw new Error(`Operator HTTP endpoint did not permanently redirect: ${redirect.status}`);
const location = new URL(String(redirect.headers.location ?? ""), insecureTarget);
if (location.origin !== target.origin || location.pathname !== "/" || location.search || location.hash) throw new Error("Operator HTTP redirect does not preserve the clean HTTPS origin");

console.log(`Operator deployment security passed: ${target.origin} (${portal.tlsProtocol})`);

function assertResponse(response, expectedStatus, expectedHeaders, label) {
  if (response.status !== expectedStatus) throw new Error(`${label} returned ${response.status}`);
  for (const [name, value] of Object.entries(expectedHeaders)) {
    const received = response.headers[name.toLowerCase()];
    if (received !== value) throw new Error(`${label} ${name} mismatch: ${String(received)}`);
  }
}

function readResponse(url, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ?? "";
    const headers = { "User-Agent": "HELP-CONNECT-operator-deployment-check/1", ...options.headers };
    if (body) headers["Content-Length"] = Buffer.byteLength(body);
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      headers,
      method: options.method ?? "GET",
      timeout: 10_000
    }, (response) => {
      const tlsProtocol = "getProtocol" in response.socket ? response.socket.getProtocol() : undefined;
      const chunks = [];
      let length = 0;
      response.on("data", (chunk) => {
        length += chunk.length;
        if (length > 128 * 1024) request.destroy(new Error("Deployment response exceeds inspection limit"));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve({ body: Buffer.concat(chunks).toString("utf8"), headers: response.headers, status: response.statusCode ?? 0, tlsProtocol }));
    });
    request.once("error", reject);
    request.once("timeout", () => request.destroy(new Error("Deployment check timed out")));
    request.end(body);
  });
}
