import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const locales = ["fr", "en", "ur"];
const html = await readFile(new URL("../src/index.html", import.meta.url), "utf8");
const expectedKeys = [...html.matchAll(/data-i18n(?:-placeholder|-aria-label)?="([^"]+)"/g)]
  .map((match) => match[1])
  .filter((key, index, keys) => keys.indexOf(key) === index)
  .sort();

for (const locale of locales) {
  test(`${locale} contains exactly the UI message contract`, async () => {
    const messages = JSON.parse(await readFile(new URL(`../public/i18n/${locale}.json`, import.meta.url), "utf8"));
    assert.deepEqual(Object.keys(messages).sort(), expectedKeys);
    for (const value of Object.values(messages)) {
      assert.equal(typeof value, "string");
      assert.ok(value.length > 0 && value.length <= 240);
    }
  });
}

test("the HTML fallback is complete and French", () => {
  assert.match(html, /<html lang="fr" dir="ltr">/);
  for (const key of expectedKeys) {
    assert.match(html, new RegExp(`data-i18n(?:-placeholder|-aria-label)?="${key.replace(".", "\\.")}"`));
  }
});
