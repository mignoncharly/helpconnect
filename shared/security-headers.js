const hsts = "max-age=63072000; includeSubDomains";
const cacheControl = "no-store";

export const publicDocumentCsp = [
  "default-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "style-src-attr 'none'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "manifest-src 'self'",
  "worker-src 'self'",
  "font-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types help-connect-static"
].join("; ");

export const publicMetaCsp = publicDocumentCsp
  .split("; ")
  .filter((directive) => !directive.startsWith("frame-ancestors "))
  .join("; ");

export const standaloneFirstAidCsp = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'none'",
  "connect-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join("; ");

export const standaloneFirstAidMetaCsp = standaloneFirstAidCsp
  .split("; ")
  .filter((directive) => !directive.startsWith("frame-ancestors "))
  .join("; ");

export const operatorPortalCsp = [
  "default-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "style-src-attr 'none'",
  "connect-src 'self'",
  "img-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "require-trusted-types-for 'script'",
  "trusted-types 'none'"
].join("; ");

export const operatorMetaCsp = operatorPortalCsp
  .split("; ")
  .filter((directive) => !directive.startsWith("frame-ancestors "))
  .join("; ");

const sharedBrowserHeaders = Object.freeze({
  "Cache-Control": cacheControl,
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": hsts,
  "X-Content-Type-Options": "nosniff",
  "X-DNS-Prefetch-Control": "off",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-XSS-Protection": "0"
});

const publicPermissions = "geolocation=(), camera=(), microphone=(), payment=(), usb=(), serial=(), hid=(), publickey-credentials-get=()";
const operatorPermissions = "publickey-credentials-get=(self), geolocation=(), camera=(), microphone=(), payment=(), usb=(), serial=(), hid=()";

export const publicResourceHeaders = Object.freeze({
  ...sharedBrowserHeaders,
  "Permissions-Policy": publicPermissions
});

export const operatorPortalHeaders = Object.freeze({
  ...sharedBrowserHeaders,
  "Content-Security-Policy": operatorPortalCsp,
  "Permissions-Policy": operatorPermissions
});

export const operatorApiHeaders = Object.freeze({
  ...sharedBrowserHeaders,
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=(), usb=(), serial=(), hid=(), publickey-credentials-get=()"
});

export function publicHeadersForAsset(assetName) {
  const normalizedName = assetName.replace(/^\/+/, "");
  const headers = { ...publicResourceHeaders };
  if (normalizedName === "" || normalizedName === "index.html") {
    headers["Content-Security-Policy"] = publicDocumentCsp;
  } else if (/^first-aid\/complete-(?:fr|en|ur)\.html$/.test(normalizedName)) {
    headers["Content-Security-Policy"] = standaloneFirstAidCsp;
  }
  return headers;
}

function renderHeaderBlock(path, headers) {
  return `${path}\n${Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`).join("\n")}`;
}

export function renderPublicStaticHeaders() {
  return `${[
    renderHeaderBlock("/*", publicResourceHeaders),
    renderHeaderBlock("/", publicHeadersForAsset("index.html")),
    renderHeaderBlock("/index.html", publicHeadersForAsset("index.html")),
    renderHeaderBlock("/first-aid/*", { ...publicResourceHeaders, "Content-Security-Policy": standaloneFirstAidCsp })
  ].join("\n\n")}\n`;
}
