import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { publicHeadersForAsset } from "../shared/security-headers.js";
import { forbiddenPrivacyResponseHeaders } from "../shared/network-privacy.js";

const rawTarget = process.argv[2];
if (!rawTarget) throw new Error("Usage: npm run security:check-deployment -- https://public.example/");
const target = new URL(rawTarget);
if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash) throw new Error("Deployment URL must be a clean HTTPS URL");
target.pathname = target.pathname.endsWith("/") ? target.pathname : `${target.pathname}/`;

const secureResponse = await readResponse(target);
if (secureResponse.status !== 200) throw new Error(`HTTPS document returned ${secureResponse.status}`);
for (const [name, value] of Object.entries(publicHeadersForAsset("index.html"))) {
  const received = secureResponse.headers[name.toLowerCase()];
  if (received !== value) throw new Error(`${name} mismatch: ${String(received)}`);
}
for (const header of forbiddenPrivacyResponseHeaders) {
  if (secureResponse.headers[header]) throw new Error(`Public origin exposes privacy-sensitive response header: ${header}`);
}
if (!String(secureResponse.headers["content-type"] ?? "").startsWith("text/html")) throw new Error("Public root is not HTML");
if (!secureResponse.tlsProtocol || !["TLSv1.2", "TLSv1.3"].includes(secureResponse.tlsProtocol)) throw new Error(`Unsupported TLS protocol: ${String(secureResponse.tlsProtocol)}`);

const headResponse = await readResponse(target, { method: "HEAD" });
if (headResponse.status !== 200 || headResponse.headers["set-cookie"] || headResponse.headers["access-control-allow-origin"]) throw new Error("Public HEAD boundary is inconsistent");
for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
  const mutationResponse = await readResponse(target, { method });
  if (![403, 404, 405].includes(mutationResponse.status) || mutationResponse.headers["set-cookie"] || mutationResponse.headers["access-control-allow-origin"]) {
    throw new Error(`Public origin did not reject ${method} cleanly: ${mutationResponse.status}`);
  }
}

const insecureTarget = new URL(target);
insecureTarget.protocol = "http:";
if (target.port === "443") insecureTarget.port = "80";
const redirectResponse = await readResponse(insecureTarget);
if (![301, 308].includes(redirectResponse.status)) throw new Error(`HTTP endpoint did not permanently redirect: ${redirectResponse.status}`);
const location = new URL(String(redirectResponse.headers.location ?? ""), insecureTarget);
if (location.protocol !== "https:" || location.host !== target.host || location.pathname !== target.pathname) throw new Error("HTTP redirect does not preserve the HTTPS target");

console.log(`Public deployment security passed: ${target.href} (${secureResponse.tlsProtocol})`);

function readResponse(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
      headers: { "User-Agent": "HELP-CONNECT-deployment-check/1" },
      method: options.method ?? "GET",
      timeout: 10_000
    }, (response) => {
      const tlsProtocol = "getProtocol" in response.socket ? response.socket.getProtocol() : undefined;
      let length = 0;
      response.on("data", (chunk) => {
        length += chunk.length;
        if (length > 128 * 1024) request.destroy(new Error("Deployment response exceeds inspection limit"));
      });
      response.on("end", () => resolve({ headers: response.headers, status: response.statusCode ?? 0, tlsProtocol }));
    });
    request.once("error", reject);
    request.once("timeout", () => request.destroy(new Error("Deployment check timed out")));
    request.end();
  });
}
