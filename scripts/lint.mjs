import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoots = [path.join(projectRoot, "src"), path.join(projectRoot, "shared"), path.join(projectRoot, "public"), path.join(projectRoot, "operator-portal", "src"), path.join(projectRoot, "operator-api", "src")];
const violations = [];
const forbiddenPatterns = [
  { label: "external URL", pattern: /\bhttps?:\/\/(?!www\.w3\.org\/2000\/svg(?:\b|["']))/i },
  { label: "dynamic HTML injection", pattern: /\.(?:innerHTML|outerHTML)\s*=/ },
  { label: "document.write", pattern: /\bdocument\.write\s*\(/ },
  { label: "dynamic code execution", pattern: /\b(?:eval|Function)\s*\(/ },
  { label: "persistent localStorage", pattern: /\blocalStorage\b/ },
  { label: "unapproved IndexedDB", pattern: /\bindexedDB\b/ },
  { label: "cookie access", pattern: /\bdocument\.cookie\b/ },
  { label: "geolocation API", pattern: /\bnavigator\.geolocation\b/ },
  { label: "telemetry API", pattern: /\b(?:sendBeacon|analytics|telemetry)\b/i }
];
const publicOnlyPatterns = [
  { label: "unapproved outbound API", pattern: /\b(?:XMLHttpRequest|WebSocket|EventSource)\b/ },
  { label: "fingerprinting API", pattern: /\b(?:AudioContext|OfflineAudioContext|RTCPeerConnection|getBattery|enumerateDevices)\b|\bnavigator\.(?:deviceMemory|hardwareConcurrency|languages|mimeTypes|platform|plugins|userAgent)\b|\b(?:randomUUID|getRandomValues)\s*\(/ }
];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectFiles(entryPath) : [entryPath];
  }));
  return nested.flat();
}

for (const file of (await Promise.all(sourceRoots.map(collectFiles))).flat()) {
  const content = await readFile(file, "utf8");
  for (const rule of forbiddenPatterns) {
    const isPanicWipeStorageCapability = path.resolve(file) === path.join(projectRoot, "shared", "panic-wipe.js")
      && (rule.label === "persistent localStorage" || rule.label === "unapproved IndexedDB");
    if (isPanicWipeStorageCapability) continue;
    if (rule.pattern.test(content)) {
      violations.push(`${path.relative(projectRoot, file)}: ${rule.label}`);
    }
  }
  const relative = path.relative(projectRoot, file).replace(/\\/g, "/");
  if (relative.startsWith("src/") || relative.startsWith("public/") || relative.startsWith("shared/")) {
    for (const rule of publicOnlyPatterns) {
      if (rule.pattern.test(content)) violations.push(`${relative}: ${rule.label}`);
    }
  }
}

for (const relativeHtml of ["src/index.html", "operator-portal/src/index.html"]) {
  const html = await readFile(path.join(projectRoot, relativeHtml), "utf8");
  if (/<(?:script|style)(?![^>]*\bsrc=)[^>]*>[^<]/i.test(html)) violations.push(`${relativeHtml}: inline script or style`);
  if (/\son[a-z]+\s*=/i.test(html)) violations.push(`${relativeHtml}: inline event handler`);
}

if (violations.length > 0) {
  throw new Error(`Source policy violations:\n${violations.join("\n")}`);
}

console.log("Source policy lint passed");
