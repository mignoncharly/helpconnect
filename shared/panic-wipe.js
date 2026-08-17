const channelName = "hc-panic-wipe-v1";
const messageType = "HC_PANIC_WIPE";
const defaultDatabaseTimeoutMilliseconds = 1_500;

function safeProperty(value, key) {
  try {
    return value?.[key];
  } catch {
    return undefined;
  }
}

function safeCall(callback) {
  try {
    callback?.();
  } catch {
    // A denied browser capability must not stop the remaining best-effort purge.
  }
}

function clearStorage(storage) {
  safeCall(() => storage?.clear());
}

async function deleteCaches(cacheStorage) {
  if (!cacheStorage?.keys || !cacheStorage.delete) return 0;
  try {
    const names = await cacheStorage.keys();
    const results = await Promise.allSettled(names.map((name) => cacheStorage.delete(name)));
    return results.filter((result) => result.status === "fulfilled" && result.value === true).length;
  } catch {
    return 0;
  }
}

function deleteDatabase(databaseFactory, name, timeoutMilliseconds, setTimer, clearTimer) {
  return new Promise((resolve) => {
    let request;
    try {
      request = databaseFactory.deleteDatabase(name);
    } catch {
      resolve(false);
      return;
    }

    let settled = false;
    const finish = (deleted) => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      resolve(deleted);
    };
    const timer = setTimer(() => finish(false), timeoutMilliseconds);
    request.addEventListener("success", () => finish(true), { once: true });
    request.addEventListener("error", () => finish(false), { once: true });
    request.addEventListener("blocked", () => finish(false), { once: true });
  });
}

async function deleteDatabases(databaseFactory, knownDatabaseNames, timeoutMilliseconds, setTimer, clearTimer) {
  if (!databaseFactory?.deleteDatabase) return 0;
  const names = new Set(knownDatabaseNames);
  try {
    if (typeof databaseFactory.databases === "function") {
      for (const database of await databaseFactory.databases()) {
        if (typeof database.name === "string" && database.name) names.add(database.name);
      }
    }
  } catch {
    // Older engines cannot enumerate databases; explicit application names remain covered.
  }
  const results = await Promise.all([...names].map((name) => deleteDatabase(
    databaseFactory,
    name,
    timeoutMilliseconds,
    setTimer,
    clearTimer
  )));
  return results.filter(Boolean).length;
}

async function stopServiceWorkers(serviceWorkerContainer) {
  if (!serviceWorkerContainer?.getRegistrations) return 0;
  try {
    const registrations = await serviceWorkerContainer.getRegistrations();
    for (const registration of registrations) {
      for (const worker of [registration.installing, registration.waiting, registration.active]) {
        safeCall(() => worker?.postMessage({ type: messageType }));
      }
    }
    const results = await Promise.allSettled(registrations.map((registration) => registration.unregister()));
    return results.filter((result) => result.status === "fulfilled" && result.value === true).length;
  } catch {
    return 0;
  }
}

function notifyOtherTabs(root) {
  const BroadcastChannelConstructor = safeProperty(root, "BroadcastChannel");
  if (typeof BroadcastChannelConstructor !== "function") return;
  safeCall(() => {
    const channel = new BroadcastChannelConstructor(channelName);
    channel.postMessage({ type: messageType });
    channel.close();
  });
}

export function listenForPanicWipe(callback, root = globalThis) {
  const BroadcastChannelConstructor = safeProperty(root, "BroadcastChannel");
  if (typeof BroadcastChannelConstructor !== "function") return () => {};
  try {
    const channel = new BroadcastChannelConstructor(channelName);
    const listener = (event) => {
      if (event?.data?.type === messageType) callback();
    };
    channel.addEventListener("message", listener);
    return () => {
      safeCall(() => channel.removeEventListener("message", listener));
      safeCall(() => channel.close());
    };
  } catch {
    return () => {};
  }
}

export function panicWipe(options = {}) {
  const root = options.root ?? globalThis;
  const setTimer = options.setTimeout ?? setTimeout;
  const clearTimer = options.clearTimeout ?? clearTimeout;
  const databaseTimeoutMilliseconds = options.databaseTimeoutMilliseconds
    ?? defaultDatabaseTimeoutMilliseconds;

  // These effects deliberately run before the first asynchronous boundary.
  safeCall(options.neutralize);
  safeCall(options.clearMemory);
  safeCall(options.abort);
  clearStorage(safeProperty(root, "sessionStorage"));
  clearStorage(safeProperty(root, "localStorage"));
  notifyOtherTabs(root);

  return (async () => {
    const navigatorObject = safeProperty(root, "navigator");
    const [cacheCount, databaseCount, registrationCount] = await Promise.all([
      deleteCaches(safeProperty(root, "caches")),
      deleteDatabases(
        safeProperty(root, "indexedDB"),
        options.knownDatabaseNames ?? [],
        databaseTimeoutMilliseconds,
        setTimer,
        clearTimer
      ),
      stopServiceWorkers(safeProperty(navigatorObject, "serviceWorker"))
    ]);

    // Repeat after unregistering to close races with in-flight worker operations.
    clearStorage(safeProperty(root, "sessionStorage"));
    clearStorage(safeProperty(root, "localStorage"));
    const retryCacheCount = await deleteCaches(safeProperty(root, "caches"));
    safeCall(options.replaceNavigation);
    return Object.freeze({
      cacheCount: cacheCount + retryCacheCount,
      databaseCount,
      registrationCount
    });
  })();
}

export const panicWipeProtocol = Object.freeze({ channelName, messageType });
