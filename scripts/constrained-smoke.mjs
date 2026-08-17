import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { constrainedProfile, criticalScenario, requiredMatrixDimensions, validateConstrainedMatrix } from "./constrained-matrix.mjs";
import { deployableAssets } from "./build-config.mjs";
import { publicHeadersForAsset } from "../shared/security-headers.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "dist");
const allowedAssets = new Set(deployableAssets);
const browserCandidates = [
  ...(process.env.HC_SMOKE_BROWSER ? [process.env.HC_SMOKE_BROWSER] : []),
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium"
];
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json"]
]);
const progress = (step) => console.error(`[constrained] ${step}`);

async function findBrowser() {
  for (const candidate of browserCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next local Chromium installation.
    }
  }
  throw new Error("Chrome or Edge is required for the constrained test");
}

function startServer() {
  const audit = [];
  const drops = new Map();
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const assetName = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.slice(1);
    const remainingDrops = drops.get(assetName) ?? 0;
    if (remainingDrops > 0) {
      drops.set(assetName, remainingDrops - 1);
      audit.push({ asset: assetName, outcome: "dropped" });
      request.socket.destroy();
      return;
    }
    audit.push({ asset: assetName, outcome: "served" });
    if (!allowedAssets.has(assetName)) {
      response.writeHead(404).end("Not found");
      return;
    }
    try {
      const content = await readFile(path.join(outputDirectory, assetName));
      response.writeHead(200, {
        ...publicHeadersForAsset(assetName),
        "Content-Type": mimeTypes.get(path.extname(assetName)) ?? "application/octet-stream"
      });
      response.end(content);
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : "Read error");
    }
  });
  server.audit = audit;
  server.drops = drops;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function stopServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

function connectToPage(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map();
  const eventWaiters = new Map();
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (typeof message.id === "number") {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) callback?.reject(new Error(message.error.message));
      else callback?.resolve(message.result);
      return;
    }
    const callbacks = eventWaiters.get(message.method) ?? [];
    eventWaiters.delete(message.method);
    for (const callback of callbacks) callback(message.params);
  });
  return {
    async send(method, params = {}) {
      await opened;
      const id = nextId;
      nextId += 1;
      const result = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for ${method}`));
        }, 120_000);
        pending.set(id, {
          reject(error) { clearTimeout(timeout); reject(error); },
          resolve(value) { clearTimeout(timeout); resolve(value); }
        });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
    waitForEvent(method, timeoutMilliseconds = 60_000) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMilliseconds);
        const callbacks = eventWaiters.get(method) ?? [];
        callbacks.push((params) => { clearTimeout(timeout); resolve(params); });
        eventWaiters.set(method, callbacks);
      });
    },
    close() { socket.close(); }
  };
}

async function waitForDevToolsPort(profileDirectory) {
  const portFile = path.join(profileDirectory, "DevToolsActivePort");
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const [port] = (await readFile(portFile, "utf8")).split(/\r?\n/);
      if (port) return Number(port);
    } catch {
      // Browser startup has not written the port yet.
    }
    await delay(50);
  }
  throw new Error("Timed out waiting for the constrained browser");
}

async function launchBrowser(browserPath, profileDirectory) {
  await rm(path.join(profileDirectory, "DevToolsActivePort"), { force: true });
  const browser = spawn(browserPath, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-gpu",
    "--no-default-browser-check",
    "--no-first-run",
    "--no-sandbox",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDirectory}`,
    "about:blank"
  ], { stdio: "ignore", windowsHide: true });
  const debuggingPort = await waitForDevToolsPort(profileDirectory);
  const pageResponse = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
  const pages = await pageResponse.json();
  const page = pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
  if (!page) throw new Error("Could not find the constrained browser page");
  const client = connectToPage(page.webSocketDebuggerUrl);
  await Promise.all([client.send("Page.enable"), client.send("Runtime.enable"), client.send("Network.enable")]);
  await client.send("Emulation.setDeviceMetricsOverride", constrainedProfile.viewport);
  await client.send("Emulation.setCPUThrottlingRate", { rate: constrainedProfile.cpuThrottlingRate });
  try {
    await client.send("Emulation.setHardwareConcurrencyOverride", { hardwareConcurrency: constrainedProfile.hardwareConcurrency });
  } catch {
    // The CPU throttle remains authoritative if this experimental override is unavailable.
  }
  return { browser, client };
}

async function closeBrowser(session) {
  if (!session) return;
  const exited = session.browser.exitCode === null ? once(session.browser, "exit") : Promise.resolve();
  try {
    await session.client.send("Browser.close");
  } catch {
    session.browser.kill();
  }
  session.client.close();
  await Promise.race([exited, delay(15_000)]);
  if (session.browser.exitCode === null) session.browser.kill();
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
  return result.result.value;
}

async function navigate(client, url) {
  const loaded = client.waitForEvent("Page.loadEventFired");
  await client.send("Page.navigate", { url });
  await loaded;
}

function networkConditions(offline) {
  return offline ? {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
    connectionType: "none"
  } : {
    offline: false,
    ...constrainedProfile.network
  };
}

const matrixViolations = validateConstrainedMatrix({
  profile: constrainedProfile,
  scenario: criticalScenario,
  dimensions: requiredMatrixDimensions
});
if (matrixViolations.length > 0) throw new Error(matrixViolations.join("\n"));

const browserPath = await findBrowser();
const profileDirectory = await mkdtemp(path.join(tmpdir(), "help-connect-constrained-"));
let server;
let session;
let quotaOverridden = false;
const evidence = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  execution: {
    androidAvd: "available-but-not-executed",
    browser: path.basename(browserPath),
    physicalAndroid: "not-available",
    runtime: "desktop Chromium with DevTools constraints"
  },
  profile: constrainedProfile,
  scenario: [],
  matrix: requiredMatrixDimensions.map((dimension) => ({
    ...dimension,
    status: dimension.evidence === "physical-required" || dimension.evidence === "android-emulator-or-physical" ? "NOT_RUN" : "PENDING"
  }))
};

try {
  server = await startServer();
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not determine constrained server port");
  const appUrl = `http://127.0.0.1:${address.port}/`;
  const origin = new URL(appUrl).origin;
  session = await launchBrowser(browserPath, profileDirectory);
  await navigate(session.client, appUrl);
  progress("initial-load");

  const prepared = await evaluate(session.client, `(async () => {
    await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error('worker timeout')), 30000))]);
    const localeChecks = [];
    const chooseLanguage = async (locale) => {
      document.querySelector('[data-screen="home"] [data-navigate="settings"]').click();
      document.querySelector('input[name="language"][value="' + locale + '"]').click();
      const deadline = Date.now() + 15000;
      while (document.documentElement.lang !== locale && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      localeChecks.push({ direction: document.documentElement.dir, language: document.documentElement.lang });
    };
    await chooseLanguage('en');
    await chooseLanguage('ur');
    await chooseLanguage('fr');
    document.querySelector('input[name="theme"][value="dark"]').click();
    document.querySelector('[data-bottom-nav] [data-navigate="map"]').click();
    const mapDeadline = Date.now() + 15000;
    while (document.querySelectorAll('[data-region-select] option').length !== 2 && Date.now() < mapDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
    document.querySelector('[data-install-region]').click();
    document.querySelector('[data-consent-confirm]').click();
    const regionDeadline = Date.now() + 15000;
    while (document.querySelectorAll('[data-map-point]').length !== 3 && Date.now() < regionDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
    document.querySelector('[data-bottom-nav] [data-navigate="first-aid"]').click();
    document.querySelector('[data-install-first-aid]').click();
    document.querySelector('[data-consent-confirm]').click();
    const aidDeadline = Date.now() + 15000;
    while (!document.querySelector('[data-first-aid-status]').textContent.includes('4') && Date.now() < aidDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      controlled: Boolean(navigator.serviceWorker.controller),
      direction: document.documentElement.dir,
      language: document.documentElement.lang,
      localeChecks,
      mapPoints: document.querySelectorAll('[data-map-point]').length,
      noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      theme: document.documentElement.dataset.theme
    };
  })()`);
  if (!prepared.controlled
    || prepared.language !== "fr"
    || prepared.direction !== "ltr"
    || JSON.stringify(prepared.localeChecks) !== JSON.stringify([
      { direction: "ltr", language: "en" },
      { direction: "rtl", language: "ur" },
      { direction: "ltr", language: "fr" }
    ])
    || prepared.theme !== "dark"
    || prepared.mapPoints !== 3
    || !prepared.noHorizontalOverflow) {
    throw new Error(`Constrained preparation failed: ${JSON.stringify(prepared)}`);
  }
  progress("offline-packages-prepared");
  evidence.scenario.push({ step: "load", status: "PASS", prepared });

  const usage = await session.client.send("Storage.getUsageAndQuota", { origin });
  const constrainedQuota = Math.ceil(usage.usage + constrainedProfile.quotaHeadroomBytes);
  await session.client.send("Storage.overrideQuotaForOrigin", { origin, quotaSize: constrainedQuota });
  quotaOverridden = true;
  const constrainedUsage = await session.client.send("Storage.getUsageAndQuota", { origin });
  if (!constrainedUsage.overrideActive || constrainedUsage.quota - constrainedUsage.usage > constrainedProfile.quotaHeadroomBytes + 1) {
    throw new Error(`Storage pressure was not applied: ${JSON.stringify(constrainedUsage)}`);
  }

  await session.client.send("Network.emulateNetworkConditions", networkConditions(true));
  evidence.scenario.push({ step: "disconnect", status: "PASS" });
  await closeBrowser(session);
  session = undefined;
  progress("browser-closed-offline");
  evidence.scenario.push({ step: "close-browser", status: "PASS" });

  session = await launchBrowser(browserPath, profileDirectory);
  await session.client.send("Network.emulateNetworkConditions", networkConditions(true));
  await navigate(session.client, appUrl);
  progress("browser-reopened-offline");
  evidence.scenario.push({ step: "reopen-offline", status: "PASS" });

  const offlineUse = await evaluate(session.client, `(async () => {
    document.querySelector('[data-bottom-nav] [data-navigate="search"]').click();
    const form = document.querySelector('[data-screen="search"] [data-search-form]');
    form.querySelector('[data-search-input]').value = 'hôpital';
    form.requestSubmit();
    const searchDeadline = Date.now() + 10000;
    while (document.querySelectorAll('[data-screen="search"] [data-directory-point]').length !== 1 && Date.now() < searchDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
    const hospitalCount = document.querySelectorAll('[data-screen="search"] [data-directory-point]').length;
    document.querySelector('[data-bottom-nav] [data-navigate="first-aid"]').click();
    const aidDeadline = Date.now() + 10000;
    while (!document.querySelector('[data-first-aid-status]').textContent.includes('4') && Date.now() < aidDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
    document.querySelector('[data-guide-id="severe-bleeding"]').click();
    const guideDeadline = Date.now() + 10000;
    while (document.querySelector('[data-screen="first-aid-detail"]').hidden && Date.now() < guideDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
    const guideSteps = document.querySelectorAll('[data-guide-steps] li').length;
    document.querySelector('[data-bottom-nav] [data-navigate="map"]').click();
    const mapDeadline = Date.now() + 20000;
    while ((document.querySelectorAll('[data-map-point]').length !== 3 || document.querySelector('[data-update-region]').disabled) && Date.now() < mapDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
    document.querySelector('[data-screen="map"] [data-network-mode="text"]').click();
    return {
      guideSteps,
      hospitalCount,
      mapPoints: document.querySelectorAll('[data-map-point]').length,
      mode: document.documentElement.dataset.networkMode,
      updateDisabled: document.querySelector('[data-update-region]').disabled,
      visualsHidden: [...document.querySelectorAll('[data-map-visual]')].every((item) => item.hidden)
    };
  })()`);
  if (offlineUse.hospitalCount !== 1 || offlineUse.guideSteps < 3 || offlineUse.mapPoints !== 3 || offlineUse.updateDisabled || offlineUse.mode !== "text" || !offlineUse.visualsHidden) {
    throw new Error(`Critical offline use failed: ${JSON.stringify(offlineUse)}`);
  }
  progress("offline-search-aid-text");
  evidence.scenario.push({ step: "search-hospital", status: "PASS", count: offlineUse.hospitalCount });
  evidence.scenario.push({ step: "open-first-aid", status: "PASS", steps: offlineUse.guideSteps });
  evidence.scenario.push({ step: "enable-text-mode", status: "PASS" });

  await session.client.send("Network.emulateNetworkConditions", networkConditions(false));
  evidence.scenario.push({ step: "restore-very-slow-network", status: "PASS", network: constrainedProfile.network });
  const lossyAssets = [
    "updates/index.json", "updates/index.json.sig.json",
    "updates/demo-north.1-2.delta.json", "updates/demo-north.1-2.delta.json.sig.json",
    "updates/demo-north.2-3.delta.json", "updates/demo-north.2-3.delta.json.sig.json"
  ];
  for (const asset of lossyAssets) server.drops.set(asset, 1);
  const update = await evaluate(session.client, `(async () => {
    const controlsDeadline = Date.now() + 30000;
    while (document.querySelector('[data-update-region]').disabled && Date.now() < controlsDeadline) await new Promise((resolve) => setTimeout(resolve, 50));
    if (document.querySelector('[data-update-region]').disabled) return { mode: document.documentElement.dataset.networkMode, version: 0, disabled: true };
    document.querySelector('[data-update-region]').click();
    const deadline = Date.now() + 60000;
    let version = 0;
    while (Date.now() < deadline) {
      const response = await caches.match(new URL('./regions/demo-north.min.json', document.baseURI).href);
      if (response) version = (await response.clone().json()).datasetVersion;
      if (version === 3 && !document.querySelector('[data-update-region]').disabled) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { mode: document.documentElement.dataset.networkMode, version };
  })()`);
  const droppedRequests = server.audit.filter(({ outcome }) => outcome === "dropped").length;
  if (update.version !== 3 || update.mode !== "text" || droppedRequests !== lossyAssets.length) {
    throw new Error(`Lossy 2G update failed: ${JSON.stringify({ update, droppedRequests })}`);
  }
  progress("lossy-2g-delta");
  evidence.scenario.push({ step: "receive-signed-delta", status: "PASS", droppedRequests, version: update.version });

  await session.client.send("DOMStorage.enable");
  await session.client.send("IndexedDB.enable");
  const registrationEvent = session.client.waitForEvent("ServiceWorker.workerRegistrationUpdated");
  await session.client.send("ServiceWorker.enable");
  const initialRegistrations = (await registrationEvent).registrations;
  if (!initialRegistrations.some((registration) => registration.scopeURL.startsWith(appUrl) && !registration.isDeleted)) {
    throw new Error(`Panic Wipe precondition has no active registration: ${JSON.stringify(initialRegistrations)}`);
  }
  const removedRegistrationEvent = session.client.waitForEvent("ServiceWorker.workerRegistrationUpdated");
  const panicNavigation = session.client.waitForEvent("Page.frameNavigated");
  try {
    await session.client.send("Runtime.evaluate", { expression: "document.querySelector('[data-panic-wipe]').click()", returnByValue: true });
  } catch {
    // Panic Wipe may destroy the execution context before the command returns.
  }
  const [panicFrame, removedRegistrationUpdate] = await Promise.all([panicNavigation, removedRegistrationEvent]);
  evidence.scenario.push({ step: "panic-wipe", status: panicFrame.frame.url === "about:blank" ? "PASS" : "FAIL" });
  const registrationRemoved = removedRegistrationUpdate.registrations.some((registration) => registration.scopeURL.startsWith(appUrl) && registration.isDeleted);
  const [cacheState, databaseState, localState, sessionState] = await Promise.all([
    session.client.send("CacheStorage.requestCacheNames", { securityOrigin: origin }),
    session.client.send("IndexedDB.requestDatabaseNames", { securityOrigin: origin }),
    session.client.send("DOMStorage.getDOMStorageItems", { storageId: { securityOrigin: origin, isLocalStorage: true } }),
    session.client.send("DOMStorage.getDOMStorageItems", { storageId: { securityOrigin: origin, isLocalStorage: false } })
  ]);
  const storageEvidence = {
    caches: cacheState.caches.length,
    databases: databaseState.databaseNames.length,
    localStorage: localState.entries.length,
    serviceWorkers: registrationRemoved ? 0 : 1,
    sessionStorage: sessionState.entries.length
  };
  if (Object.values(storageEvidence).some((count) => count !== 0)) throw new Error(`Storage survived Panic Wipe: ${JSON.stringify(storageEvidence)}`);
  evidence.scenario.push({ step: "inspect-all-storage", status: "PASS", ...storageEvidence });
  progress("panic-storage-empty");

  for (const row of evidence.matrix) {
    if (row.status === "PENDING") row.status = "PASS_SIMULATED";
  }
  evidence.storagePressure = {
    headroomBytes: constrainedUsage.quota - constrainedUsage.usage,
    overrideActive: constrainedUsage.overrideActive
  };
  evidence.networkEvidence = { droppedRequests, totalRequests: server.audit.length };
  evidence.result = "PASS_WITH_PHYSICAL_GAPS";
  await writeFile(path.join(projectRoot, "reports", "phase-16-evidence.json"), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(`Constrained critical scenario passed in ${path.basename(browserPath)}; physical Android and high-brightness rows remain NOT_RUN`);
} finally {
  if (session && quotaOverridden && server) {
    const address = server.address();
    if (address && typeof address !== "string") {
      try {
        await session.client.send("Storage.overrideQuotaForOrigin", { origin: `http://127.0.0.1:${address.port}` });
      } catch {
        // The disposable profile is removed below.
      }
    }
  }
  await closeBrowser(session);
  if (server) await stopServer(server);
  await rm(profileDirectory, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
}
