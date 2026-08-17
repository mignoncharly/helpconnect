import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { deployableAssets, serviceWorkerPrecacheAssets } from "./build-config.mjs";
import { publicHeadersForAsset } from "../shared/security-headers.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(projectRoot, "dist");
const browserCandidates = [
  ...(process.env.HC_SMOKE_BROWSER ? [process.env.HC_SMOKE_BROWSER] : []),
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
];
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json"]
]);
const allowedAssets = new Set(deployableAssets);
const debug = process.env.HC_SMOKE_DEBUG === "1";
const debugStep = (value) => { if (debug) console.error(`[smoke] ${value}`); };

async function findBrowser() {
  for (const candidate of browserCandidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next known installation path.
    }
  }
  throw new Error("Chrome or Edge is required for the offline smoke test");
}

function startServer() {
  const privacyAudit = [];
  const responseDelays = new Map();
  const server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://localhost");
    const pathname = requestUrl.pathname;
    const assetName = pathname === "/" ? "index.html" : pathname.slice(1);
    privacyAudit.push({
      cookie: request.headers.cookie ?? "",
      method: request.method ?? "",
      pathname,
      query: requestUrl.search,
      referer: request.headers.referer ?? ""
    });

    if (!allowedAssets.has(assetName)) {
      response.writeHead(404).end("Not found");
      return;
    }

    try {
      const delayQueue = responseDelays.get(assetName);
      const responseDelay = delayQueue?.shift() ?? 0;
      if (responseDelay > 0) await delay(responseDelay);
      const content = await readFile(path.join(outputDirectory, assetName));
      const securityHeaders = publicHeadersForAsset(assetName);
      response.writeHead(200, {
        ...securityHeaders,
        "Content-Type": mimeTypes.get(path.extname(assetName)) ?? "application/octet-stream",
      });
      response.end(content);
    } catch (error) {
      response.writeHead(500).end(error instanceof Error ? error.message : "Read error");
    }
  });
  server.privacyAudit = privacyAudit;
  server.responseDelays = responseDelays;

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

async function waitForDevToolsPort(profileDirectory) {
  const portFile = path.join(profileDirectory, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const [port] = (await readFile(portFile, "utf8")).split(/\r?\n/);
      if (port) {
        return Number(port);
      }
    } catch {
      await delay(50);
    }
  }
  throw new Error("Timed out waiting for the browser debugging port");
}

function connectToPage(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  let nextId = 1;
  const pending = new Map();
  const eventWaiters = new Map();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (typeof message.id === "number") {
      const callback = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        callback?.reject(new Error(message.error.message));
      } else {
        callback?.resolve(message.result);
      }
      return;
    }

    const callbacks = eventWaiters.get(message.method) ?? [];
    eventWaiters.delete(message.method);
    for (const callback of callbacks) {
      callback(message.params);
    }
  });

  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
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
        }, 30_000);
        pending.set(id, {
          reject(error) {
            clearTimeout(timeout);
            reject(error);
          },
          resolve(value) {
            clearTimeout(timeout);
            resolve(value);
          }
        });
      });
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    },
    waitForEvent(method, timeoutMilliseconds = 10000) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeoutMilliseconds);
        const callbacks = eventWaiters.get(method) ?? [];
        callbacks.push((params) => {
          clearTimeout(timeout);
          resolve(params);
        });
        eventWaiters.set(method, callbacks);
      });
    },
    close() {
      socket.close();
    }
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    const description = result.exceptionDetails.exception?.description;
    throw new Error(description ?? result.exceptionDetails.text ?? "Browser evaluation failed");
  }
  return result.result.value;
}

const browserPath = await findBrowser();
const profileDirectory = await mkdtemp(path.join(tmpdir(), "help-connect-browser-"));
let server;
let browser;
let client;

try {
  server = await startServer();
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Could not determine smoke-test server port");
  }
  const appUrl = `http://127.0.0.1:${address.port}/`;

  browser = spawn(browserPath, [
    "--headless=new",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-features=SkiaGraphite",
    "--disable-gpu",
    "--disable-gpu-compositing",
    "--disable-gpu-shader-disk-cache",
    "--disable-software-rasterizer",
    "--disable-skia-graphite",
    // The managed Windows runner otherwise crashes its sandboxed Dawn cache before CDP starts.
    // This browser only opens the loopback test origin in a disposable profile.
    "--no-sandbox",
    "--no-default-browser-check",
    "--no-first-run",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDirectory}`,
    "about:blank"
  ], { stdio: debug ? ["ignore", "inherit", "inherit"] : "ignore", windowsHide: true });

  const debuggingPort = await waitForDevToolsPort(profileDirectory);
  const pageResponse = await fetch(`http://127.0.0.1:${debuggingPort}/json/list`);
  if (!pageResponse.ok) {
    throw new Error(`Could not inspect browser pages: ${pageResponse.status}`);
  }
  const pages = await pageResponse.json();
  const page = pages.find((candidate) => candidate.type === "page" && candidate.webSocketDebuggerUrl);
  if (!page) throw new Error("Could not find the browser page");
  client = connectToPage(page.webSocketDebuggerUrl);
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true
  });

  let loaded = client.waitForEvent("Page.loadEventFired");
  await client.send("Page.navigate", { url: appUrl });
  await loaded;
  debugStep("page-load");
  const headerProbe = await fetch(appUrl, { cache: "no-store", redirect: "manual" });
  const expectedDocumentHeaders = publicHeadersForAsset("index.html");
  for (const [name, value] of Object.entries(expectedDocumentHeaders)) {
    if (headerProbe.headers.get(name) !== value) throw new Error(`Unexpected ${name} on the public document response`);
  }
  if (headerProbe.headers.has("set-cookie")) throw new Error("Public document response must not set a cookie");
  await headerProbe.arrayBuffer();
  debugStep("headers");

  const screenshot = await client.send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(projectRoot, "reports", "ui-home.png"), Buffer.from(screenshot.data, "base64"));

  const onlineState = await evaluate(client, `(async () => {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Service Worker readiness timeout')), 30000))
    ]);
    const deadline = Date.now() + 30000;
    while (!navigator.serviceWorker.controller && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const cacheNames = await caches.keys();
    const shellCacheName = cacheNames.find((name) => name.startsWith('hc-shell-'));
    const cache = await caches.open(shellCacheName);
    const requests = await cache.keys();
    let dynamicCodeBlocked = false;
    let htmlSinkBlocked = false;
    let unapprovedPolicyBlocked = false;
    try { Function('return 1')(); } catch { dynamicCodeBlocked = true; }
    try { document.createElement('div').innerHTML = '<span></span>'; } catch { htmlSinkBlocked = true; }
    try { window.trustedTypes?.createPolicy('unapproved', { createHTML: (value) => value }); } catch { unapprovedPolicyBlocked = true; }
    const permissions = document.permissionsPolicy ?? document.featurePolicy;
    return {
      cacheNames,
      cachedPaths: requests.map((request) => new URL(request.url).pathname).sort(),
      controlled: Boolean(navigator.serviceWorker.controller),
      dynamicCodeBlocked,
      duplicateIds: [...document.querySelectorAll('[id]')]
        .map((element) => element.id)
        .filter((id, index, ids) => ids.indexOf(id) !== index),
      externalOrigins: [...performance.getEntriesByType('resource')]
        .map((entry) => new URL(entry.name).origin)
        .filter((origin) => origin !== location.origin),
      navItems: document.querySelectorAll('[data-bottom-nav] [data-navigate]').length,
      geolocationAllowed: permissions?.allowsFeature('geolocation') ?? null,
      htmlSinkBlocked,
      passkeyAllowed: permissions?.allowsFeature('publickey-credentials-get') ?? null,
      screenHeadings: document.querySelectorAll('[data-screen] h1').length,
      searchInputsWithNames: [...document.querySelectorAll('[data-search-input]')]
        .filter((input) => input.hasAttribute('name')).length,
      unlabeledButtons: [...document.querySelectorAll('button')]
        .filter((button) => !button.getAttribute('aria-label') && !button.textContent.trim()).length,
      unlabeledInputs: [...document.querySelectorAll('input')]
        .filter((input) => !input.getAttribute('aria-label') && !input.closest('label')).length,
      unapprovedPolicyBlocked,
      visibleScreens: [...document.querySelectorAll('[data-screen]')]
        .filter((screen) => !screen.hidden)
        .map((screen) => screen.dataset.screen)
    };
  })()`);
  debugStep("online-state");

  if (!onlineState.controlled || onlineState.cacheNames.filter((name) => name.startsWith("hc-shell-")).length !== 1 || !onlineState.cacheNames.includes("hc-data-v1") || onlineState.cacheNames.includes("hc-first-aid-v1")) {
    throw new Error(`Unexpected online Service Worker state: ${JSON.stringify(onlineState)}`);
  }
  if (!onlineState.dynamicCodeBlocked || !onlineState.htmlSinkBlocked || !onlineState.unapprovedPolicyBlocked || onlineState.geolocationAllowed !== false || onlineState.passkeyAllowed !== false) {
    throw new Error(`Browser security policy enforcement failed: ${JSON.stringify(onlineState)}`);
  }
  if (onlineState.cachedPaths.length !== serviceWorkerPrecacheAssets.length) {
    throw new Error(`Expected ${serviceWorkerPrecacheAssets.length} cached assets, got ${onlineState.cachedPaths.length}`);
  }
  if (onlineState.navItems !== 4 || JSON.stringify(onlineState.visibleScreens) !== JSON.stringify(["home"])) {
    throw new Error(`Unexpected initial UI shell: ${JSON.stringify(onlineState)}`);
  }
  if (onlineState.duplicateIds.length !== 0 || onlineState.externalOrigins.length !== 0 || onlineState.screenHeadings !== 6 || onlineState.searchInputsWithNames !== 0 || onlineState.unlabeledButtons !== 0 || onlineState.unlabeledInputs !== 0) {
    throw new Error(`Accessibility or privacy shell invariant failed: ${JSON.stringify(onlineState)}`);
  }

  server.responseDelays.set("i18n/en.json", [1_200, 0]);
  const afterRetry = await evaluate(client, `(async () => {
    const observedModes = [document.documentElement.dataset.networkMode];
    const modeObserver = new MutationObserver(() => observedModes.push(document.documentElement.dataset.networkMode));
    modeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-network-mode'] });
    document.querySelector('[data-screen="home"] [data-navigate="settings"]').click();
    const languageInput = document.querySelector('input[name="language"][value="en"]');
    languageInput.click();
    const lowDeadline = Date.now() + 5000;
    while ((document.documentElement.lang !== 'en' || !observedModes.includes('low')) && Date.now() < lowDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    modeObserver.disconnect();
    return {
      language: document.documentElement.lang,
      mode: document.documentElement.dataset.networkMode,
      observedModes,
      source: document.documentElement.dataset.networkModeSource
    };
  })()`);
  if (afterRetry.language !== "en" || !afterRetry.observedModes.includes("low") || afterRetry.source !== "automatic") {
    throw new Error(`Minimal adaptive retry failed: ${JSON.stringify(afterRetry)}`);
  }

  server.responseDelays.set("i18n/ur.json", [1_200, 3_200]);
  const afterTwoTimeouts = await evaluate(client, `(async () => {
    document.querySelector('input[name="language"][value="ur"]').click();
    const textDeadline = Date.now() + 7000;
    while ((document.documentElement.dataset.networkMode !== 'text' || !document.querySelector('input[name="language"][value="en"]').checked) && Date.now() < textDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return {
      language: document.documentElement.lang,
      mode: document.documentElement.dataset.networkMode,
      source: document.documentElement.dataset.networkModeSource
    };
  })()`);
  if (afterTwoTimeouts.language !== "en" || afterTwoTimeouts.mode !== "text" || afterTwoTimeouts.source !== "automatic") {
    throw new Error(`Text fallback after two timeouts failed: ${JSON.stringify(afterTwoTimeouts)}`);
  }

  const manualMode = await evaluate(client, `(async () => {
    document.querySelector('[data-screen="map"] [data-network-mode="normal"]').click();
    document.querySelector('input[name="language"][value="ur"]').click();
    const manualDeadline = Date.now() + 5000;
    while (document.documentElement.lang !== 'ur' && Date.now() < manualDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return {
      language: document.documentElement.lang,
      mode: document.documentElement.dataset.networkMode,
      source: document.documentElement.dataset.networkModeSource
    };
  })()`);
  debugStep("network-adaptation");
  if (manualMode.language !== "ur" || manualMode.mode !== "normal" || manualMode.source !== "manual") {
    throw new Error(`Manual network override failed: ${JSON.stringify(manualMode)}`);
  }

  const interactionState = await evaluate(client, `(async () => {
    const routeChecks = [];
    for (const route of ['home', 'map', 'first-aid', 'search']) {
      document.querySelector('[data-bottom-nav] [data-navigate="' + route + '"]').click();
      routeChecks.push({
        route,
        current: document.querySelector('[data-bottom-nav] [aria-current="page"]')?.dataset.navigate,
        visible: [...document.querySelectorAll('[data-screen]')]
          .filter((screen) => !screen.hidden)
          .map((screen) => screen.dataset.screen)
      });
    }
    document.querySelector('[data-bottom-nav] [data-navigate="home"]').click();
    document.querySelector('[data-screen="home"] [data-navigate="settings"]').click();
    const settingsNavHidden = document.querySelector('[data-bottom-nav]').hidden;
    document.querySelector('input[name="language"][value="ur"]').click();
    const localeDeadline = Date.now() + 5000;
    while (document.documentElement.lang !== 'ur' && Date.now() < localeDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    document.querySelector('input[name="theme"][value="dark"]').click();
    document.querySelector('[data-back]').click();
    const form = document.querySelector('[data-screen="home"] [data-search-form]');
    form.querySelector('[data-search-input]').value = 'sensitive sample';
    form.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const cacheNames = await caches.keys();
    const shellCacheName = cacheNames.find((name) => name.startsWith('hc-shell-'));
    const cache = await caches.open(shellCacheName);
    const requests = await cache.keys();
    return {
      cachePaths: requests.map((request) => new URL(request.url).pathname).sort(),
      cookie: document.cookie,
      direction: document.documentElement.dir,
      language: document.documentElement.lang,
      localStorageLength: localStorage.length,
      recentQueries: [...document.querySelectorAll('[data-recent-query]')].map((item) => item.textContent),
      routeChecks,
      session: Object.fromEntries(Object.entries(sessionStorage)),
      settingsNavHidden,
      theme: document.documentElement.dataset.theme,
      url: location.href,
      visibleScreens: [...document.querySelectorAll('[data-screen]')]
        .filter((screen) => !screen.hidden)
        .map((screen) => screen.dataset.screen)
    };
  })()`);
  debugStep("interactions");

  if (interactionState.language !== "ur" || interactionState.direction !== "rtl" || interactionState.theme !== "dark") {
    throw new Error(`Language, direction, or theme interaction failed: ${JSON.stringify(interactionState)}`);
  }
  if (!interactionState.settingsNavHidden || interactionState.routeChecks.some((check) => check.current !== check.route || JSON.stringify(check.visible) !== JSON.stringify([check.route]))) {
    throw new Error(`Primary route shell failed: ${JSON.stringify(interactionState.routeChecks)}`);
  }
  if (JSON.stringify(interactionState.visibleScreens) !== JSON.stringify(["search"]) || interactionState.recentQueries.length !== 2) {
    throw new Error(`Navigation or RAM history interaction failed: ${JSON.stringify(interactionState)}`);
  }
  const serializedSession = JSON.stringify(interactionState.session);
  if (interactionState.localStorageLength !== 0 || interactionState.cookie !== "" || interactionState.url.includes("sensitive sample") || serializedSession.includes("sensitive sample") || JSON.stringify(Object.keys(interactionState.session).sort()) !== JSON.stringify(["hc:locale", "hc:theme"])) {
    throw new Error(`Sensitive query reached persistent browser storage: ${JSON.stringify(interactionState)}`);
  }
  if (!interactionState.cachePaths.includes("/directory.json") || !interactionState.cachePaths.includes("/i18n/ur.json") || interactionState.cachePaths.some((item) => item.includes("sensitive"))) {
    throw new Error(`Runtime locale cache policy failed: ${JSON.stringify(interactionState.cachePaths)}`);
  }

  const mapInstallState = await evaluate(client, `(async () => {
    const allCachePaths = async () => (await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)))).flat();
    document.querySelector('[data-bottom-nav] [data-navigate="map"]').click();
    const controlsDeadline = Date.now() + 5000;
    while (document.querySelectorAll('[data-region-select] option').length !== 2 && Date.now() < controlsDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const pathsBefore = await allCachePaths();
    document.querySelector('[data-install-region]').click();
    const consentVisible = !document.querySelector('[data-consent-modal]').hidden;
    const mainInert = document.querySelector('.screens').inert;
    const warning = document.querySelector('[data-consent-description]').textContent;
    document.querySelector('[data-consent-confirm]').click();
    const regionDeadline = Date.now() + 10000;
    let pathsAfter = [];
    while (Date.now() < regionDeadline) {
      pathsAfter = await allCachePaths();
      if (pathsAfter.includes('/regions/demo-north.min.json') && document.querySelectorAll('[data-map-point]').length === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return {
      boundaryCount: document.querySelectorAll('.map-boundary').length,
      cacheNames: await caches.keys(),
      consentVisible,
      mainInert,
      markerCount: document.querySelectorAll('[data-map-point]').length,
      optionCount: document.querySelectorAll('[data-region-select] option').length,
      pathsAfter,
      pathsBefore,
      roadCount: document.querySelectorAll('.map-road').length,
      status: document.querySelector('[data-region-status]').textContent,
      svgHidden: document.querySelector('[data-map-svg]').hasAttribute('hidden'),
      warning
    };
  })()`);
  debugStep("map-install");

  if (mapInstallState.pathsBefore.some((item) => item.startsWith("/regions/")) || !mapInstallState.pathsAfter.includes("/regions/demo-north.min.json") || mapInstallState.pathsAfter.includes("/regions/demo-south.min.json")) {
    throw new Error(`Regional chunk consent policy failed: ${JSON.stringify(mapInstallState)}`);
  }
  if (!mapInstallState.consentVisible || !mapInstallState.mainInert || mapInstallState.warning.length < 20 || mapInstallState.optionCount !== 2 || mapInstallState.boundaryCount !== 1 || mapInstallState.roadCount !== 3 || mapInstallState.markerCount !== 3 || mapInstallState.svgHidden || mapInstallState.status.length < 10 || !mapInstallState.cacheNames.includes('hc-data-v1') || mapInstallState.cacheNames.includes('hc-first-aid-v1') || mapInstallState.cacheNames.filter((name) => name.startsWith('hc-shell-')).length !== 1) {
    throw new Error(`Schematic map rendering failed: ${JSON.stringify(mapInstallState)}`);
  }

  const updateState = await evaluate(client, `(async () => {
    document.querySelector('[data-update-region]').click();
    const deadline = Date.now() + 10000;
    let cachedVersion = 0;
    while (Date.now() < deadline) {
      const response = await caches.match(new URL('./regions/demo-north.min.json', document.baseURI).href);
      if (response) cachedVersion = (await response.clone().json()).datasetVersion;
      if (cachedVersion === 3 && !document.querySelector('[data-update-region]').disabled) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const cachedResponse = await caches.match(new URL('./regions/demo-north.min.json', document.baseURI).href);
    const resourcePaths = performance.getEntriesByType('resource').map((entry) => new URL(entry.name).pathname);
    return {
      buttonDisabled: document.querySelector('[data-update-region]').disabled,
      cachedVersion,
      deltaRequests: resourcePaths.filter((path) => path.endsWith('.delta.json')),
      markerTransform: document.querySelector('[data-map-point="demo-water-a"]').getAttribute('transform'),
      signaturePresent: Boolean(cachedResponse?.headers.get('X-HC-Signature')),
      signedPath: cachedResponse?.headers.get('X-HC-Signed-Path'),
      snapshotRequests: resourcePaths.filter((path) => /demo-north\.v\d+\.min\.json$/.test(path)),
      status: document.querySelector('[data-region-status]').textContent,
      updateManifestRequests: resourcePaths.filter((path) => path === '/updates/index.json').length
    };
  })()`);
  debugStep("updates");

  if (updateState.cachedVersion !== 3 || updateState.buttonDisabled || JSON.stringify(updateState.deltaRequests) !== JSON.stringify(["/updates/demo-north.1-2.delta.json", "/updates/demo-north.2-3.delta.json"]) || updateState.snapshotRequests.length !== 0 || updateState.updateManifestRequests !== 1 || updateState.markerTransform !== "translate(34 44)" || !updateState.status.includes("3") || !updateState.signaturePresent || updateState.signedPath !== "regions/demo-north.v3.min.json") {
    throw new Error(`Micro-delta update failed: ${JSON.stringify(updateState)}`);
  }

  const mapScreenshot = await client.send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(projectRoot, "reports", "ui-map.png"), Buffer.from(mapScreenshot.data, "base64"));

  const phase4State = await evaluate(client, `(async () => {
    document.querySelector('[data-bottom-nav] [data-navigate="search"]').click();
    const searchForm = document.querySelector('[data-screen="search"] [data-search-form]');
    searchForm.querySelector('[data-search-input]').value = 'پانی';
    searchForm.requestSubmit();
    const searchDeadline = Date.now() + 5000;
    while (document.querySelectorAll('[data-screen="search"] [data-directory-point]').length !== 1 && Date.now() < searchDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const searchCount = document.querySelectorAll('[data-screen="search"] [data-directory-point]').length;
    document.querySelector('[data-bottom-nav] [data-navigate="map"]').click();
    const directoryDeadline = Date.now() + 5000;
    while (document.querySelectorAll('[data-screen="map"] [data-directory-point]').length !== 6 && Date.now() < directoryDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    document.querySelector('[data-screen="map"] [data-network-mode="low"]').click();
    const lowDetailsHidden = [...document.querySelectorAll('[data-map-detail="normal"]')].every((item) => item.hasAttribute('hidden'));
    const lowMapVisible = !document.querySelector('[data-map-visual]').hidden && !document.querySelector('[data-map-svg]').hasAttribute('hidden');
    const mainRoadVisible = !document.querySelector('.map-road--main').hasAttribute('hidden');
    document.querySelector('[data-screen="map"] [data-network-mode="text"]').click();
    document.querySelector('[data-screen="map"] [data-directory-category="water"]').click();
    const filterDeadline = Date.now() + 3000;
    while (document.querySelectorAll('[data-screen="map"] [data-directory-point]').length !== 1 && Date.now() < filterDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const cachePaths = (await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)))).flat();
    return {
      cacheContainsQuery: cachePaths.some((item) => item.includes('پانی')),
      demoWarning: document.querySelector('[data-screen="map"] .directory-warning').textContent,
      directoryRequests: performance.getEntriesByType('resource').filter((entry) => new URL(entry.name).pathname === '/directory.json').length,
      lowVisualHidden: document.querySelector('[data-low-data-visual]').hidden,
      lowDetailsHidden,
      lowMapVisible,
      mainRoadVisible,
      mapVisualsHidden: [...document.querySelectorAll('[data-map-visual]')].every((item) => item.hidden),
      mode: document.documentElement.dataset.networkMode,
      modePressed: document.querySelector('[data-screen="map"] [data-network-mode="text"]').getAttribute('aria-pressed'),
      searchCount,
      sessionContainsQuery: JSON.stringify(Object.fromEntries(Object.entries(sessionStorage))).includes('پانی'),
      textCount: document.querySelectorAll('[data-screen="map"] [data-directory-point]').length
    };
  })()`);
  debugStep("text-mode");

  if (phase4State.searchCount !== 1 || phase4State.textCount !== 1 || phase4State.mode !== "text" || phase4State.modePressed !== "true" || !phase4State.mapVisualsHidden || !phase4State.lowVisualHidden || !phase4State.lowDetailsHidden || !phase4State.lowMapVisible || !phase4State.mainRoadVisible || phase4State.demoWarning.length < 30) {
    throw new Error(`Local search or text-only mode failed: ${JSON.stringify(phase4State)}`);
  }
  if (phase4State.sessionContainsQuery || phase4State.cacheContainsQuery || phase4State.directoryRequests > 1) {
    throw new Error(`Phase 4 query persistence or request policy failed: ${JSON.stringify(phase4State)}`);
  }

  const textModeScreenshot = await client.send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(projectRoot, "reports", "ui-text-mode.png"), Buffer.from(textModeScreenshot.data, "base64"));

  const medicalState = await evaluate(client, `(async () => {
    const allCachePaths = async () => (await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)))).flat();
    document.querySelector('[data-bottom-nav] [data-navigate="first-aid"]').click();
    const pathsBefore = await allCachePaths();
    document.querySelector('[data-install-first-aid]').click();
    const consentVisible = !document.querySelector('[data-consent-modal]').hidden;
    const mainInert = document.querySelector('.screens').inert;
    const warning = document.querySelector('[data-consent-description]').textContent;
    document.querySelector('[data-consent-confirm]').click();
    const deadline = Date.now() + 10000;
    let pathsAfter = [];
    while (Date.now() < deadline) {
      pathsAfter = await allCachePaths();
      if (pathsAfter.includes('/first-aid/ur.json')) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    document.querySelector('[data-guide-id="severe-bleeding"]').click();
    const guideDeadline = Date.now() + 3000;
    while (document.querySelector('[data-screen="first-aid-detail"]').hidden && Date.now() < guideDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const cacheEntries = Object.fromEntries(await Promise.all((await caches.keys()).map(async (name) => [name, (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname).sort()])));
    return {
      cacheEntries,
      consentVisible,
      guideStatus: document.querySelector('.guide-review-warning').textContent,
      guideSteps: document.querySelectorAll('[data-guide-steps] li').length,
      mainInert,
      pathsAfter,
      pathsBefore,
      visibleScreens: [...document.querySelectorAll('[data-screen]')]
        .filter((screen) => !screen.hidden)
        .map((screen) => screen.dataset.screen),
      warning
    };
  })()`);
  debugStep("first-aid");

  if (medicalState.pathsBefore.some((item) => item.startsWith("/first-aid/")) || !medicalState.pathsAfter.includes("/first-aid/ur.json")) {
    throw new Error(`First-aid content was cached before consent or not cached after consent: ${JSON.stringify(medicalState)}`);
  }
  if (!medicalState.consentVisible || !medicalState.mainInert || medicalState.warning.length < 20 || medicalState.guideSteps < 3 || (!medicalState.guideStatus.includes("REVIEW_REQUIRED") && medicalState.guideStatus.length < 10) || JSON.stringify(medicalState.visibleScreens) !== JSON.stringify(["first-aid-detail"])) {
    throw new Error(`First-aid consent or guide rendering failed: ${JSON.stringify(medicalState)}`);
  }
  const shellCompartment = Object.entries(medicalState.cacheEntries).find(([name]) => name.startsWith("hc-shell-"));
  if (!shellCompartment || shellCompartment[1].some((item) => item.startsWith("/regions/") || item.startsWith("/first-aid/") || item === "/integrity-state.json") || !medicalState.cacheEntries["hc-data-v1"]?.includes("/regions/demo-north.min.json") || medicalState.cacheEntries["hc-data-v1"].some((item) => item.startsWith("/first-aid/")) || JSON.stringify(medicalState.cacheEntries["hc-first-aid-v1"]) !== JSON.stringify(["/first-aid/ur.json"])) {
    throw new Error(`Cache compartment policy failed: ${JSON.stringify(medicalState.cacheEntries)}`);
  }

  const firstAidScreenshot = await client.send("Page.captureScreenshot", { format: "png" });
  await writeFile(path.join(projectRoot, "reports", "ui-first-aid.png"), Buffer.from(firstAidScreenshot.data, "base64"));

  const cacheLifecycleState = await evaluate(client, `(async () => {
    document.querySelector('[data-back]').click();
    document.querySelector('[data-remove-first-aid]').click();
    const firstAidRemovalDeadline = Date.now() + 5000;
    while ((await caches.has('hc-first-aid-v1') || document.querySelector('[data-install-first-aid]').hidden) && Date.now() < firstAidRemovalDeadline) await new Promise((resolve) => setTimeout(resolve, 25));
    const firstAidRemoved = !await caches.has('hc-first-aid-v1') && !document.querySelector('[data-install-first-aid]').hidden;
    document.querySelector('[data-install-first-aid]').click();
    document.querySelector('[data-consent-confirm]').click();
    const firstAidInstallDeadline = Date.now() + 10000;
    while (!await caches.match(new URL('./first-aid/ur.json', document.baseURI).href) && Date.now() < firstAidInstallDeadline) await new Promise((resolve) => setTimeout(resolve, 25));

    document.querySelector('[data-bottom-nav] [data-navigate="map"]').click();
    document.querySelector('[data-remove-region]').click();
    const regionUrl = new URL('./regions/demo-north.min.json', document.baseURI).href;
    const regionRemovalDeadline = Date.now() + 5000;
    while (await caches.match(regionUrl) && Date.now() < regionRemovalDeadline) await new Promise((resolve) => setTimeout(resolve, 25));
    const regionRemoved = !await caches.match(regionUrl) && !document.querySelector('[data-install-region]').hidden && document.querySelector('[data-map-svg]').hasAttribute('hidden');
    document.querySelector('[data-install-region]').click();
    document.querySelector('[data-consent-confirm]').click();
    const regionInstallDeadline = Date.now() + 10000;
    let regionVersion = 0;
    while (Date.now() < regionInstallDeadline) {
      const response = await caches.match(regionUrl);
      if (response) regionVersion = (await response.clone().json()).datasetVersion;
      if (regionVersion === 3) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const entries = Object.fromEntries(await Promise.all((await caches.keys()).map(async (name) => [name, (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname).sort()])));
    return { entries, firstAidRemoved, regionRemoved, regionVersion };
  })()`);
  debugStep("cache-lifecycle");
  if (!cacheLifecycleState.firstAidRemoved || !cacheLifecycleState.regionRemoved || cacheLifecycleState.regionVersion !== 3 || JSON.stringify(cacheLifecycleState.entries["hc-first-aid-v1"]) !== JSON.stringify(["/first-aid/ur.json"]) || !cacheLifecycleState.entries["hc-data-v1"]?.includes("/regions/demo-north.min.json")) {
    throw new Error(`Cache removal or non-rollback reinstall failed: ${JSON.stringify(cacheLifecycleState)}`);
  }

  const publicNetworkAudit = server.privacyAudit;
  const serializedNetworkAudit = JSON.stringify(publicNetworkAudit);
  if (publicNetworkAudit.length === 0 || publicNetworkAudit.some((entry) => entry.method !== "GET" || entry.query !== "" || entry.referer !== "" || entry.cookie !== "" || !allowedAssets.has(entry.pathname === "/" ? "index.html" : entry.pathname.slice(1)))) {
    throw new Error(`Public network privacy invariant failed: ${serializedNetworkAudit}`);
  }
  if (serializedNetworkAudit.includes("sensitive sample") || serializedNetworkAudit.includes("پانی") || serializedNetworkAudit.includes(encodeURIComponent("پانی"))) {
    throw new Error(`A local search reached the public server: ${serializedNetworkAudit}`);
  }
  debugStep("network-privacy");

  await stopServer(server);
  server = undefined;
  await client.send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
    connectionType: "none"
  });
  loaded = client.waitForEvent("Page.loadEventFired");
  await client.send("Page.reload");
  await loaded;

  const offlineState = await evaluate(client, `(async () => {
    const deadline = Date.now() + 5000;
    while (document.documentElement.lang !== 'ur' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const initialHomeVisible = !document.querySelector('[data-screen="home"]').hidden;
    const initialRecentCount = document.querySelectorAll('[data-recent-query]').length;
    document.querySelector('[data-bottom-nav] [data-navigate="map"]').click();
    const directoryDeadline = Date.now() + 5000;
    while ((document.querySelectorAll('[data-screen="map"] [data-directory-point]').length !== 6 || document.querySelectorAll('[data-map-point]').length !== 3) && Date.now() < directoryDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const offlineMapPoints = document.querySelectorAll('[data-map-point]').length;
    const cachedRegionBefore = await (await caches.match(new URL('./regions/demo-north.min.json', document.baseURI).href)).clone().json();
    document.querySelector('[data-update-region]').click();
    const updateDeadline = Date.now() + 3000;
    while (document.querySelector('[data-update-region]').disabled && Date.now() < updateDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const cachedRegionAfter = await (await caches.match(new URL('./regions/demo-north.min.json', document.baseURI).href)).clone().json();
    const offlineUpdatePreserved = cachedRegionBefore.datasetVersion === 3 && cachedRegionAfter.datasetVersion === 3;
    document.querySelector('[data-screen="map"] [data-network-mode="text"]').click();
    const searchForm = document.querySelector('[data-screen="map"] [data-search-form]');
    searchForm.querySelector('[data-search-input]').value = 'پانی';
    searchForm.requestSubmit();
    const searchDeadline = Date.now() + 3000;
    while (document.querySelectorAll('[data-screen="search"] [data-directory-point]').length !== 1 && Date.now() < searchDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const offlineSearchCount = document.querySelectorAll('[data-screen="search"] [data-directory-point]').length;
    const offlineTextMode = document.documentElement.dataset.networkMode;
    document.querySelector('[data-bottom-nav] [data-navigate="first-aid"]').click();
    const bundleDeadline = Date.now() + 3000;
    while (!document.querySelector('[data-first-aid-status]').textContent.includes('4') && Date.now() < bundleDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    document.querySelector('[data-guide-id="burns"]').click();
    const guideDeadline = Date.now() + 3000;
    while (document.querySelector('[data-screen="first-aid-detail"]').hidden && Date.now() < guideDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return {
      controlled: Boolean(navigator.serviceWorker?.controller),
      direction: document.documentElement.dir,
      guideSteps: document.querySelectorAll('[data-guide-steps] li').length,
      initialHomeVisible,
      initialRecentCount,
      language: document.documentElement.lang,
      offlineMapPoints,
      offlineUpdatePreserved,
      offlineSearchCount,
      offlineTextMode,
      text: document.body.textContent,
      theme: document.documentElement.dataset.theme,
      title: document.title,
      visibleScreens: [...document.querySelectorAll('[data-screen]')]
        .filter((screen) => !screen.hidden)
        .map((screen) => screen.dataset.screen)
    };
  })()`);
  debugStep("offline");
  if (!offlineState.controlled || offlineState.title !== "HELP CONNECT" || offlineState.language !== "ur" || offlineState.direction !== "rtl" || offlineState.theme !== "dark" || !offlineState.initialHomeVisible || offlineState.initialRecentCount !== 0 || offlineState.offlineMapPoints !== 3 || !offlineState.offlineUpdatePreserved || offlineState.offlineSearchCount !== 1 || offlineState.offlineTextMode !== "text" || offlineState.guideSteps < 3 || JSON.stringify(offlineState.visibleScreens) !== JSON.stringify(["first-aid-detail"])) {
    throw new Error(`Offline reload did not render the app shell: ${JSON.stringify(offlineState)}`);
  }

  const tamperPrepared = await evaluate(client, `(async () => {
    const url = new URL('./regions/demo-north.min.json', document.baseURI).href;
    const cache = await caches.open('hc-data-v1');
    const response = await cache.match(url);
    if (!response) return false;
    const value = await response.clone().json();
    value.boundary[0][0] += 1;
    await cache.put(url, new Response(JSON.stringify(value), { headers: response.headers }));
    return true;
  })()`);
  if (!tamperPrepared) throw new Error("Could not prepare the offline integrity tamper check");
  loaded = client.waitForEvent("Page.loadEventFired");
  await client.send("Page.reload");
  await loaded;
  const tamperState = await evaluate(client, `(async () => {
    document.querySelector('[data-bottom-nav] [data-navigate="map"]').click();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return {
      cached: Boolean(await caches.match(new URL('./regions/demo-north.min.json', document.baseURI).href)),
      markerCount: document.querySelectorAll('[data-map-point]').length,
      svgHidden: document.querySelector('[data-map-svg]').hasAttribute('hidden'),
      status: document.querySelector('[data-region-status]').textContent
    };
  })()`);
  debugStep("tamper");
  if (tamperState.markerCount !== 0 || !tamperState.svgHidden || tamperState.cached) {
    throw new Error(`Tampered signed cache entry was rendered: ${JSON.stringify(tamperState)}`);
  }

  await evaluate(client, `(async () => {
    localStorage.setItem('hc-smoke-sensitive', 'remove-me');
    sessionStorage.setItem('hc-smoke-sensitive', 'remove-me');
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('hc-smoke-sensitive', 1);
      request.addEventListener('upgradeneeded', () => request.result.createObjectStore('records'), { once: true });
      request.addEventListener('success', () => {
        request.result.close();
        resolve();
      }, { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
    return true;
  })()`);

  await client.send("DOMStorage.enable");
  await client.send("IndexedDB.enable");
  const initialRegistrationUpdate = client.waitForEvent("ServiceWorker.workerRegistrationUpdated", 10000);
  await client.send("ServiceWorker.enable");
  const initialRegistrations = (await initialRegistrationUpdate).registrations;
  if (!initialRegistrations.some((registration) => registration.scopeURL.startsWith(appUrl) && !registration.isDeleted)) {
    throw new Error(`Panic Wipe precondition has no active registration: ${JSON.stringify(initialRegistrations)}`);
  }
  const panicNavigation = client.waitForEvent("Page.frameNavigated", 10000);
  const panicRegistrationUpdate = client.waitForEvent("ServiceWorker.workerRegistrationUpdated", 10000);
  try {
    await client.send("Runtime.evaluate", {
      expression: `document.querySelector('[data-panic-wipe]').click()`,
      returnByValue: true
    });
  } catch {
    // The expected about:blank replacement may destroy the execution context first.
  }
  const panicFrame = await panicNavigation;
  debugStep("panic-navigation");
  const removedRegistrations = (await panicRegistrationUpdate).registrations;
  const securityOrigin = new URL(appUrl).origin;
  const [panicCaches, panicDatabases, panicLocalStorage, panicSessionStorage] = await Promise.all([
    client.send("CacheStorage.requestCacheNames", { securityOrigin }),
    client.send("IndexedDB.requestDatabaseNames", { securityOrigin }),
    client.send("DOMStorage.getDOMStorageItems", { storageId: { securityOrigin, isLocalStorage: true } }),
    client.send("DOMStorage.getDOMStorageItems", { storageId: { securityOrigin, isLocalStorage: false } })
  ]);
  const panicState = {
    cacheNames: panicCaches.caches.map((cache) => cache.cacheName),
    databaseNames: panicDatabases.databaseNames,
    localStorage: panicLocalStorage.entries,
    registrationRemoved: removedRegistrations.some((registration) => registration.scopeURL.startsWith(appUrl) && registration.isDeleted),
    sessionStorage: panicSessionStorage.entries,
    url: panicFrame.frame.url
  };
  if (panicState.url !== "about:blank" || panicState.cacheNames.length !== 0 || panicState.databaseNames.length !== 0 || panicState.localStorage.length !== 0 || panicState.sessionStorage.length !== 0 || !panicState.registrationRemoved) {
    throw new Error(`Panic Wipe did not clear controllable browser state: ${JSON.stringify(panicState)}`);
  }

  console.log(`Offline UI smoke test passed in ${path.basename(browserPath)} with adaptive timeouts/manual override, compartment removal/reinstall, invalid-cache eviction, zero-query network audit, signed micro-deltas, local Urdu search, first-aid content, and Panic Wipe`);
} finally {
  if (client && browser?.exitCode === null) {
    try {
      await client.send("Browser.close");
    } catch {
      // Fall back to terminating the owned headless browser process below.
    }
  }
  client?.close();
  if (server) {
    await stopServer(server);
  }
  if (browser && browser.exitCode === null) {
    const exited = once(browser, "exit");
    browser.kill();
    await Promise.race([exited, delay(5000)]);
  }
  await rm(profileDirectory, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
}
