import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { validateFirstAidBundle } from "../scripts/first-aid-schema.mjs";

const locales = ["fr", "en", "ur"];
const bundles = new Map();

for (const locale of locales) {
  test(`${locale} first-aid bundle satisfies the strict draft schema`, async () => {
    const source = await readFile(new URL(`../public/first-aid/${locale}.json`, import.meta.url), "utf8");
    assert.ok(Buffer.byteLength(source, "utf8") <= 60_000);
    const bundle = validateFirstAidBundle(JSON.parse(source), locale);
    bundles.set(locale, bundle);
    assert.equal(bundle.status, "REVIEW_REQUIRED");
    assert.equal(bundle.expiresAt, null);
    assert.equal(bundle.guides.length, 4);
  });
}

test("all locales expose the same guide and source identities", async () => {
  const loaded = await Promise.all(locales.map(async (locale) => {
    const source = await readFile(new URL(`../public/first-aid/${locale}.json`, import.meta.url), "utf8");
    return validateFirstAidBundle(JSON.parse(source), locale);
  }));
  const expectedGuides = loaded[0].guides.map((guide) => guide.id);
  const expectedSources = loaded[0].sources.map((source) => source.id);
  for (const bundle of loaded.slice(1)) {
    assert.deepEqual(bundle.guides.map((guide) => guide.id), expectedGuides);
    assert.deepEqual(bundle.sources.map((source) => source.id), expectedSources);
  }
});

test("approved or expiring claims cannot be introduced without a schema change", async () => {
  const source = JSON.parse(await readFile(new URL("../public/first-aid/en.json", import.meta.url), "utf8"));
  source.status = "APPROVED";
  source.expiresAt = "2027-08-17";
  assert.throws(() => validateFirstAidBundle(source, "en"), /REVIEW_REQUIRED/);
});
