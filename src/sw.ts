import { publicCachePolicy } from "../shared/cache-policy.js";
import { createPublicAssetRequest } from "../shared/network-privacy.js";

declare const __PRECACHE_ASSETS__: readonly string[];
declare const __CACHE_NAME__: string;
declare const __INSTALLABLE_ASSETS__: readonly string[];
declare const __REGION_ASSETS__: readonly string[];
declare const __RUNTIME_ASSETS__: readonly string[];

const worker = globalThis as unknown as ServiceWorkerGlobalScope;
const cacheName = __CACHE_NAME__;
const cachePrefix = publicCachePolicy.shellPrefix;
const dataCacheName = publicCachePolicy.data;
const firstAidCacheName = publicCachePolicy.firstAid;
const appShellUrls = __PRECACHE_ASSETS__.map((asset) => new URL(asset, worker.registration.scope).href);
const appShellUrlSet = new Set(appShellUrls);
const runtimeUrlSet = new Set(__RUNTIME_ASSETS__.map((asset) => new URL(asset, worker.registration.scope).href));
const installableUrlSet = new Set(__INSTALLABLE_ASSETS__.map((asset) => new URL(asset, worker.registration.scope).href));
const regionUrlSet = new Set(__REGION_ASSETS__.map((asset) => new URL(asset, worker.registration.scope).href));
const offlineDocumentUrl = new URL("./index.html", worker.registration.scope).href;
const integrityStateUrl = new URL(`./${publicCachePolicy.integrityStateFile}`, worker.registration.scope).href;
let panicWipeActive = false;

function fetchPublicAsset(url: string, signal?: AbortSignal): Promise<Response> {
  return fetch(createPublicAssetRequest(url, worker.registration.scope, signal ? { signal } : {}));
}

async function purgeAllCaches(): Promise<void> {
  const cacheNames = await caches.keys();
  await Promise.allSettled(cacheNames.map((candidate) => caches.delete(candidate)));
}

worker.addEventListener("install", (event: ExtendableEvent) => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(appShellUrls.map((url) => createPublicAssetRequest(url, worker.registration.scope)));
    await worker.skipWaiting();
  })());
});

worker.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil((async () => {
    if (panicWipeActive) return;
    const cacheNames = await caches.keys();
    for (const candidate of cacheNames.filter((name) => name.startsWith(cachePrefix) && name !== cacheName)) {
      if (panicWipeActive) return;
      const oldCache = await caches.open(candidate);
      const persistentRequests = (await oldCache.keys()).filter((request) => installableUrlSet.has(request.url) || regionUrlSet.has(request.url));
      if (persistentRequests.length > 0) {
        const dataCache = await caches.open(dataCacheName);
        for (const request of persistentRequests) {
          if (panicWipeActive) return;
          const response = await oldCache.match(request);
          if (response?.headers.has("X-HC-Signature") && response.headers.has("X-HC-Signed-Path")) {
            const targetCache = installableUrlSet.has(request.url) ? await caches.open(firstAidCacheName) : dataCache;
            await targetCache.put(request, response);
          }
        }
      }
      await caches.delete(candidate);
    }
    if (panicWipeActive) return;
    const dataCache = await caches.open(dataCacheName);
    for (const request of await dataCache.keys()) {
      if (installableUrlSet.has(request.url)) {
        const response = await dataCache.match(request);
        if (response?.headers.has("X-HC-Signature") && response.headers.has("X-HC-Signed-Path")) {
          await (await caches.open(firstAidCacheName)).put(request, response);
        }
        await dataCache.delete(request);
        continue;
      }
      if (request.url === integrityStateUrl) continue;
      if (!regionUrlSet.has(request.url)) {
        await dataCache.delete(request);
        continue;
      }
      const response = await dataCache.match(request);
      if (!response?.headers.has("X-HC-Signature") || !response.headers.has("X-HC-Signed-Path")) await dataCache.delete(request);
    }
    if (await caches.has(firstAidCacheName)) {
      const firstAidCache = await caches.open(firstAidCacheName);
      for (const request of await firstAidCache.keys()) {
        const response = await firstAidCache.match(request);
        if (!installableUrlSet.has(request.url) || !response?.headers.has("X-HC-Signature") || !response.headers.has("X-HC-Signed-Path")) await firstAidCache.delete(request);
      }
    }
    for (const candidate of (await caches.keys()).filter((name) => name.startsWith(publicCachePolicy.firstAidPrefix) && name !== firstAidCacheName)) await caches.delete(candidate);
    if (panicWipeActive) return;
    await worker.clients.claim();
  })());
});

worker.addEventListener("fetch", (event: FetchEvent) => {
  const request = event.request;
  const requestUrl = new URL(request.url);

  if (request.method !== "GET" || requestUrl.origin !== worker.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      const cachedDocument = await cache.match(offlineDocumentUrl);
      return cachedDocument ?? fetchPublicAsset(offlineDocumentUrl, request.signal);
    })());
    return;
  }

  if (appShellUrlSet.has(requestUrl.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      const cachedResponse = await cache.match(request);
      return cachedResponse ?? fetchPublicAsset(requestUrl.href, request.signal);
    })());
    return;
  }

  if (runtimeUrlSet.has(requestUrl.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(cacheName);
      const cachedResponse = await cache.match(request);
      if (cachedResponse) {
        return cachedResponse;
      }

      const networkResponse = await fetchPublicAsset(requestUrl.href, request.signal);
      if (networkResponse.ok && !panicWipeActive) {
        await cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })());
  }
});

worker.addEventListener("message", (event: ExtendableMessageEvent) => {
  const data = event.data as unknown;
  const replyPort = event.ports[0];
  if (data && typeof data === "object" && "type" in data && data.type === "HC_PANIC_WIPE") {
    panicWipeActive = true;
    event.waitUntil((async () => {
      await purgeAllCaches();
      replyPort?.postMessage({ ok: true });
    })());
    return;
  }
  if (data && typeof data === "object" && "type" in data && "url" in data && (data.type === "REMOVE_FIRST_AID" || data.type === "REMOVE_REGION")) {
    const url = data.url;
    if (typeof url !== "string") {
      replyPort?.postMessage({ ok: false });
      return;
    }
    const assetUrl = new URL(url, worker.registration.scope).href;
    const isFirstAid = data.type === "REMOVE_FIRST_AID";
    const allowed = isFirstAid ? installableUrlSet.has(assetUrl) : regionUrlSet.has(assetUrl);
    event.waitUntil((async () => {
      const targetCacheName = isFirstAid ? firstAidCacheName : dataCacheName;
      if (!allowed || !await caches.has(targetCacheName)) {
        replyPort?.postMessage({ ok: false });
        return;
      }
      const targetCache = await caches.open(targetCacheName);
      const removed = await targetCache.delete(assetUrl);
      if (removed && isFirstAid && (await targetCache.keys()).length === 0) await caches.delete(firstAidCacheName);
      replyPort?.postMessage({ ok: Boolean(removed) });
    })());
    return;
  }
  if (!data || typeof data !== "object" || !("type" in data) || !("url" in data) || !("content" in data) || !("signature" in data) || !("signedPath" in data)) {
    return;
  }
  const request = data as { content: unknown; signature: unknown; signedPath: unknown; type: unknown; url: unknown };
  if (panicWipeActive || (request.type !== "STORE_FIRST_AID" && request.type !== "STORE_REGION") || typeof request.url !== "string" || typeof request.content !== "string" || typeof request.signature !== "string" || typeof request.signedPath !== "string") {
    replyPort?.postMessage({ ok: false });
    return;
  }

  const assetContent = request.content;
  const signatureContent = request.signature;
  const signedPath = request.signedPath;
  const assetUrl = new URL(request.url, worker.registration.scope).href;
  const isFirstAid = request.type === "STORE_FIRST_AID";
  const allowed = isFirstAid ? installableUrlSet.has(assetUrl) : regionUrlSet.has(assetUrl);
  const maximumLength = isFirstAid ? 60_000 : 30_000;
  const assetName = new URL(assetUrl).pathname.split("/").at(-1) ?? "";
  const baseRegionId = assetName.endsWith(".min.json") ? assetName.slice(0, -".min.json".length) : "";
  const signedPathAllowed = isFirstAid
    ? signedPath === `first-aid/${assetName}`
    : signedPath === `regions/${baseRegionId}.min.json` || new RegExp(`^regions/${baseRegionId}\\.v[1-9][0-9]*\\.min\\.json$`).test(signedPath);
  if (!allowed || !signedPathAllowed || assetContent.length === 0 || assetContent.length > maximumLength || signatureContent.length === 0 || signatureContent.length > 4_000) {
    replyPort?.postMessage({ ok: false });
    return;
  }

  event.waitUntil((async () => {
    try {
      JSON.parse(assetContent);
      const signature = JSON.parse(signatureContent) as unknown;
      if (!signature || typeof signature !== "object" || !("artifact_path" in signature) || signature.artifact_path !== signedPath) throw new Error("Signature path mismatch");
      const signatureBytes = new TextEncoder().encode(signatureContent);
      let signatureBinary = "";
      for (const byte of signatureBytes) signatureBinary += String.fromCharCode(byte);
      const encodedSignature = btoa(signatureBinary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      if (panicWipeActive) throw new Error("Panic wipe active");
      const cache = await caches.open(isFirstAid ? firstAidCacheName : dataCacheName);
      if (panicWipeActive) throw new Error("Panic wipe active");
      await cache.put(assetUrl, new Response(assetContent, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "X-HC-Signature": encodedSignature,
          "X-HC-Signed-Path": signedPath
        }
      }));
      replyPort?.postMessage({ ok: true });
    } catch {
      replyPort?.postMessage({ ok: false });
    }
  })());
});

export {};
