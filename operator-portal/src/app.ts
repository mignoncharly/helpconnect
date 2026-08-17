import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import type { PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";

type WorkflowState = "DRAFT" | "IN_REVIEW" | "VALIDATED" | "PUBLISHED";
type WorkflowEvent = "SUBMIT_FOR_REVIEW" | "VALIDATE" | "PUBLISH" | "REVALIDATE";

interface OperatorRecord {
  readonly availability_status: "VERIFIED" | "STALE" | "UNAVAILABLE" | "CLOSED";
  readonly category: string;
  readonly id: string;
  readonly region: string;
  readonly workflow_state: WorkflowState;
}

interface OperatorView {
  readonly display_name: string;
  readonly grants: readonly { readonly actions: readonly string[]; readonly categories: readonly string[]; readonly regions: readonly string[] }[];
  readonly id: string;
}

let csrfToken = "";
let records: readonly OperatorRecord[] = [];
let selectedRecordId = "";

function element<T extends Element>(selector: string): T {
  const match = document.querySelector<T>(selector);
  if (!match) throw new Error(`Missing operator UI element: ${selector}`);
  return match;
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  if (csrfToken && options.method === "POST") headers.set("X-CSRF-Token", csrfToken);
  const response = await fetch(path, { ...options, headers, credentials: "same-origin", referrerPolicy: "no-referrer", cache: "no-store" });
  if (!response.ok) throw new Error(response.status === 401 ? "SESSION_EXPIRED" : "REQUEST_REJECTED");
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function showLogin(message = ""): void {
  csrfToken = "";
  records = [];
  selectedRecordId = "";
  element<HTMLElement>("[data-login-view]").hidden = false;
  element<HTMLElement>("[data-workspace]").hidden = true;
  element<HTMLElement>("[data-login-event]").textContent = message;
}

function renderOperator(operator: OperatorView): void {
  element<HTMLElement>("[data-login-view]").hidden = true;
  element<HTMLElement>("[data-workspace]").hidden = false;
  element<HTMLElement>("[data-operator]").textContent = operator.display_name;
  element<HTMLElement>("[data-scope]").textContent = operator.grants.map((grant) => `${grant.regions.join(", ")} · ${grant.categories.join(", ")} · ${grant.actions.join(", ")}`).join(" | ");
}

function selectedRecord(): OperatorRecord | undefined {
  return records.find((record) => record.id === selectedRecordId);
}

function renderRecords(): void {
  const list = element<HTMLElement>("[data-record-list]");
  const buttons = records.map((record) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "record-choice";
    button.dataset.recordId = record.id;
    button.setAttribute("aria-pressed", String(record.id === selectedRecordId));
    button.textContent = `${record.category} · ${record.region}`;
    return button;
  });
  list.replaceChildren(...buttons);
  renderSelectedRecord();
}

function renderSelectedRecord(message = ""): void {
  const record = selectedRecord();
  element<HTMLElement>("[data-record-id]").textContent = record?.id ?? "Aucune fiche";
  element<HTMLElement>("[data-category]").textContent = record?.category ?? "—";
  element<HTMLElement>("[data-region]").textContent = record?.region ?? "—";
  element<HTMLElement>("[data-workflow-state]").textContent = record?.workflow_state ?? "—";
  element<HTMLElement>("[data-availability]").textContent = record?.availability_status ?? "—";
  element<HTMLElement>("[data-event]").textContent = message;
  for (const stage of document.querySelectorAll<HTMLElement>("[data-stage]")) stage.dataset.active = String(stage.dataset.stage === record?.workflow_state);
  const enabledEvent: Partial<Record<WorkflowState, WorkflowEvent>> = { DRAFT: "SUBMIT_FOR_REVIEW", IN_REVIEW: "VALIDATE", VALIDATED: "PUBLISH", PUBLISHED: "REVALIDATE" };
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-action]")) button.disabled = button.dataset.action !== (record ? enabledEvent[record.workflow_state] : undefined);
}

async function loadRecords(): Promise<void> {
  const result = await api<{ records: readonly OperatorRecord[] }>("/v1/records");
  records = result.records;
  selectedRecordId = records.some((record) => record.id === selectedRecordId) ? selectedRecordId : (records[0]?.id ?? "");
  renderRecords();
}

async function login(): Promise<void> {
  const event = element<HTMLElement>("[data-login-event]");
  if (!browserSupportsWebAuthn()) {
    event.textContent = "Ce navigateur ne prend pas en charge les passkeys WebAuthn.";
    return;
  }
  event.textContent = "Vérification de la passkey…";
  try {
    const start = await api<{ flow_id: string; options: PublicKeyCredentialRequestOptionsJSON }>("/v1/auth/options", { method: "POST", body: "{}" });
    const assertion = await startAuthentication({ optionsJSON: start.options });
    const result = await api<{ csrf_token: string; operator: OperatorView }>("/v1/auth/verify", { method: "POST", body: JSON.stringify({ flow_id: start.flow_id, response: assertion }) });
    csrfToken = result.csrf_token;
    renderOperator(result.operator);
    await loadRecords();
  } catch {
    showLogin("Connexion refusée ou annulée. Réessayez avec une passkey active.");
  }
}

async function resume(): Promise<void> {
  try {
    const result = await api<{ csrf_token: string; operator: OperatorView }>("/v1/session");
    csrfToken = result.csrf_token;
    renderOperator(result.operator);
    await loadRecords();
  } catch {
    showLogin();
  }
}

async function transition(event: WorkflowEvent): Promise<void> {
  const record = selectedRecord();
  if (!record) return;
  const context = event === "VALIDATE" ? { status: "VERIFIED", expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() } : {};
  try {
    const result = await api<{ record: OperatorRecord }>(`/v1/records/${record.id}/transition`, { method: "POST", body: JSON.stringify({ event, context }) });
    records = records.map((item) => item.id === result.record.id ? result.record : item);
    renderRecords();
    renderSelectedRecord("Action acceptée et inscrite dans le journal d’audit.");
  } catch (error) {
    if (error instanceof Error && error.message === "SESSION_EXPIRED") return showLogin("Session expirée ou révoquée.");
    renderSelectedRecord("Action refusée par le serveur : scope ou workflow incompatible.");
  }
}

document.addEventListener("click", (event) => {
  const target = event.target as Element;
  if (target.closest("[data-login]")) void login();
  if (target.closest("[data-logout]")) {
    void api<void>("/v1/logout", { method: "POST", body: "{}" })
      .then(() => showLogin("Session terminée."))
      .catch(() => showLogin("Déconnexion non confirmée par le serveur. Fermez cet onglet et contactez un administrateur si nécessaire."));
  }
  const recordButton = target.closest<HTMLButtonElement>("[data-record-id]");
  if (recordButton?.dataset.recordId) {
    selectedRecordId = recordButton.dataset.recordId;
    renderRecords();
  }
  const actionButton = target.closest<HTMLButtonElement>("[data-action]");
  if (actionButton?.dataset.action && !actionButton.disabled) void transition(actionButton.dataset.action as WorkflowEvent);
});

void resume();
