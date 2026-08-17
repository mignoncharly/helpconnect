export const constrainedProfile = Object.freeze({
  cpuThrottlingRate: 6,
  hardwareConcurrency: 2,
  id: "chromium-low-end-2g",
  locales: Object.freeze(["fr", "en", "ur"]),
  network: Object.freeze({
    connectionType: "cellular2g",
    downloadThroughput: 6_400,
    latency: 1_200,
    uploadThroughput: 3_200
  }),
  packetDropRatio: 0.5,
  quotaHeadroomBytes: 64 * 1024,
  viewport: Object.freeze({ deviceScaleFactor: 1, height: 568, mobile: true, width: 320 })
});

export const criticalScenario = Object.freeze([
  "load",
  "disconnect",
  "close-browser",
  "reopen-offline",
  "search-hospital",
  "open-first-aid",
  "enable-text-mode",
  "restore-very-slow-network",
  "receive-signed-delta",
  "panic-wipe",
  "inspect-all-storage"
]);

export const requiredMatrixDimensions = Object.freeze([
  Object.freeze({ id: "android-low-end", evidence: "physical-required" }),
  Object.freeze({ id: "low-ram", evidence: "android-emulator-or-physical" }),
  Object.freeze({ id: "slow-cpu", evidence: "automated-simulation" }),
  Object.freeze({ id: "simulated-2g", evidence: "automated-simulation" }),
  Object.freeze({ id: "latency-1-3s", evidence: "automated-simulation" }),
  Object.freeze({ id: "high-packet-loss", evidence: "automated-deterministic-drops" }),
  Object.freeze({ id: "intermittent-internet", evidence: "automated-simulation" }),
  Object.freeze({ id: "fully-offline", evidence: "automated-simulation" }),
  Object.freeze({ id: "slow-javascript", evidence: "automated-simulation" }),
  Object.freeze({ id: "storage-nearly-full", evidence: "automated-quota-override" }),
  Object.freeze({ id: "small-screen", evidence: "automated-simulation" }),
  Object.freeze({ id: "high-brightness", evidence: "physical-required" }),
  Object.freeze({ id: "dark-theme", evidence: "automated" }),
  Object.freeze({ id: "all-locales", evidence: "automated" })
]);

export function validateConstrainedMatrix({ profile, scenario, dimensions }) {
  const violations = [];
  const dimensionIds = new Set(dimensions.map(({ id }) => id));
  for (const required of requiredMatrixDimensions) {
    if (!dimensionIds.has(required.id)) violations.push(`missing matrix dimension: ${required.id}`);
  }
  if (JSON.stringify(scenario) !== JSON.stringify(criticalScenario)) violations.push("critical scenario order changed");
  if (profile.viewport.width > 360 || profile.viewport.height > 640) violations.push("viewport is not entry-level small");
  if (profile.cpuThrottlingRate < 6) violations.push("CPU throttling is below the low-end preset");
  if (profile.network.latency < 1_000 || profile.network.latency > 3_000) violations.push("latency must stay between 1 and 3 seconds");
  if (profile.network.downloadThroughput > 8_000 || profile.network.uploadThroughput > 4_000) violations.push("network is faster than the constrained 2G profile");
  if (profile.packetDropRatio < 0.3) violations.push("packet loss simulation is not high");
  if (profile.quotaHeadroomBytes > 128 * 1024) violations.push("storage headroom is not constrained");
  if (JSON.stringify(profile.locales) !== JSON.stringify(["fr", "en", "ur"])) violations.push("all supported locales are not covered");
  return violations;
}
