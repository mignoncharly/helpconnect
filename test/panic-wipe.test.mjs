import assert from "node:assert/strict";
import test from "node:test";
import { listenForPanicWipe, panicWipe, panicWipeProtocol } from "../shared/panic-wipe.js";

class MemoryStorage {
  constructor(entries = {}) {
    this.entries = new Map(Object.entries(entries));
    this.clearCount = 0;
  }

  clear() {
    this.clearCount += 1;
    this.entries.clear();
  }
}

class TestBroadcastChannel extends EventTarget {
  static instances = [];

  constructor(name) {
    super();
    this.name = name;
    this.closed = false;
    this.messages = [];
    TestBroadcastChannel.instances.push(this);
  }

  postMessage(value) {
    this.messages.push(value);
  }

  close() {
    this.closed = true;
  }
}

function successfulDatabaseRequest(deletedNames, name) {
  const request = new EventTarget();
  queueMicrotask(() => {
    deletedNames.push(name);
    request.dispatchEvent(new Event("success"));
  });
  return request;
}

test("panic wipe neutralizes synchronously then purges every controllable browser store", async () => {
  TestBroadcastChannel.instances = [];
  const events = [];
  const localStorage = new MemoryStorage({ query: "sensitive" });
  const sessionStorage = new MemoryStorage({ "hc:locale": "ur" });
  const cacheNames = new Set(["hc-shell-test", "hc-data-v1", "unrelated-origin-cache"]);
  const deletedDatabases = [];
  const workerMessages = [];
  let unregistered = false;
  let navigationReplaced = false;
  const root = {
    BroadcastChannel: TestBroadcastChannel,
    caches: {
      async keys() { return [...cacheNames]; },
      async delete(name) {
        events.push(`cache:${name}`);
        return cacheNames.delete(name);
      }
    },
    indexedDB: {
      async databases() { return [{ name: "hc-map" }, { name: "future-store" }]; },
      deleteDatabase(name) { return successfulDatabaseRequest(deletedDatabases, name); }
    },
    localStorage,
    navigator: {
      serviceWorker: {
        async getRegistrations() {
          return [{
            active: { postMessage(value) { workerMessages.push(value); } },
            installing: null,
            waiting: null,
            async unregister() {
              unregistered = true;
              return true;
            }
          }];
        }
      }
    },
    sessionStorage
  };

  const resultPromise = panicWipe({
    root,
    knownDatabaseNames: ["hc-public-v1"],
    neutralize: () => events.push("neutralize"),
    clearMemory: () => events.push("memory"),
    abort: () => events.push("abort"),
    replaceNavigation: () => { navigationReplaced = true; }
  });

  assert.deepEqual(events, ["neutralize", "memory", "abort"]);
  assert.equal(localStorage.entries.size, 0);
  assert.equal(sessionStorage.entries.size, 0);
  assert.equal(navigationReplaced, false);

  const result = await resultPromise;
  assert.equal(cacheNames.size, 0);
  assert.deepEqual(deletedDatabases.sort(), ["future-store", "hc-map", "hc-public-v1"]);
  assert.deepEqual(workerMessages, [{ type: panicWipeProtocol.messageType }]);
  assert.equal(unregistered, true);
  assert.equal(navigationReplaced, true);
  assert.deepEqual(result, { cacheCount: 3, databaseCount: 3, registrationCount: 1 });
  assert.equal(localStorage.clearCount, 2);
  assert.equal(sessionStorage.clearCount, 2);
  assert.deepEqual(TestBroadcastChannel.instances[0]?.messages, [{ type: panicWipeProtocol.messageType }]);
  assert.equal(TestBroadcastChannel.instances[0]?.closed, true);
});

test("denied and blocked capabilities do not stop navigation replacement", async () => {
  const blockedRequest = new EventTarget();
  queueMicrotask(() => blockedRequest.dispatchEvent(new Event("blocked")));
  let replaced = false;
  const root = {
    caches: { async keys() { throw new Error("denied"); }, async delete() { return false; } },
    indexedDB: {
      async databases() { throw new Error("not supported"); },
      deleteDatabase() { return blockedRequest; }
    },
    navigator: { serviceWorker: { async getRegistrations() { throw new Error("denied"); } } }
  };
  Object.defineProperty(root, "localStorage", { get() { throw new Error("denied"); } });
  Object.defineProperty(root, "sessionStorage", { get() { throw new Error("denied"); } });

  const result = await panicWipe({
    root,
    knownDatabaseNames: ["hc-public-v1"],
    databaseTimeoutMilliseconds: 5,
    replaceNavigation: () => { replaced = true; }
  });

  assert.deepEqual(result, { cacheCount: 0, databaseCount: 0, registrationCount: 0 });
  assert.equal(replaced, true);
});

test("a valid broadcast triggers panic wipe in another tab and cleanup closes the listener", () => {
  TestBroadcastChannel.instances = [];
  let calls = 0;
  const stop = listenForPanicWipe(() => { calls += 1; }, { BroadcastChannel: TestBroadcastChannel });
  const channel = TestBroadcastChannel.instances[0];
  channel.dispatchEvent(Object.assign(new Event("message"), { data: { type: "IGNORED" } }));
  channel.dispatchEvent(Object.assign(new Event("message"), { data: { type: panicWipeProtocol.messageType } }));
  assert.equal(calls, 1);
  stop();
  assert.equal(channel.closed, true);
  channel.dispatchEvent(Object.assign(new Event("message"), { data: { type: panicWipeProtocol.messageType } }));
  assert.equal(calls, 1);
});
