import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { directoryPointKeys, effectiveDirectoryStatus, validateDirectoryBundle } from "../scripts/directory-schema.mjs";
import { createDraft, projectDirectory, transitionRecord } from "../scripts/publication-workflow.mjs";

const raw = JSON.parse(await readFile(new URL("../public/directory.json", import.meta.url), "utf8"));
const privateRaw = JSON.parse(await readFile(new URL("../operator-portal/data/demo-records.json", import.meta.url), "utf8"));

test("the Phase 7 directory satisfies the minimized public schema", () => {
  const bundle = validateDirectoryBundle(raw);
  assert.equal(bundle.schema_version, 2);
  assert.equal(bundle.points.length, 6);
  for (const point of bundle.points) assert.deepEqual(Object.keys(point).sort(), [...directoryPointKeys].sort());
});

test("the checked-in public artifact is the deterministic private projection", () => {
  assert.deepEqual(raw, projectDirectory(privateRaw));
});

test("private identity, contact and notes never enter the public projection", () => {
  const serialized = JSON.stringify(projectDirectory(privateRaw));
  for (const forbidden of ["created_by", "validator_id", "publisher_id", "humanitarian_contact", "internal_notes", "+000-000-A", "Demo contact A"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});

test("an expired verified point is stale, never available", () => {
  const point = { status: "VERIFIED", expires_at: "2026-08-17T10:00:00Z" };
  assert.equal(effectiveDirectoryStatus(point, new Date("2026-08-17T10:00:00Z")), "STALE");
  assert.equal(effectiveDirectoryStatus(point, new Date("2026-08-17T09:59:59Z")), "VERIFIED");
  assert.equal(raw.points.find((item) => item.id === "demo-clinic-b").status, "STALE");
});

test("the workflow enforces creation, independent validation, publication and revalidation", () => {
  const draft = createDraft({
    id: "workflow-demo",
    category: "water",
    region: "demo-north",
    coarse_location: { fr: "Zone", en: "Zone", ur: "علاقہ" },
    internal_notes: "Fixture"
  }, "creator", "2026-08-17T08:00:00Z");
  const review = transitionRecord(draft, "SUBMIT_FOR_REVIEW", { actor_id: "creator", at: "2026-08-17T08:05:00Z" });
  assert.throws(() => transitionRecord(review, "VALIDATE", { actor_id: "creator", at: "2026-08-17T08:10:00Z", status: "VERIFIED", expires_at: "2026-08-18T08:10:00Z" }));
  const validated = transitionRecord(review, "VALIDATE", { actor_id: "reviewer", at: "2026-08-17T08:10:00Z", status: "VERIFIED", expires_at: "2026-08-18T08:10:00Z" });
  const published = transitionRecord(validated, "PUBLISH", { actor_id: "publisher", at: "2026-08-17T08:15:00Z" });
  const revalidation = transitionRecord(published, "REVALIDATE", { actor_id: "reviewer", at: "2026-08-18T07:00:00Z" });
  assert.equal(published.workflow_state, "PUBLISHED");
  assert.equal(revalidation.workflow_state, "IN_REVIEW");
  assert.equal(revalidation.revision, 2);
});

test("unknown or sensitive public fields are rejected", () => {
  for (const field of ["phone", "validator_id", "internal_notes", "coordinates"]) {
    const candidate = structuredClone(raw);
    candidate.points[0][field] = "forbidden";
    assert.throws(() => validateDirectoryBundle(candidate));
  }
});
