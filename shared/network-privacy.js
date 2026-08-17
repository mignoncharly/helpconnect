const allowedProtocols = new Set(["http:", "https:"]);

export const forbiddenPrivacyResponseHeaders = Object.freeze([
  "accept-ch",
  "critical-ch",
  "etag",
  "nel",
  "report-to",
  "reporting-endpoints",
  "server-timing",
  "set-cookie"
]);

export function resolvePublicAssetUrl(resource, base) {
  const baseUrl = new URL(base);
  const scopeUrl = new URL(".", baseUrl);
  const targetUrl = new URL(resource, scopeUrl);
  if (!allowedProtocols.has(baseUrl.protocol) || targetUrl.origin !== baseUrl.origin) {
    throw new TypeError("Public assets must stay on the application origin");
  }
  if (targetUrl.username || targetUrl.password || targetUrl.search || targetUrl.hash) {
    throw new TypeError("Public asset URLs cannot carry credentials, a query, or a fragment");
  }
  if (!targetUrl.pathname.startsWith(scopeUrl.pathname)) {
    throw new TypeError("Public assets must stay inside the application scope");
  }
  return targetUrl;
}

export function createPublicAssetRequest(resource, base, options = {}) {
  const url = resolvePublicAssetUrl(resource, base);
  return new Request(url.href, {
    cache: "no-store",
    credentials: "omit",
    method: "GET",
    mode: "same-origin",
    redirect: "error",
    referrerPolicy: "no-referrer",
    ...(options.signal ? { signal: options.signal } : {})
  });
}
