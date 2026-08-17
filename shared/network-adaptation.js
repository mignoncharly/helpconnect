export const networkAdaptationPolicy = Object.freeze({
  initialTimeoutMs: 1_000,
  recoverySuccesses: 3,
  retryTimeoutMs: 3_000
});

const networkModes = Object.freeze(["normal", "low", "text"]);

function isNetworkMode(value) {
  return networkModes.includes(value);
}

function nextLowerMode(mode) {
  if (mode === "normal") return "low";
  return "text";
}

function nextHigherMode(mode) {
  if (mode === "text") return "low";
  return "normal";
}

export function createNetworkAdaptationController(onChange = () => {}) {
  if (typeof onChange !== "function") throw new TypeError("Network adaptation listener must be a function");

  let automaticMode = "normal";
  let manualMode;
  let fastSuccesses = 0;

  function snapshot(reason) {
    return Object.freeze({
      automaticMode,
      fastSuccesses,
      mode: manualMode ?? automaticMode,
      reason,
      source: manualMode === undefined ? "automatic" : "manual"
    });
  }

  function publish(reason) {
    const state = snapshot(reason);
    onChange(state);
    return state;
  }

  return Object.freeze({
    clearManualMode() {
      manualMode = undefined;
      return publish("manual-cleared");
    },
    getState() {
      return snapshot("snapshot");
    },
    recordFailure(reason = "request-failed") {
      fastSuccesses = 0;
      const nextMode = nextLowerMode(automaticMode);
      if (nextMode === automaticMode) return snapshot(reason);
      automaticMode = nextMode;
      return publish(reason);
    },
    recordSuccess(durationMs) {
      if (!Number.isFinite(durationMs) || durationMs < 0) throw new TypeError("Request duration must be a non-negative finite number");
      if (durationMs >= networkAdaptationPolicy.initialTimeoutMs) {
        fastSuccesses = 0;
        return snapshot("slow-success");
      }
      if (automaticMode === "normal") {
        fastSuccesses = 0;
        return snapshot("fast-success");
      }
      fastSuccesses += 1;
      if (fastSuccesses < networkAdaptationPolicy.recoverySuccesses) return snapshot("fast-success");
      fastSuccesses = 0;
      automaticMode = nextHigherMode(automaticMode);
      return publish("recovered");
    },
    setManualMode(mode) {
      if (!isNetworkMode(mode)) throw new TypeError("Invalid manual network mode");
      manualMode = mode;
      return publish("manual-selected");
    }
  });
}

function abortError(message) {
  return new DOMException(message, "AbortError");
}

async function runTimedAttempt(attempt, attemptNumber, timeoutMs, parentSignal) {
  if (parentSignal?.aborted) throw parentSignal.reason ?? abortError("Request aborted");
  const controller = new AbortController();
  const startedAt = performance.now();
  let timedOut = false;
  const abortFromParent = () => controller.abort(parentSignal?.reason ?? abortError("Request aborted"));
  parentSignal?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(abortError("Request timed out"));
  }, timeoutMs);
  try {
    const value = await attempt(controller.signal, attemptNumber);
    return { durationMs: performance.now() - startedAt, value };
  } catch (error) {
    if (timedOut) throw abortError("Request timed out");
    throw error;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}

export async function runAdaptiveRequest(attempt, adaptation, options = {}) {
  if (typeof attempt !== "function") throw new TypeError("Adaptive request attempt must be a function");
  const initialTimeoutMs = options.initialTimeoutMs ?? networkAdaptationPolicy.initialTimeoutMs;
  const retryTimeoutMs = options.retryTimeoutMs ?? networkAdaptationPolicy.retryTimeoutMs;
  if (!Number.isFinite(initialTimeoutMs) || initialTimeoutMs <= 0 || !Number.isFinite(retryTimeoutMs) || retryTimeoutMs <= 0) {
    throw new TypeError("Adaptive request timeouts must be positive finite numbers");
  }

  try {
    const result = await runTimedAttempt(attempt, 1, initialTimeoutMs, options.parentSignal);
    adaptation.recordSuccess(result.durationMs);
    return result.value;
  } catch (error) {
    if (options.parentSignal?.aborted) throw error;
    adaptation.recordFailure("initial-attempt-failed");
  }

  try {
    const result = await runTimedAttempt(attempt, 2, retryTimeoutMs, options.parentSignal);
    adaptation.recordSuccess(result.durationMs);
    return result.value;
  } catch (error) {
    if (options.parentSignal?.aborted) throw error;
    adaptation.recordFailure("retry-failed");
    throw error;
  }
}
