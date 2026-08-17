import {
  decodeBase64url,
  validateTrustKeyring,
  verifyArtifact,
  verifyEnvelopeWithJwk
} from "../shared/integrity.js";
import type { SignatureEnvelope, TrustKeyring } from "../shared/integrity.js";
import { publicCachePolicy } from "../shared/cache-policy.js";
import { createNetworkAdaptationController, runAdaptiveRequest } from "../shared/network-adaptation.js";
import type { NetworkModeSource } from "../shared/network-adaptation.js";
import { createPublicAssetRequest } from "../shared/network-privacy.js";
import { listenForPanicWipe, panicWipe } from "../shared/panic-wipe.js";

declare const __ROOT_KEY_ID__: string;
declare const __ROOT_PUBLIC_JWK__: JsonWebKey;

if (location.search || location.hash) {
  try {
    history.replaceState(null, "", location.pathname);
  } catch {
    // URL minimization is best effort when history access is restricted.
  }
}

const screenNames = ["home", "map", "first-aid", "first-aid-detail", "search", "settings"] as const;
const primaryScreenNames = ["home", "map", "first-aid", "search"] as const;
const localeNames = ["fr", "en", "ur"] as const;
const themeNames = ["light", "dark"] as const;
const networkModeNames = ["normal", "low", "text"] as const;
const directoryCategoryNames = ["water", "hospital", "food", "shelter", "first-aid", "generator"] as const;
const directoryStatusNames = ["VERIFIED", "STALE", "UNAVAILABLE", "CLOSED"] as const;

type ScreenName = typeof screenNames[number];
type PrimaryScreenName = typeof primaryScreenNames[number];
type LocaleName = typeof localeNames[number];
type ThemeName = typeof themeNames[number];
type NetworkModeName = typeof networkModeNames[number];
type DirectoryCategoryName = typeof directoryCategoryNames[number];
type DirectoryStatusName = typeof directoryStatusNames[number];
type DirectoryFilterName = DirectoryCategoryName | "all";
type Messages = Readonly<Record<string, string>>;

type LocalizedText = Readonly<Record<LocaleName, string>>;
interface DirectoryPoint {
  readonly category: DirectoryCategoryName;
  readonly coarse_location: LocalizedText;
  readonly expires_at: string | null;
  readonly id: string;
  readonly region: string;
  readonly revision: number;
  readonly status: DirectoryStatusName;
  readonly verified_at: string | null;
}

interface DirectoryBundle {
  readonly bundle_id: "hc-demo-directory";
  readonly points: readonly DirectoryPoint[];
  readonly published_at: string;
  readonly revision: number;
  readonly schema_version: 2;
  readonly status: "DEMO_NOT_OPERATIONAL";
}

type SchematicPoint = readonly [number, number];

interface MapRegionMetadata {
  readonly baseVersion: number;
  readonly id: string;
  readonly label: LocalizedText;
  readonly path: string;
}

interface MapBootstrap {
  readonly bundleId: "hc-demo-map-bootstrap";
  readonly regions: readonly MapRegionMetadata[];
  readonly revision: 1;
  readonly schemaVersion: 1;
  readonly status: "DEMO_NOT_OPERATIONAL";
}

interface MapRegion {
  readonly boundary: readonly SchematicPoint[];
  readonly bundleId: "hc-demo-map-region";
  readonly datasetVersion: number;
  readonly districts: readonly { readonly anchor: SchematicPoint; readonly label: LocalizedText }[];
  readonly geometryKind: "SCHEMATIC_NOT_GEOGRAPHIC";
  readonly points: readonly { readonly directoryId: string; readonly position: SchematicPoint }[];
  readonly regionId: string;
  readonly revision: 1;
  readonly roads: readonly (readonly SchematicPoint[])[];
  readonly schemaVersion: 1;
  readonly status: "DEMO_NOT_OPERATIONAL";
}

interface UpdateTransition {
  readonly from: number;
  readonly path: string;
  readonly to: number;
}

interface RegionUpdateMetadata {
  readonly currentVersion: number;
  readonly deltas: readonly UpdateTransition[];
  readonly regionId: string;
  readonly snapshotPath: string;
}

interface UpdateManifest {
  readonly bundleId: "hc-demo-map-updates";
  readonly regions: readonly RegionUpdateMetadata[];
  readonly schemaVersion: 1;
  readonly status: "DEMO_NOT_OPERATIONAL";
}

type MapDeltaChange =
  | { readonly directoryId: string; readonly op: "move-point"; readonly position: SchematicPoint }
  | { readonly op: "replace-road"; readonly points: readonly SchematicPoint[]; readonly roadIndex: number };

interface MapDelta {
  readonly bundleId: "hc-demo-map-delta";
  readonly changes: readonly MapDeltaChange[];
  readonly from: number;
  readonly regionId: string;
  readonly schemaVersion: 1;
  readonly status: "DEMO_NOT_OPERATIONAL";
  readonly to: number;
}

interface FirstAidSource {
  readonly id: string;
  readonly publisher: string;
  readonly title: string;
  readonly updatedAt: string;
}

interface FirstAidGuide {
  readonly avoid: readonly string[];
  readonly emergency: string;
  readonly id: string;
  readonly sources: readonly string[];
  readonly steps: readonly string[];
  readonly summary: string;
  readonly title: string;
}

interface FirstAidBundle {
  readonly bundleId: "hc-first-aid-core";
  readonly dir: "ltr" | "rtl";
  readonly expiresAt: null;
  readonly guides: readonly FirstAidGuide[];
  readonly locale: LocaleName;
  readonly revision: 1;
  readonly schemaVersion: 1;
  readonly sourceCheckedAt: string;
  readonly sources: readonly FirstAidSource[];
  readonly status: "REVIEW_REQUIRED";
}

type ConsentAction = "export" | "install" | "region";

interface SignedDocument {
  readonly bytes: Uint8Array;
  readonly content: string;
  readonly envelope: SignatureEnvelope;
}

interface IntegrityState {
  readonly bundle_id: "hc-integrity-state";
  readonly schema_version: 1;
  readonly sequences: Record<string, number>;
}

const localeMetadata: Record<LocaleName, { dir: "ltr" | "rtl"; lang: string }> = {
  fr: { dir: "ltr", lang: "fr" },
  en: { dir: "ltr", lang: "en" },
  ur: { dir: "rtl", lang: "ur" }
};
const sessionKeys = {
  locale: "hc:locale",
  theme: "hc:theme"
} as const;
const screens = new Map<ScreenName, HTMLElement>();

for (const element of document.querySelectorAll<HTMLElement>("[data-screen]")) {
  const name = element.dataset.screen;
  if (isScreenName(name)) {
    screens.set(name, element);
  }
}

const bottomNavigation = document.querySelector<HTMLElement>("[data-bottom-nav]");
const liveStatus = document.querySelector<HTMLElement>("[data-live-status]");
const phaseNotice = document.querySelector<HTMLElement>("[data-phase-notice]");
let noticeTimer: number | undefined;
let currentScreen: ScreenName = "home";
let previousPrimaryScreen: PrimaryScreenName = "home";
let recentSearches: string[] = [];
let currentLocale: LocaleName = "fr";
let currentMessages: Messages = {};
let directoryBundle: DirectoryBundle | undefined;
let directoryPromise: Promise<DirectoryBundle> | undefined;
let activeDirectoryCategory: DirectoryFilterName = "all";
let activeSearchQuery = "";
let currentNetworkMode: NetworkModeName = "normal";
let currentNetworkModeSource: NetworkModeSource = "automatic";
let mapBootstrap: MapBootstrap | undefined;
let mapBootstrapPromise: Promise<MapBootstrap> | undefined;
let trustKeyringPromise: Promise<TrustKeyring> | undefined;
let integrityStatePromise: Promise<IntegrityState> | undefined;
const mapRegions = new Map<string, MapRegion>();
let selectedRegionId: string | undefined;
let regionUpdateInProgress = false;
const firstAidBundles = new Map<LocaleName, FirstAidBundle>();
const consentModal = document.querySelector<HTMLElement>("[data-consent-modal]");
const consentTitle = document.querySelector<HTMLElement>("[data-consent-title]");
const consentDescription = document.querySelector<HTMLElement>("[data-consent-description]");
const consentConfirm = document.querySelector<HTMLButtonElement>("[data-consent-confirm]");
const mainContent = document.querySelector<HTMLElement>(".screens");
let consentAction: ConsentAction | undefined;
let focusBeforeConsent: HTMLElement | null = null;
let panicWipeStarted = false;
const appAbortController = new AbortController();
const networkAdaptation = createNetworkAdaptationController((state) => {
  setNetworkMode(state.mode, state.source);
});

interface StaticTrustedTypesFactory {
  createPolicy(name: "help-connect-static", rules: { createScriptURL(value: string): string }): {
    createScriptURL(value: string): unknown;
  };
}

function serviceWorkerScriptUrl(): string {
  const path = "./service-worker.js";
  const factory = (window as unknown as { trustedTypes?: StaticTrustedTypesFactory }).trustedTypes;
  if (!factory) return path;
  const policy = factory.createPolicy("help-connect-static", {
    createScriptURL(value) {
      if (value !== path) throw new TypeError("Unapproved script URL");
      return value;
    }
  });
  return policy.createScriptURL(path) as string;
}

const offlineWorkerScriptUrl = serviceWorkerScriptUrl();

function isScreenName(value: string | undefined): value is ScreenName {
  return screenNames.some((name) => name === value);
}

function isPrimaryScreenName(value: ScreenName): value is PrimaryScreenName {
  return primaryScreenNames.some((name) => name === value);
}

function isLocaleName(value: string | null): value is LocaleName {
  return localeNames.some((name) => name === value);
}

function isThemeName(value: string | null): value is ThemeName {
  return themeNames.some((name) => name === value);
}

function isNetworkModeName(value: string | undefined): value is NetworkModeName {
  return networkModeNames.some((name) => name === value);
}

function isDirectoryFilterName(value: string | undefined): value is DirectoryFilterName {
  return value === "all" || directoryCategoryNames.some((name) => name === value);
}

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // The preference remains in memory when session storage is unavailable.
  }
}

function message(key: string): string {
  const catalogEntry = document.querySelector<HTMLElement>(`[data-message="${key}"]`);
  return catalogEntry?.textContent?.trim() ?? "";
}

function uiText(key: string, fallback: string): string {
  return currentMessages[key]
    ?? document.querySelector<HTMLElement>(`[data-i18n="${key}"]`)?.textContent?.trim()
    ?? fallback;
}

function announce(text: string): void {
  if (liveStatus) {
    liveStatus.textContent = "";
    window.setTimeout(() => {
      liveStatus.textContent = text;
    }, 0);
  }
}

function showPhaseNotice(key = "feature"): void {
  if (!phaseNotice) {
    return;
  }
  window.clearTimeout(noticeTimer);
  phaseNotice.textContent = message(key);
  phaseNotice.hidden = false;
  announce(phaseNotice.textContent);
  noticeTimer = window.setTimeout(() => {
    phaseNotice.hidden = true;
  }, 4500);
}

function navigateTo(nextScreen: ScreenName, focusHeading = true): void {
  if (nextScreen === "settings" && isPrimaryScreenName(currentScreen)) {
    previousPrimaryScreen = currentScreen;
  }
  if (isPrimaryScreenName(nextScreen)) {
    previousPrimaryScreen = nextScreen;
  }

  currentScreen = nextScreen;
  for (const [name, screen] of screens) {
    screen.hidden = name !== nextScreen;
  }

  if (bottomNavigation) {
    bottomNavigation.hidden = nextScreen === "settings";
  }
  const activePrimaryScreen = nextScreen === "first-aid-detail" ? "first-aid" : nextScreen;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-bottom-nav] [data-navigate]")) {
    if (button.dataset.navigate === activePrimaryScreen) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  }

  phaseNotice?.setAttribute("hidden", "");
  if (focusHeading) {
    screens.get(nextScreen)?.querySelector<HTMLElement>("h1")?.focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0, behavior: "instant" });
  if (nextScreen === "first-aid") {
    void refreshFirstAidStatus(currentLocale);
  }
  if (nextScreen === "map" || nextScreen === "search") {
    void renderDirectory();
  }
  if (nextScreen === "map") {
    void initializeMap();
  }
}

function normalizeQuery(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
}

function renderRecentSearches(): void {
  const hasHistory = recentSearches.length > 0;
  for (const container of document.querySelectorAll<HTMLElement>("[data-recent-container]")) {
    container.hidden = !hasHistory;
  }
  for (const list of document.querySelectorAll<HTMLElement>("[data-recent-list]")) {
    const buttons = recentSearches.map((query) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "recent-chip";
      button.dataset.recentQuery = query;
      button.textContent = query;
      return button;
    });
    list.replaceChildren(...buttons);
  }
}

function useQuery(rawQuery: string): void {
  const query = normalizeQuery(rawQuery);
  if (!query) {
    return;
  }

  recentSearches = [
    query,
    ...recentSearches.filter((item) => item.toLocaleLowerCase() !== query.toLocaleLowerCase())
  ].slice(0, 4);
  renderRecentSearches();

  const searchScreenInput = screens.get("search")?.querySelector<HTMLInputElement>("[data-search-input]");
  if (searchScreenInput) {
    searchScreenInput.value = query;
  }
  activeSearchQuery = query;
  activeDirectoryCategory = "all";
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-directory-category]")) {
    button.setAttribute("aria-pressed", String(button.dataset.directoryCategory === "all"));
  }
  navigateTo("search");
  showPhaseNotice("search");
}

function setTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute(
    "content",
    theme === "dark" ? "#1d1f1b" : "#ffffff"
  );
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="theme"]')) {
    input.checked = input.value === theme;
  }
  writeSession(sessionKeys.theme, theme);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const integrityDataCacheName = publicCachePolicy.data;
const firstAidCacheName = publicCachePolicy.firstAid;
const integrityStateUrl = new URL(`./${publicCachePolicy.integrityStateFile}`, document.baseURI).href;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function exactObjectKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function decodeUtf8(bytes: Uint8Array): string {
  return utf8Decoder.decode(bytes);
}

async function responseBytes(response: Response, maximumLength: number, label: string): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("Content-Length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumLength) throw new Error(`${label} exceeds its size limit`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maximumLength) throw new Error(`${label} exceeds its size limit`);
  return bytes;
}

async function fetchBytes(path: string, maximumLength: number, label: string): Promise<Uint8Array> {
  return runAdaptiveRequest(async (signal) => {
    const response = await fetch(createPublicAssetRequest(path, document.baseURI, { signal }));
    if (!response.ok) throw new Error(`${label} request failed: ${response.status}`);
    return responseBytes(response, maximumLength, label);
  }, networkAdaptation, { parentSignal: appAbortController.signal });
}

function parseIntegrityState(value: unknown): IntegrityState {
  if (!isRecord(value) || !exactObjectKeys(value, ["bundle_id", "schema_version", "sequences"]) || value.schema_version !== 1 || value.bundle_id !== "hc-integrity-state" || !isRecord(value.sequences)) {
    throw new Error("Invalid integrity state");
  }
  const entries = Object.entries(value.sequences);
  if (entries.length > 64) throw new Error("Integrity state is too large");
  const sequences: Record<string, number> = {};
  for (const [key, sequence] of entries) {
    if (key.length < 1 || key.length > 180 || !Number.isSafeInteger(sequence) || (sequence as number) < 1) throw new Error("Invalid integrity sequence");
    sequences[key] = sequence as number;
  }
  return { schema_version: 1, bundle_id: "hc-integrity-state", sequences };
}

async function loadIntegrityState(): Promise<IntegrityState> {
  integrityStatePromise ??= (async () => {
    if (!("caches" in window)) return { schema_version: 1, bundle_id: "hc-integrity-state", sequences: {} };
    const cache = await caches.open(integrityDataCacheName);
    const response = await cache.match(integrityStateUrl);
    if (!response) return { schema_version: 1, bundle_id: "hc-integrity-state", sequences: {} };
    const bytes = await responseBytes(response, 12_000, "Integrity state");
    return parseIntegrityState(JSON.parse(decodeUtf8(bytes)) as unknown);
  })();
  return integrityStatePromise;
}

async function minimumIntegritySequence(key: string): Promise<number> {
  return (await loadIntegrityState()).sequences[key] ?? 0;
}

async function commitIntegritySequence(key: string, sequence: number): Promise<void> {
  if (panicWipeStarted) return;
  const state = await loadIntegrityState();
  if (panicWipeStarted) return;
  if ((state.sequences[key] ?? 0) >= sequence) return;
  state.sequences[key] = sequence;
  if (!("caches" in window)) return;
  const cache = await caches.open(integrityDataCacheName);
  if (panicWipeStarted) return;
  await cache.put(integrityStateUrl, new Response(`${JSON.stringify(state)}\n`, {
    headers: { "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" }
  }));
}

async function fetchSignatureEnvelope(path: string): Promise<SignatureEnvelope> {
  const bytes = await fetchBytes(`${path}.sig.json`, 4_000, "Signature envelope");
  return JSON.parse(decodeUtf8(bytes)) as SignatureEnvelope;
}

async function loadTrustKeyring(): Promise<TrustKeyring> {
  trustKeyringPromise ??= (async () => {
    const [bytes, envelope] = await Promise.all([
      fetchBytes("trust/keyring.json", 12_000, "Trust keyring"),
      fetchSignatureEnvelope("trust/keyring.json")
    ]);
    const minimumSequence = await minimumIntegritySequence("trust/keyring.json");
    const verifiedEnvelope = await verifyEnvelopeWithJwk({
      bytes,
      envelope,
      expectedPath: "trust/keyring.json",
      publicJwk: __ROOT_PUBLIC_JWK__,
      expectedKeyId: __ROOT_KEY_ID__,
      minimumSequence
    });
    const keyring = validateTrustKeyring(JSON.parse(decodeUtf8(bytes)) as unknown);
    if (keyring.revision !== verifiedEnvelope.sequence) throw new Error("Trust keyring revision mismatch");
    await commitIntegritySequence("trust/keyring.json", verifiedEnvelope.sequence);
    return keyring;
  })();
  try {
    return await trustKeyringPromise;
  } catch (error) {
    trustKeyringPromise = undefined;
    throw error;
  }
}

async function verifySignedBytes(bytes: Uint8Array, path: string, envelope: unknown): Promise<SignatureEnvelope> {
  return verifyArtifact({
    bytes,
    envelope,
    expectedPath: path,
    keyring: await loadTrustKeyring(),
    minimumSequence: await minimumIntegritySequence(path)
  });
}

async function fetchSignedDocument(path: string, maximumLength: number): Promise<SignedDocument> {
  const [bytes, envelope] = await Promise.all([
    fetchBytes(path, maximumLength, "Signed artifact"),
    fetchSignatureEnvelope(path)
  ]);
  const verifiedEnvelope = await verifySignedBytes(bytes, path, envelope);
  return { bytes, content: decodeUtf8(bytes), envelope: verifiedEnvelope };
}

async function readCachedSignedResponse(response: Response, maximumLength: number): Promise<SignedDocument & { readonly signedPath: string }> {
  const signedPath = response.headers.get("X-HC-Signed-Path");
  const encodedEnvelope = response.headers.get("X-HC-Signature");
  if (!signedPath || !encodedEnvelope || encodedEnvelope.length > 5_500) throw new Error("Cached artifact lacks integrity metadata");
  const envelope = JSON.parse(decodeUtf8(decodeBase64url(encodedEnvelope))) as unknown;
  const bytes = await responseBytes(response, maximumLength, "Cached artifact");
  const verifiedEnvelope = await verifySignedBytes(bytes, signedPath, envelope);
  return { bytes, content: decodeUtf8(bytes), envelope: verifiedEnvelope, signedPath };
}

function boundedString(value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new Error("Invalid bounded string in first-aid bundle");
  }
  return value;
}

function stringList(value: unknown, minimum: number, maximumItems: number, maximumLength: number): readonly string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximumItems) {
    throw new Error("Invalid list in first-aid bundle");
  }
  return value.map((item) => boundedString(item, maximumLength));
}

function isoDate(value: unknown): string {
  const date = boundedString(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error("Invalid date in first-aid bundle");
  }
  return date;
}

function localizedText(value: unknown, label: string): LocalizedText {
  if (!isRecord(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...localeNames].sort())) {
    throw new Error(`Invalid localized ${label}`);
  }
  return {
    fr: boundedString(value.fr, 120),
    en: boundedString(value.en, 120),
    ur: boundedString(value.ur, 120)
  };
}

function isoInstant(value: unknown, nullable = false): string | null {
  if (nullable && value === null) return null;
  const instant = boundedString(value, 30);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(instant) || Number.isNaN(Date.parse(instant))) {
    throw new Error("Invalid UTC timestamp");
  }
  return instant;
}

function validateDirectoryBundle(value: unknown): DirectoryBundle {
  const bundleKeys = ["bundle_id", "points", "published_at", "revision", "schema_version", "status"];
  if (!isRecord(value) || Object.keys(value).sort().join(",") !== bundleKeys.sort().join(",") || value.schema_version !== 2 || value.bundle_id !== "hc-demo-directory" || value.status !== "DEMO_NOT_OPERATIONAL" || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || !Array.isArray(value.points) || value.points.length < 1 || value.points.length > 500) {
    throw new Error("Unsupported local directory");
  }
  const publishedAt = isoInstant(value.published_at);
  if (publishedAt === null) throw new Error("Missing publication time");
  const ids = new Set<string>();
  const points = value.points.map((item): DirectoryPoint => {
    const pointKeys = ["category", "coarse_location", "expires_at", "id", "region", "revision", "status", "verified_at"];
    if (!isRecord(item) || Object.keys(item).sort().join(",") !== pointKeys.sort().join(",") || typeof item.category !== "string" || !directoryCategoryNames.some((category) => category === item.category) || typeof item.status !== "string" || !directoryStatusNames.some((status) => status === item.status) || !Number.isSafeInteger(item.revision) || (item.revision as number) < 1) {
      throw new Error("Invalid minimized directory point");
    }
    const id = boundedString(item.id, 60);
    if (ids.has(id)) throw new Error("Duplicate directory point");
    ids.add(id);
    const verifiedAt = isoInstant(item.verified_at, true);
    const expiresAt = isoInstant(item.expires_at, true);
    if (item.status === "VERIFIED" && (verifiedAt === null || expiresAt === null)) throw new Error("Verified point lacks timestamps");
    return {
      id,
      category: item.category as DirectoryCategoryName,
      region: boundedString(item.region, 60),
      coarse_location: localizedText(item.coarse_location, "coarse location"),
      status: item.status as DirectoryStatusName,
      verified_at: verifiedAt,
      expires_at: expiresAt,
      revision: item.revision as number
    };
  });
  return {
    schema_version: 2,
    bundle_id: "hc-demo-directory",
    revision: value.revision as number,
    status: "DEMO_NOT_OPERATIONAL",
    published_at: publishedAt,
    points
  };
}

async function loadDirectoryBundle(): Promise<DirectoryBundle> {
  if (directoryBundle) {
    return directoryBundle;
  }
  directoryPromise ??= (async () => {
    const document = await fetchSignedDocument("directory.json", 30_000);
    const bundle = validateDirectoryBundle(JSON.parse(document.content) as unknown);
    if (bundle.revision !== document.envelope.sequence) throw new Error("Directory revision mismatch");
    await commitIntegritySequence("directory.json", document.envelope.sequence);
    directoryBundle = bundle;
    return bundle;
  })();
  try {
    return await directoryPromise;
  } catch (error) {
    directoryPromise = undefined;
    throw error;
  }
}

function normalizeIndexText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase(currentLocale)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function categoryLabel(category: DirectoryCategoryName): string {
  const keys: Record<DirectoryCategoryName, string> = {
    water: "map.water",
    hospital: "map.hospital",
    food: "map.food",
    shelter: "map.shelter",
    "first-aid": "search.firstAid",
    generator: "map.generator"
  };
  return uiText(keys[category], category);
}

function matchingDirectoryPoints(points: readonly DirectoryPoint[], query: string, category: DirectoryFilterName): readonly DirectoryPoint[] {
  const tokens = normalizeIndexText(query).split(" ").filter(Boolean);
  return points.filter((point) => {
    if (category !== "all" && point.category !== category) {
      return false;
    }
    const haystack = normalizeIndexText([
      point.id,
      point.region,
      point.coarse_location[currentLocale],
      categoryLabel(point.category),
    ].join(" "));
    return tokens.every((token) => haystack.includes(token));
  });
}

function directoryCard(point: DirectoryPoint): HTMLElement {
  const card = document.createElement("article");
  card.className = "directory-card";
  card.dataset.directoryPoint = point.id;
  const heading = document.createElement("h3");
  heading.textContent = categoryLabel(point.category);
  const category = document.createElement("span");
  category.className = "directory-card__category";
  category.textContent = categoryLabel(point.category);
  const location = document.createElement("p");
  location.className = "directory-card__neighborhood";
  location.textContent = `${point.coarse_location[currentLocale]} · ${point.region}`;
  const effectiveStatus = point.status === "VERIFIED" && point.expires_at !== null && Date.parse(point.expires_at) <= Date.now() ? "STALE" : point.status;
  const status = document.createElement("strong");
  status.className = `directory-card__status directory-card__status--${effectiveStatus.toLocaleLowerCase()}`;
  status.textContent = uiText(`directory.status.${effectiveStatus}`, effectiveStatus);
  const integrity = document.createElement("p");
  integrity.className = "directory-card__integrity";
  const verifiedLabel = uiText("directory.verifiedAt", "Last verification");
  const expiryLabel = uiText("directory.expiresAt", "Expiry");
  const revisionLabel = uiText("directory.revision", "Revision");
  const format = new Intl.DateTimeFormat(localeMetadata[currentLocale].lang, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  const details = [`${revisionLabel} ${point.revision}`];
  if (point.verified_at !== null) details.unshift(`${verifiedLabel}: ${format.format(new Date(point.verified_at))}`);
  if (point.expires_at !== null) details.push(`${expiryLabel}: ${format.format(new Date(point.expires_at))}`);
  integrity.textContent = details.join(" · ");
  card.append(category, heading, location, status, integrity);
  return card;
}

async function renderDirectory(): Promise<void> {
  try {
    const bundle = await loadDirectoryBundle();
    for (const list of document.querySelectorAll<HTMLElement>("[data-directory-list]")) {
      const isSearchList = Boolean(list.closest('[data-screen="search"]'));
      const points = matchingDirectoryPoints(bundle.points, isSearchList ? activeSearchQuery : "", activeDirectoryCategory);
      list.replaceChildren(...points.map(directoryCard));
      const screen = list.closest<HTMLElement>("[data-screen]");
      const empty = screen?.querySelector<HTMLElement>("[data-directory-empty]");
      const count = screen?.querySelector<HTMLElement>("[data-directory-count]");
      if (empty) empty.hidden = points.length > 0;
      if (count) count.textContent = String(points.length);
    }
  } catch {
    for (const list of document.querySelectorAll<HTMLElement>("[data-directory-list]")) {
      list.replaceChildren();
    }
    showPhaseNotice("directoryLoadError");
  }
}

function setDirectoryCategory(category: DirectoryFilterName, clearQuery: boolean): void {
  activeDirectoryCategory = category;
  if (clearQuery) {
    activeSearchQuery = "";
    const searchInput = screens.get("search")?.querySelector<HTMLInputElement>("[data-search-input]");
    if (searchInput) searchInput.value = "";
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-directory-category]")) {
    button.setAttribute("aria-pressed", String(button.dataset.directoryCategory === category));
  }
  updateMapPointVisibility();
  void renderDirectory();
}

function setSvgHidden(element: SVGElement, hidden: boolean): void {
  if (hidden) element.setAttribute("hidden", "");
  else element.removeAttribute("hidden");
}

function setNetworkMode(mode: NetworkModeName, source: NetworkModeSource = currentNetworkModeSource): void {
  currentNetworkMode = mode;
  currentNetworkModeSource = source;
  document.documentElement.dataset.networkMode = mode;
  document.documentElement.dataset.networkModeSource = source;
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-network-mode]")) {
    button.setAttribute("aria-pressed", String(button.dataset.networkMode === mode));
  }
  for (const visual of document.querySelectorAll<HTMLElement>("[data-map-visual]")) {
    visual.hidden = mode === "text";
  }
  for (const visual of document.querySelectorAll<HTMLElement>("[data-low-data-visual]")) {
    visual.hidden = mode !== "low";
  }
  for (const detail of document.querySelectorAll<SVGElement>('[data-map-detail="normal"]')) {
    setSvgHidden(detail, mode !== "normal");
  }
  const statusKey = mode === "normal" ? "networkNormal" : mode === "low" ? "networkLow" : "networkText";
  const statusText = message(statusKey);
  const status = document.querySelector<HTMLElement>("[data-network-mode-status]");
  if (status) status.textContent = statusText;
  announce(statusText);
}

function schematicPoint(value: unknown, label: string): SchematicPoint {
  if (!Array.isArray(value) || value.length !== 2 || value.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate) || coordinate < 0 || coordinate > 100)) {
    throw new Error(`Invalid schematic ${label}`);
  }
  return [value[0] as number, value[1] as number];
}

function schematicLine(value: unknown, minimum: number, maximum: number, label: string): readonly SchematicPoint[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new Error(`Invalid schematic ${label}`);
  }
  return value.map((entry) => schematicPoint(entry, label));
}

function datasetVersion(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 9999) throw new Error(`Invalid ${label}`);
  return value as number;
}

function validateMapBootstrap(value: unknown): MapBootstrap {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.bundleId !== "hc-demo-map-bootstrap" || value.revision !== 1 || value.status !== "DEMO_NOT_OPERATIONAL" || !Array.isArray(value.regions) || value.regions.length !== 2) {
    throw new Error("Unsupported map bootstrap");
  }
  const ids = new Set<string>();
  const regions = value.regions.map((entry): MapRegionMetadata => {
    if (!isRecord(entry)) throw new Error("Invalid map region metadata");
    const id = boundedString(entry.id, 40);
    const path = boundedString(entry.path, 100);
    if (ids.has(id) || path !== `regions/${id}.min.json`) throw new Error("Invalid regional path");
    ids.add(id);
    return { id, path, baseVersion: datasetVersion(entry.baseVersion, "base version"), label: localizedText(entry.label, "region label") };
  });
  return { schemaVersion: 1, bundleId: "hc-demo-map-bootstrap", revision: 1, status: "DEMO_NOT_OPERATIONAL", regions };
}

function validateMapRegion(value: unknown, expectedRegionId: string, directory: DirectoryBundle): MapRegion {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.bundleId !== "hc-demo-map-region" || value.revision !== 1 || value.regionId !== expectedRegionId || value.status !== "DEMO_NOT_OPERATIONAL" || value.geometryKind !== "SCHEMATIC_NOT_GEOGRAPHIC") {
    throw new Error("Unsupported map region");
  }
  if (["latitude", "longitude", "coordinates", "features", "geometry", "contact", "validator"].some((field) => field in value)) {
    throw new Error("Geographic or sensitive regional field rejected");
  }
  const version = datasetVersion(value.datasetVersion, "map dataset version");
  const boundary = schematicLine(value.boundary, 3, 16, "boundary");
  if (!Array.isArray(value.roads) || value.roads.length < 1 || value.roads.length > 8) throw new Error("Invalid map roads");
  const roads = value.roads.map((road) => schematicLine(road, 2, 16, "road"));
  if (!Array.isArray(value.districts) || value.districts.length < 1 || value.districts.length > 8) throw new Error("Invalid map districts");
  const districts = value.districts.map((district) => {
    if (!isRecord(district)) throw new Error("Invalid map district");
    return { label: localizedText(district.label, "district label"), anchor: schematicPoint(district.anchor, "district anchor") };
  });
  if (!Array.isArray(value.points) || value.points.length < 1 || value.points.length > 12) throw new Error("Invalid map points");
  const directoryIds = new Set(directory.points.map((point) => point.id));
  const seen = new Set<string>();
  const points = value.points.map((entry) => {
    if (!isRecord(entry)) throw new Error("Invalid map point");
    const directoryId = boundedString(entry.directoryId, 60);
    if (seen.has(directoryId) || !directoryIds.has(directoryId)) throw new Error("Unknown map directory point");
    seen.add(directoryId);
    return { directoryId, position: schematicPoint(entry.position, "map point") };
  });
  return { schemaVersion: 1, bundleId: "hc-demo-map-region", revision: 1, datasetVersion: version, regionId: expectedRegionId, status: "DEMO_NOT_OPERATIONAL", geometryKind: "SCHEMATIC_NOT_GEOGRAPHIC", boundary, roads, districts, points };
}

async function loadMapBootstrap(): Promise<MapBootstrap> {
  if (mapBootstrap) return mapBootstrap;
  mapBootstrapPromise ??= (async () => {
    const document = await fetchSignedDocument("bootstrap.json", 10_000);
    mapBootstrap = validateMapBootstrap(JSON.parse(document.content) as unknown);
    if (mapBootstrap.revision !== document.envelope.sequence) throw new Error("Map bootstrap revision mismatch");
    await commitIntegritySequence("bootstrap.json", document.envelope.sequence);
    return mapBootstrap;
  })();
  try {
    return await mapBootstrapPromise;
  } catch (error) {
    mapBootstrapPromise = undefined;
    throw error;
  }
}

function selectedRegionMetadata(): MapRegionMetadata | undefined {
  return mapBootstrap?.regions.find((region) => region.id === selectedRegionId);
}

async function readMapRegionResponse(response: Response, metadata: MapRegionMetadata): Promise<{ content: string; region: MapRegion }> {
  const document = await readCachedSignedResponse(response, 30_000);
  const directory = await loadDirectoryBundle();
  const region = validateMapRegion(JSON.parse(document.content) as unknown, metadata.id, directory);
  const expectedPath = region.datasetVersion === metadata.baseVersion
    ? metadata.path
    : `regions/${metadata.id}.v${region.datasetVersion}.min.json`;
  if (document.signedPath !== expectedPath || document.envelope.sequence !== region.datasetVersion) throw new Error("Map signature does not match its version");
  const slotKey = `slot:region:${metadata.id}`;
  if (document.envelope.sequence < await minimumIntegritySequence(slotKey)) throw new Error("Map rollback rejected");
  await commitIntegritySequence(document.signedPath, document.envelope.sequence);
  await commitIntegritySequence(slotKey, document.envelope.sequence);
  return { content: document.content, region };
}

function setRegionStatus(installed: boolean, version?: number): void {
  const status = document.querySelector<HTMLElement>("[data-region-status]");
  if (status) {
    const base = message(installed ? "regionInstalled" : "regionNotInstalled");
    status.textContent = installed && version ? `${base} ${message("regionVersion")} ${version}.` : base;
  }
  const install = document.querySelector<HTMLButtonElement>("[data-install-region]");
  const remove = document.querySelector<HTMLButtonElement>("[data-remove-region]");
  const update = document.querySelector<HTMLButtonElement>("[data-update-region]");
  if (install) install.hidden = installed;
  if (remove) remove.hidden = !installed;
  if (update) update.disabled = !installed;
}

function clearMapView(): void {
  const mapSvg = document.querySelector<SVGSVGElement>("[data-map-svg]");
  const mapEmpty = document.querySelector<HTMLElement>("[data-map-empty]");
  mapSvg?.replaceChildren();
  if (mapSvg) setSvgHidden(mapSvg, true);
  if (mapEmpty) mapEmpty.hidden = false;
  setRegionStatus(false);
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K, attributes: Record<string, string>): SVGElementTagNameMap[K] {
  const element = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function updateMapPointVisibility(): void {
  for (const marker of document.querySelectorAll<SVGGElement>("[data-map-point]")) {
    setSvgHidden(marker, activeDirectoryCategory !== "all" && marker.dataset.category !== activeDirectoryCategory);
  }
}

async function renderMapRegion(region: MapRegion): Promise<void> {
  const mapSvg = document.querySelector<SVGSVGElement>("[data-map-svg]");
  const mapEmpty = document.querySelector<HTMLElement>("[data-map-empty]");
  if (!mapSvg) return;
  const directory = await loadDirectoryBundle();
  const boundary = svgElement("polygon", { class: "map-boundary", points: region.boundary.map(([x, y]) => `${x},${y}`).join(" ") });
  const roads = region.roads.map((road, index) => {
    const element = svgElement("polyline", { class: index === 0 ? "map-road map-road--main" : "map-road", points: road.map(([x, y]) => `${x},${y}`).join(" ") });
    if (index > 0) element.dataset.mapDetail = "normal";
    return element;
  });
  const districts = region.districts.map((district) => {
    const [x, y] = district.anchor;
    const label = svgElement("text", { class: "map-district", x: String(x), y: String(y), "text-anchor": "middle" });
    label.dataset.mapDetail = "normal";
    label.textContent = district.label[currentLocale];
    return label;
  });
  const markers = region.points.map((regionalPoint) => {
    const point = directory.points.find((candidate) => candidate.id === regionalPoint.directoryId);
    if (!point) throw new Error("Map point disappeared from directory");
    const [x, y] = regionalPoint.position;
    const group = svgElement("g", { class: "map-point", transform: `translate(${x} ${y})` });
    group.dataset.mapPoint = point.id;
    group.dataset.category = point.category;
    const title = svgElement("title", {});
    title.textContent = `${categoryLabel(point.category)} — ${point.coarse_location[currentLocale]}`;
    const circle = svgElement("circle", { class: `map-point__dot map-point__dot--${point.category}`, cx: "0", cy: "0", r: "3.4" });
    const label = svgElement("text", { class: "map-point__label", x: "4.5", y: "-3" });
    label.dataset.mapDetail = "normal";
    label.textContent = point.coarse_location[currentLocale];
    group.append(title, circle, label);
    return group;
  });
  mapSvg.replaceChildren(boundary, ...roads, ...districts, ...markers);
  setSvgHidden(mapSvg, false);
  if (mapEmpty) mapEmpty.hidden = true;
  setRegionStatus(true, region.datasetVersion);
  updateMapPointVisibility();
  setNetworkMode(currentNetworkMode);
}

async function loadCachedMapRegion(metadata: MapRegionMetadata): Promise<MapRegion | undefined> {
  const existing = mapRegions.get(metadata.id);
  if (existing) return existing;
  if (!("caches" in window)) return undefined;
  const assetUrl = new URL(`./${metadata.path}`, document.baseURI).href;
  const cache = await caches.open(integrityDataCacheName);
  const response = await cache.match(assetUrl);
  if (!response) return undefined;
  try {
    const { region } = await readMapRegionResponse(response, metadata);
    mapRegions.set(metadata.id, region);
    return region;
  } catch {
    await cache.delete(assetUrl);
    return undefined;
  }
}

function populateRegionSelect(bootstrap: MapBootstrap): void {
  const select = document.querySelector<HTMLSelectElement>("[data-region-select]");
  if (!select) return;
  if (!selectedRegionId || !bootstrap.regions.some((region) => region.id === selectedRegionId)) selectedRegionId = bootstrap.regions[0]?.id;
  const options = bootstrap.regions.map((region) => {
    const option = document.createElement("option");
    option.value = region.id;
    option.textContent = region.label[currentLocale];
    option.selected = region.id === selectedRegionId;
    return option;
  });
  select.replaceChildren(...options);
}

async function initializeMap(): Promise<void> {
  try {
    const bootstrap = await loadMapBootstrap();
    populateRegionSelect(bootstrap);
    const metadata = selectedRegionMetadata();
    if (!metadata) return;
    const cached = await loadCachedMapRegion(metadata);
    if (cached) await renderMapRegion(cached);
    else clearMapView();
  } catch {
    showPhaseNotice("regionInstallError");
  }
}

async function installSelectedRegion(): Promise<void> {
  const metadata = selectedRegionMetadata();
  if (!metadata) throw new Error("No region selected");
  const directory = await loadDirectoryBundle();
  const slotKey = `slot:region:${metadata.id}`;
  const minimumSlotSequence = await minimumIntegritySequence(slotKey);
  let document: SignedDocument;
  let region: MapRegion;
  let signedPath = metadata.path;
  if (minimumSlotSequence > metadata.baseVersion) {
    const bootstrap = await loadMapBootstrap();
    const manifestDocument = await fetchSignedJsonDocument("updates/index.json", 20_000);
    const manifest = validateUpdateManifest(manifestDocument.value, bootstrap);
    const manifestVersion = Math.max(...manifest.regions.map((entry) => entry.currentVersion));
    if (manifestDocument.document.envelope.sequence !== manifestVersion) throw new Error("Update manifest sequence mismatch");
    await commitIntegritySequence("updates/index.json", manifestDocument.document.envelope.sequence);
    const updateMetadata = manifest.regions.find((entry) => entry.regionId === metadata.id);
    if (!updateMetadata || updateMetadata.currentVersion < minimumSlotSequence) throw new Error("No non-rollback regional snapshot is available");
    const snapshot = await fetchCurrentSnapshot(updateMetadata, directory);
    document = snapshot.document;
    region = snapshot.region;
    signedPath = updateMetadata.snapshotPath;
  } else {
    document = await fetchSignedDocument(metadata.path, 30_000);
    region = validateMapRegion(JSON.parse(document.content) as unknown, metadata.id, directory);
    if (region.datasetVersion !== metadata.baseVersion || document.envelope.sequence !== region.datasetVersion) throw new Error("Unexpected base region version");
  }
  await storeValidatedAsset("STORE_REGION", `./${metadata.path}`, document.content, document.envelope, signedPath);
  await commitIntegritySequence(signedPath, document.envelope.sequence);
  await commitIntegritySequence(slotKey, document.envelope.sequence);
  mapRegions.set(metadata.id, region);
  await renderMapRegion(region);
  announce(message("regionInstalled"));
}

function validateUpdateManifest(value: unknown, bootstrap: MapBootstrap): UpdateManifest {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.bundleId !== "hc-demo-map-updates" || value.status !== "DEMO_NOT_OPERATIONAL" || !Array.isArray(value.regions) || value.regions.length !== bootstrap.regions.length) {
    throw new Error("Unsupported update manifest");
  }
  const allowedRegionIds = new Set(bootstrap.regions.map((region) => region.id));
  const seen = new Set<string>();
  const regions = value.regions.map((entry): RegionUpdateMetadata => {
    if (!isRecord(entry)) throw new Error("Invalid update region");
    const regionId = boundedString(entry.regionId, 40);
    const currentVersion = datasetVersion(entry.currentVersion, "current update version");
    const snapshotPath = boundedString(entry.snapshotPath, 120);
    if (!allowedRegionIds.has(regionId) || seen.has(regionId) || snapshotPath !== `regions/${regionId}.v${currentVersion}.min.json` || !Array.isArray(entry.deltas) || entry.deltas.length > 12) {
      throw new Error("Invalid update region identity");
    }
    seen.add(regionId);
    const deltas = entry.deltas.map((delta): UpdateTransition => {
      if (!isRecord(delta)) throw new Error("Invalid delta metadata");
      const from = datasetVersion(delta.from, "delta from");
      const to = datasetVersion(delta.to, "delta to");
      const path = boundedString(delta.path, 140);
      if (to !== from + 1 || to > currentVersion || path !== `updates/${regionId}.${from}-${to}.delta.json`) throw new Error("Invalid delta transition");
      return { from, to, path };
    });
    return { regionId, currentVersion, snapshotPath, deltas };
  });
  return { schemaVersion: 1, bundleId: "hc-demo-map-updates", status: "DEMO_NOT_OPERATIONAL", regions };
}

function findDeltaChain(metadata: RegionUpdateMetadata, localVersion: number): readonly UpdateTransition[] | undefined {
  const chain: UpdateTransition[] = [];
  let cursor = localVersion;
  while (cursor < metadata.currentVersion) {
    const transition = metadata.deltas.find((delta) => delta.from === cursor && delta.to === cursor + 1);
    if (!transition) return undefined;
    chain.push(transition);
    cursor = transition.to;
  }
  return chain;
}

function validateMapDelta(value: unknown, regionId: string, from: number, to: number): MapDelta {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.bundleId !== "hc-demo-map-delta" || value.status !== "DEMO_NOT_OPERATIONAL" || value.regionId !== regionId || value.from !== from || value.to !== to || !Array.isArray(value.changes) || value.changes.length < 1 || value.changes.length > 20) {
    throw new Error("Unsupported map delta");
  }
  const changes = value.changes.map((change): MapDeltaChange => {
    if (!isRecord(change)) throw new Error("Invalid delta change");
    if (change.op === "move-point") {
      return { op: "move-point", directoryId: boundedString(change.directoryId, 60), position: schematicPoint(change.position, "delta point") };
    }
    if (change.op === "replace-road") {
      const roadIndex = change.roadIndex;
      if (!Number.isInteger(roadIndex) || (roadIndex as number) < 0 || (roadIndex as number) > 7) throw new Error("Invalid delta road index");
      return { op: "replace-road", roadIndex: roadIndex as number, points: schematicLine(change.points, 2, 16, "delta road") };
    }
    throw new Error("Unsupported delta operation");
  });
  return { schemaVersion: 1, bundleId: "hc-demo-map-delta", status: "DEMO_NOT_OPERATIONAL", regionId, from, to, changes };
}

function applyMapDelta(region: MapRegion, delta: MapDelta): MapRegion {
  if (region.regionId !== delta.regionId || region.datasetVersion !== delta.from) throw new Error("Delta does not follow the local region");
  let points = region.points.map((point) => ({ ...point, position: [...point.position] as SchematicPoint }));
  let roads = region.roads.map((road) => road.map((point) => [...point] as SchematicPoint));
  for (const change of delta.changes) {
    if (change.op === "move-point") {
      if (!points.some((point) => point.directoryId === change.directoryId)) throw new Error("Delta references an unknown point");
      points = points.map((point) => point.directoryId === change.directoryId ? { ...point, position: [...change.position] as SchematicPoint } : point);
    } else {
      if (!roads[change.roadIndex]) throw new Error("Delta references an unknown road");
      roads = roads.map((road, index) => index === change.roadIndex ? change.points.map((point) => [...point] as SchematicPoint) : road);
    }
  }
  return { ...region, datasetVersion: delta.to, points, roads };
}

async function fetchSignedJsonDocument(path: string, maximumLength: number): Promise<{ readonly document: SignedDocument; readonly value: unknown }> {
  const document = await fetchSignedDocument(path, maximumLength);
  return { document, value: JSON.parse(document.content) as unknown };
}

async function fetchCurrentSnapshot(metadata: RegionUpdateMetadata, directory: DirectoryBundle): Promise<{ readonly document: SignedDocument; readonly region: MapRegion }> {
  const result = await fetchSignedJsonDocument(metadata.snapshotPath, 30_000);
  const region = validateMapRegion(result.value, metadata.regionId, directory);
  if (region.datasetVersion !== metadata.currentVersion || result.document.envelope.sequence !== region.datasetVersion) throw new Error("Snapshot version mismatch");
  return { document: result.document, region };
}

async function updateSelectedRegion(): Promise<void> {
  if (regionUpdateInProgress) return;
  const regionMetadata = selectedRegionMetadata();
  const localRegion = regionMetadata ? mapRegions.get(regionMetadata.id) ?? await loadCachedMapRegion(regionMetadata) : undefined;
  if (!regionMetadata || !localRegion) {
    showPhaseNotice("regionInstallError");
    return;
  }
  const button = document.querySelector<HTMLButtonElement>("[data-update-region]");
  regionUpdateInProgress = true;
  if (button) button.disabled = true;
  announce(message("regionUpdating"));
  const directory = await loadDirectoryBundle();
  try {
    const bootstrap = await loadMapBootstrap();
    const manifestDocument = await fetchSignedJsonDocument("updates/index.json", 20_000);
    const manifest = validateUpdateManifest(manifestDocument.value, bootstrap);
    const manifestVersion = Math.max(...manifest.regions.map((entry) => entry.currentVersion));
    if (manifestDocument.document.envelope.sequence !== manifestVersion) throw new Error("Update manifest sequence mismatch");
    await commitIntegritySequence("updates/index.json", manifestDocument.document.envelope.sequence);
    const metadata = manifest.regions.find((entry) => entry.regionId === localRegion.regionId);
    if (!metadata) throw new Error("Region missing from update manifest");
    if (localRegion.datasetVersion >= metadata.currentVersion) {
      setRegionStatus(true, localRegion.datasetVersion);
      showPhaseNotice("regionUpToDate");
      return;
    }

    const chain = findDeltaChain(metadata, localRegion.datasetVersion);
    let nextRegion: MapRegion;
    let nextContent: string;
    let nextEnvelope: SignatureEnvelope;
    let nextSignedPath: string;
    let resultMessage = "regionUpdatedSnapshot";
    if (chain) {
      try {
        nextRegion = localRegion;
        for (const transition of chain) {
          const deltaDocument = await fetchSignedJsonDocument(transition.path, 10_000);
          const delta = validateMapDelta(deltaDocument.value, metadata.regionId, transition.from, transition.to);
          if (deltaDocument.document.envelope.sequence !== transition.to) throw new Error("Delta sequence mismatch");
          await commitIntegritySequence(transition.path, deltaDocument.document.envelope.sequence);
          nextRegion = applyMapDelta(nextRegion, delta);
        }
        nextRegion = validateMapRegion(nextRegion, metadata.regionId, directory);
        if (nextRegion.datasetVersion !== metadata.currentVersion) throw new Error("Incomplete delta chain");
        nextContent = `${JSON.stringify(nextRegion)}\n`;
        nextEnvelope = await fetchSignatureEnvelope(metadata.snapshotPath);
        nextEnvelope = await verifySignedBytes(new TextEncoder().encode(nextContent), metadata.snapshotPath, nextEnvelope);
        if (nextEnvelope.sequence !== nextRegion.datasetVersion) throw new Error("Reconstructed snapshot sequence mismatch");
        nextSignedPath = metadata.snapshotPath;
        resultMessage = "regionUpdatedDelta";
      } catch {
        const snapshot = await fetchCurrentSnapshot(metadata, directory);
        nextRegion = snapshot.region;
        nextContent = snapshot.document.content;
        nextEnvelope = snapshot.document.envelope;
        nextSignedPath = metadata.snapshotPath;
      }
    } else {
      const snapshot = await fetchCurrentSnapshot(metadata, directory);
      nextRegion = snapshot.region;
      nextContent = snapshot.document.content;
      nextEnvelope = snapshot.document.envelope;
      nextSignedPath = metadata.snapshotPath;
    }

    if (nextEnvelope.sequence < await minimumIntegritySequence(`slot:region:${metadata.regionId}`)) throw new Error("Map rollback rejected");
    await storeValidatedAsset("STORE_REGION", `./${regionMetadata.path}`, nextContent, nextEnvelope, nextSignedPath);
    await commitIntegritySequence(nextSignedPath, nextEnvelope.sequence);
    await commitIntegritySequence(`slot:region:${metadata.regionId}`, nextEnvelope.sequence);
    mapRegions.set(nextRegion.regionId, nextRegion);
    await renderMapRegion(nextRegion);
    showPhaseNotice(resultMessage);
  } catch {
    setRegionStatus(true, localRegion.datasetVersion);
    showPhaseNotice("regionUpdateError");
  } finally {
    regionUpdateInProgress = false;
    if (button) button.disabled = false;
  }
}

function validateFirstAidBundle(value: unknown, locale: LocaleName): FirstAidBundle {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.bundleId !== "hc-first-aid-core" || value.revision !== 1 || value.locale !== locale || value.status !== "REVIEW_REQUIRED" || value.expiresAt !== null) {
    throw new Error("Unsupported first-aid bundle");
  }
  const expectedDirection = locale === "ur" ? "rtl" : "ltr";
  if (value.dir !== expectedDirection || !Array.isArray(value.sources) || value.sources.length < 2 || value.sources.length > 10 || !Array.isArray(value.guides) || value.guides.length !== 4) {
    throw new Error("Invalid first-aid bundle structure");
  }

  const sourceIds = new Set<string>();
  const sources = value.sources.map((item): FirstAidSource => {
    if (!isRecord(item)) {
      throw new Error("Invalid source in first-aid bundle");
    }
    const source = {
      id: boundedString(item.id, 80),
      publisher: boundedString(item.publisher, 120),
      title: boundedString(item.title, 240),
      updatedAt: isoDate(item.updatedAt)
    };
    if (sourceIds.has(source.id)) {
      throw new Error("Duplicate first-aid source");
    }
    sourceIds.add(source.id);
    return source;
  });

  const expectedGuideIds = new Set(["severe-bleeding", "burns", "unresponsive-breathing", "unexpected-birth"]);
  const guideIds = new Set<string>();
  const guides = value.guides.map((item): FirstAidGuide => {
    if (!isRecord(item)) {
      throw new Error("Invalid guide in first-aid bundle");
    }
    const guide = {
      id: boundedString(item.id, 60),
      title: boundedString(item.title, 120),
      summary: boundedString(item.summary, 400),
      emergency: boundedString(item.emergency, 500),
      steps: stringList(item.steps, 3, 12, 600),
      avoid: stringList(item.avoid, 1, 12, 600),
      sources: stringList(item.sources, 1, 10, 80)
    };
    if (!expectedGuideIds.has(guide.id) || guideIds.has(guide.id) || guide.sources.some((sourceId) => !sourceIds.has(sourceId))) {
      throw new Error("Invalid first-aid guide identity or source");
    }
    guideIds.add(guide.id);
    return guide;
  });
  if (guideIds.size !== expectedGuideIds.size) {
    throw new Error("Incomplete first-aid guide set");
  }

  return {
    schemaVersion: 1,
    bundleId: "hc-first-aid-core",
    revision: 1,
    locale,
    dir: expectedDirection,
    status: "REVIEW_REQUIRED",
    sourceCheckedAt: isoDate(value.sourceCheckedAt),
    expiresAt: null,
    sources,
    guides
  };
}

function firstAidDataPath(locale: LocaleName): string {
  return `./first-aid/${locale}.json`;
}

function readFirstAidDocument(document: SignedDocument, locale: LocaleName): { bundle: FirstAidBundle; content: string } {
  const bundle = validateFirstAidBundle(JSON.parse(document.content) as unknown, locale);
  if (bundle.revision !== document.envelope.sequence) throw new Error("First-aid revision mismatch");
  return {
    bundle,
    content: document.content
  };
}

async function loadCachedFirstAidBundle(locale: LocaleName): Promise<FirstAidBundle | undefined> {
  if (!("caches" in window)) {
    return undefined;
  }
  if (!await caches.has(firstAidCacheName)) return undefined;
  const assetUrl = new URL(firstAidDataPath(locale), document.baseURI).href;
  const cache = await caches.open(firstAidCacheName);
  const response = await cache.match(assetUrl);
  if (!response) {
    return undefined;
  }
  try {
    const path = firstAidDataPath(locale).replace(/^\.\//, "");
    const document = await readCachedSignedResponse(response, 60_000);
    if (document.signedPath !== path) throw new Error("First-aid signature path mismatch");
    const { bundle } = readFirstAidDocument(document, locale);
    await commitIntegritySequence(path, document.envelope.sequence);
    firstAidBundles.set(locale, bundle);
    return bundle;
  } catch {
    await cache.delete(assetUrl);
    if ((await cache.keys()).length === 0) await caches.delete(firstAidCacheName);
    return undefined;
  }
}

function setFirstAidAvailability(installed: boolean): void {
  const status = document.querySelector<HTMLElement>("[data-first-aid-status]");
  if (status) {
    status.textContent = message(installed ? "firstAidInstalled" : "firstAidNotInstalled");
  }
  for (const availability of document.querySelectorAll<HTMLElement>("[data-guide-id] small")) {
    availability.textContent = installed ? message("firstAidInstalled") : currentMessages["firstAid.pending"] ?? availability.textContent;
  }
  const install = document.querySelector<HTMLButtonElement>("[data-install-first-aid]");
  const remove = document.querySelector<HTMLButtonElement>("[data-remove-first-aid]");
  if (install) install.hidden = installed;
  if (remove) remove.hidden = !installed;
}

async function refreshFirstAidStatus(locale: LocaleName): Promise<void> {
  const bundle = firstAidBundles.get(locale) ?? await loadCachedFirstAidBundle(locale);
  setFirstAidAvailability(Boolean(bundle));
}

async function sendWorkerCommand(payload: Readonly<Record<string, unknown>>): Promise<void> {
  if (panicWipeStarted) throw new Error("Panic wipe active");
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service Worker unavailable");
  }
  const registration = await navigator.serviceWorker.ready;
  if (panicWipeStarted) throw new Error("Panic wipe active");
  if (!registration.active) {
    throw new Error("No active Service Worker");
  }
  const channel = new MessageChannel();
  const result = new Promise<boolean>((resolve) => {
    const timeout = window.setTimeout(() => resolve(false), 10_000);
    channel.port1.addEventListener("message", (event: MessageEvent<unknown>) => {
      window.clearTimeout(timeout);
      resolve(isRecord(event.data) && event.data.ok === true);
    }, { once: true });
    channel.port1.start();
  });
  registration.active.postMessage(payload, [channel.port2]);
  if (!await result) {
    throw new Error("Service Worker rejected cache command");
  }
}

async function storeValidatedAsset(type: "STORE_FIRST_AID" | "STORE_REGION", url: string, content: string, envelope: SignatureEnvelope, signedPath: string): Promise<void> {
  await sendWorkerCommand({ type, url, content, signature: JSON.stringify(envelope), signedPath });
}

async function removeSelectedRegion(): Promise<void> {
  const metadata = selectedRegionMetadata();
  if (!metadata) throw new Error("No region selected");
  await sendWorkerCommand({ type: "REMOVE_REGION", url: `./${metadata.path}` });
  mapRegions.delete(metadata.id);
  clearMapView();
  announce(message("regionRemoved"));
}

async function removeFirstAidBundle(locale: LocaleName): Promise<void> {
  await sendWorkerCommand({ type: "REMOVE_FIRST_AID", url: firstAidDataPath(locale) });
  firstAidBundles.delete(locale);
  if (currentScreen === "first-aid-detail") navigateTo("first-aid", false);
  setFirstAidAvailability(false);
  announce(message("firstAidRemoved"));
}

async function installFirstAidBundle(locale: LocaleName): Promise<void> {
  const path = firstAidDataPath(locale).replace(/^\.\//, "");
  const document = await fetchSignedDocument(path, 60_000);
  const { bundle, content } = readFirstAidDocument(document, locale);
  await storeValidatedAsset("STORE_FIRST_AID", firstAidDataPath(locale), content, document.envelope, path);
  await commitIntegritySequence(path, document.envelope.sequence);
  firstAidBundles.set(locale, bundle);
  setFirstAidAvailability(true);
  announce(message("firstAidInstalled"));
}

function replaceList(list: HTMLElement | null, values: readonly string[]): void {
  if (!list) {
    return;
  }
  list.replaceChildren(...values.map((value) => {
    const item = document.createElement("li");
    item.textContent = value;
    return item;
  }));
}

async function openGuide(guideId: string): Promise<void> {
  const bundle = firstAidBundles.get(currentLocale) ?? await loadCachedFirstAidBundle(currentLocale);
  if (!bundle) {
    showPhaseNotice("firstAidInstallRequired");
    return;
  }
  const guide = bundle.guides.find((candidate) => candidate.id === guideId);
  if (!guide) {
    return;
  }

  const title = document.querySelector<HTMLElement>("[data-guide-title]");
  const summary = document.querySelector<HTMLElement>("[data-guide-summary]");
  const emergency = document.querySelector<HTMLElement>("[data-guide-emergency]");
  const sourceDate = document.querySelector<HTMLTimeElement>("[data-guide-source-date]");
  if (title) title.textContent = guide.title;
  if (summary) summary.textContent = guide.summary;
  if (emergency) emergency.textContent = guide.emergency;
  if (sourceDate) {
    sourceDate.dateTime = bundle.sourceCheckedAt;
    sourceDate.textContent = bundle.sourceCheckedAt;
  }
  replaceList(document.querySelector<HTMLElement>("[data-guide-steps]"), guide.steps);
  replaceList(document.querySelector<HTMLElement>("[data-guide-avoid]"), guide.avoid);
  const sourceLabels = guide.sources.map((sourceId) => {
    const source = bundle.sources.find((candidate) => candidate.id === sourceId);
    return source ? `${source.publisher} — ${source.title} (${source.updatedAt})` : sourceId;
  });
  replaceList(document.querySelector<HTMLElement>("[data-guide-sources]"), sourceLabels);
  navigateTo("first-aid-detail");
}

function openConsent(nextAction: ConsentAction): void {
  if (!consentModal || !consentTitle || !consentDescription || !consentConfirm) {
    return;
  }
  consentAction = nextAction;
  focusBeforeConsent = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const keys = nextAction === "install"
    ? ["firstAidInstallTitle", "firstAidInstallBody", "firstAidConfirmInstall"]
    : nextAction === "export"
      ? ["firstAidExportTitle", "firstAidExportBody", "firstAidConfirmExport"]
      : ["regionInstallTitle", "regionInstallBody", "regionConfirmInstall"];
  consentTitle.textContent = message(keys[0] ?? "");
  consentDescription.textContent = message(keys[1] ?? "");
  consentConfirm.textContent = message(keys[2] ?? "");
  consentModal.hidden = false;
  if (mainContent) mainContent.inert = true;
  if (bottomNavigation) bottomNavigation.inert = true;
  consentConfirm.focus();
}

function closeConsent(): void {
  if (consentModal) consentModal.hidden = true;
  if (mainContent) mainContent.inert = false;
  if (bottomNavigation) bottomNavigation.inert = false;
  consentAction = undefined;
  focusBeforeConsent?.focus();
  focusBeforeConsent = null;
}

function exportFirstAidBundle(locale: LocaleName): void {
  if (panicWipeStarted) return;
  const link = document.createElement("a");
  link.href = `./first-aid/complete-${locale}.html`;
  link.download = `help-connect-first-aid-${locale}.html`;
  link.referrerPolicy = "no-referrer";
  document.body.append(link);
  link.click();
  link.remove();
}

function expectedMessageKeys(): Set<string> {
  const keys = new Set<string>();
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    if (element.dataset.i18n) {
      keys.add(element.dataset.i18n);
    }
  }
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n-placeholder]")) {
    if (element.dataset.i18nPlaceholder) {
      keys.add(element.dataset.i18nPlaceholder);
    }
  }
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n-aria-label]")) {
    if (element.dataset.i18nAriaLabel) {
      keys.add(element.dataset.i18nAriaLabel);
    }
  }
  return keys;
}

function validateMessages(value: unknown): Messages {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid translation document");
  }

  const expectedKeys = expectedMessageKeys();
  const entries = Object.entries(value);
  if (entries.length !== expectedKeys.size) {
    throw new Error("Incomplete translation document");
  }

  const messages: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [key, translation] of entries) {
    if (!expectedKeys.has(key) || typeof translation !== "string" || translation.length === 0 || translation.length > 240) {
      throw new Error(`Invalid translation key: ${key}`);
    }
    messages[key] = translation;
  }
  return messages;
}

function applyMessages(messages: Messages, locale: LocaleName): void {
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const key = element.dataset.i18n;
    if (key && messages[key]) {
      element.textContent = messages[key];
    }
  }
  for (const element of document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]")) {
    const key = element.dataset.i18nPlaceholder;
    if (key && messages[key]) {
      element.placeholder = messages[key];
    }
  }
  for (const element of document.querySelectorAll<HTMLElement>("[data-i18n-aria-label]")) {
    const key = element.dataset.i18nAriaLabel;
    if (key && messages[key]) {
      element.setAttribute("aria-label", messages[key]);
    }
  }

  const metadata = localeMetadata[locale];
  document.documentElement.lang = metadata.lang;
  document.documentElement.dir = metadata.dir;
  currentMessages = messages;
  currentLocale = locale;
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="language"]')) {
    input.checked = input.value === locale;
  }
  writeSession(sessionKeys.locale, locale);
  if (currentScreen === "first-aid-detail") {
    navigateTo("first-aid", false);
  } else {
    void refreshFirstAidStatus(locale);
  }
  void renderDirectory();
  if (mapBootstrap) populateRegionSelect(mapBootstrap);
  const activeRegion = selectedRegionId ? mapRegions.get(selectedRegionId) : undefined;
  if (activeRegion) void renderMapRegion(activeRegion);
  setNetworkMode(currentNetworkMode);
}

async function setLocale(locale: LocaleName): Promise<void> {
  if (locale === currentLocale && Object.keys(currentMessages).length > 0) {
    return;
  }

  try {
    const messages = await runAdaptiveRequest(async (signal) => {
      const response = await fetch(createPublicAssetRequest(`i18n/${locale}.json`, document.baseURI, { signal }));
      if (!response.ok) throw new Error(`Translation request failed: ${response.status}`);
      return validateMessages(await response.json());
    }, networkAdaptation, { parentSignal: appAbortController.signal });
    applyMessages(messages, locale);
  } catch {
    for (const input of document.querySelectorAll<HTMLInputElement>('input[name="language"]')) {
      input.checked = input.value === currentLocale;
    }
    writeSession(sessionKeys.locale, currentLocale);
    announce(message("languageError"));
  }
}

function neutralizeInterface(): void {
  document.title = "";
  document.documentElement.lang = "";
  document.documentElement.dir = "ltr";
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-network-mode");
  document.documentElement.removeAttribute("data-network-mode-source");
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", "#f2f2f2");
  try {
    history.replaceState(null, "", ".");
  } catch {
    // Navigation state replacement is best effort.
  }
  const neutralScreen = document.createElement("main");
  neutralScreen.className = "panic-neutral-screen";
  neutralScreen.setAttribute("aria-label", " ");
  document.body.replaceChildren(neutralScreen);
}

function clearApplicationMemory(): void {
  window.clearTimeout(noticeTimer);
  noticeTimer = undefined;
  recentSearches = [];
  currentMessages = {};
  directoryBundle = undefined;
  directoryPromise = undefined;
  activeSearchQuery = "";
  mapBootstrap = undefined;
  mapBootstrapPromise = undefined;
  trustKeyringPromise = undefined;
  integrityStatePromise = undefined;
  mapRegions.clear();
  selectedRegionId = undefined;
  regionUpdateInProgress = false;
  firstAidBundles.clear();
  consentAction = undefined;
  focusBeforeConsent = null;
  screens.clear();
}

function triggerPanicWipe(): void {
  if (panicWipeStarted) return;
  panicWipeStarted = true;
  stopListeningForPanicWipe();
  void panicWipe({
    root: window,
    neutralize: neutralizeInterface,
    clearMemory: clearApplicationMemory,
    abort: () => appAbortController.abort(),
    knownDatabaseNames: ["hc-public-v1"],
    replaceNavigation: () => window.location.replace("about:blank")
  });
}

const stopListeningForPanicWipe = listenForPanicWipe(triggerPanicWipe, window);

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }
  if (target.closest("[data-panic-wipe]")) {
    triggerPanicWipe();
    return;
  }
  if (panicWipeStarted) return;

  const navigationButton = target.closest<HTMLElement>("[data-navigate]");
  if (navigationButton && isScreenName(navigationButton.dataset.navigate)) {
    navigateTo(navigationButton.dataset.navigate);
    return;
  }
  if (target.closest("[data-back]")) {
    navigateTo(previousPrimaryScreen);
    return;
  }
  if (target.closest("[data-clear-history]")) {
    recentSearches = [];
    renderRecentSearches();
    announce(message("historyCleared"));
    return;
  }
  if (target.closest("[data-update-region]")) {
    void updateSelectedRegion();
    return;
  }
  if (target.closest("[data-install-region]")) {
    openConsent("region");
    return;
  }
  if (target.closest("[data-remove-region]")) {
    void removeSelectedRegion().catch(() => showPhaseNotice("regionRemoveError"));
    return;
  }
  if (target.closest("[data-install-first-aid]")) {
    openConsent("install");
    return;
  }
  if (target.closest("[data-remove-first-aid]")) {
    void removeFirstAidBundle(currentLocale).catch(() => showPhaseNotice("firstAidRemoveError"));
    return;
  }
  if (target.closest("[data-export-first-aid]")) {
    openConsent("export");
    return;
  }
  if (target.closest("[data-consent-cancel]")) {
    closeConsent();
    return;
  }
  if (target.closest("[data-consent-confirm]")) {
    const action = consentAction;
    closeConsent();
    if (action === "install") {
      void installFirstAidBundle(currentLocale).catch(() => showPhaseNotice("firstAidInstallError"));
    } else if (action === "export") {
      exportFirstAidBundle(currentLocale);
    } else if (action === "region") {
      void installSelectedRegion().catch(() => showPhaseNotice("regionInstallError"));
    }
    return;
  }

  const guideButton = target.closest<HTMLButtonElement>("[data-guide-id]");
  if (guideButton?.dataset.guideId) {
    void openGuide(guideButton.dataset.guideId);
    return;
  }

  const recentButton = target.closest<HTMLButtonElement>("[data-recent-query]");
  if (recentButton?.dataset.recentQuery) {
    useQuery(recentButton.dataset.recentQuery);
    return;
  }
  const categoryButton = target.closest<HTMLButtonElement>("[data-directory-category]");
  if (categoryButton && isDirectoryFilterName(categoryButton.dataset.directoryCategory)) {
    setDirectoryCategory(categoryButton.dataset.directoryCategory, Boolean(categoryButton.closest('[data-screen="search"]')));
    return;
  }
  const networkModeButton = target.closest<HTMLButtonElement>("button[data-network-mode]");
  if (networkModeButton && isNetworkModeName(networkModeButton.dataset.networkMode)) {
    networkAdaptation.setManualMode(networkModeButton.dataset.networkMode);
    return;
  }
  const suggestionButton = target.closest<HTMLButtonElement>("[data-suggestion]");
  if (suggestionButton?.textContent) {
    useQuery(suggestionButton.textContent);
    return;
  }
  if (target.closest("[data-future-feature]")) {
    showPhaseNotice();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && consentModal && !consentModal.hidden) {
    closeConsent();
  }
});

for (const form of document.querySelectorAll<HTMLFormElement>("[data-search-form]")) {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = form.querySelector<HTMLInputElement>("[data-search-input]");
    if (input) {
      useQuery(input.value);
    }
  });
}

for (const input of document.querySelectorAll<HTMLInputElement>('input[name="theme"]')) {
  input.addEventListener("change", () => {
    if (isThemeName(input.value)) {
      setTheme(input.value);
    }
  });
}

for (const input of document.querySelectorAll<HTMLInputElement>('input[name="language"]')) {
  input.addEventListener("change", () => {
    if (isLocaleName(input.value)) {
      void setLocale(input.value);
    }
  });
}

document.querySelector<HTMLSelectElement>("[data-region-select]")?.addEventListener("change", (event) => {
  const select = event.currentTarget;
  if (!(select instanceof HTMLSelectElement) || !mapBootstrap?.regions.some((region) => region.id === select.value)) return;
  selectedRegionId = select.value;
  clearMapView();
  const metadata = selectedRegionMetadata();
  if (metadata) {
    void loadCachedMapRegion(metadata).then((region) => {
      if (region) return renderMapRegion(region);
      return undefined;
    });
  }
});

async function registerOfflineShell(): Promise<void> {
  if (!("serviceWorker" in navigator)) {
    announce(message("offlineUnavailable"));
    return;
  }
  try {
    await navigator.serviceWorker.register(offlineWorkerScriptUrl, {
      scope: "./",
      updateViaCache: "none"
    });
    announce(message("offlineReady"));
  } catch {
    announce(message("offlineUnavailable"));
  }
}

const initialTheme = readSession(sessionKeys.theme);
setTheme(isThemeName(initialTheme) ? initialTheme : "light");
const initialLocale = readSession(sessionKeys.locale);
if (isLocaleName(initialLocale) && initialLocale !== "fr") {
  void setLocale(initialLocale);
} else {
  currentLocale = "fr";
  document.documentElement.lang = localeMetadata.fr.lang;
  document.documentElement.dir = localeMetadata.fr.dir;
  for (const input of document.querySelectorAll<HTMLInputElement>('input[name="language"]')) {
    input.checked = input.value === "fr";
  }
}
renderRecentSearches();
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-directory-category]")) {
  button.setAttribute("aria-pressed", String(button.dataset.directoryCategory === "all"));
}
setNetworkMode("normal", "automatic");
navigateTo("home", false);

if (document.readyState === "complete") {
  void registerOfflineShell();
} else {
  window.addEventListener("load", () => {
    void registerOfflineShell();
  }, { once: true });
}
