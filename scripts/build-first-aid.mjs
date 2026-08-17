import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateFirstAidBundle } from "./first-aid-schema.mjs";
import { standaloneFirstAidMetaCsp } from "../shared/security-headers.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function list(items, ordered = false) {
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</${tag}>`;
}

function renderBundle(bundle) {
  const labels = bundle.locale === "fr"
    ? { title: "Fiches de premiers secours", draft: "REVUE CLINIQUE REQUISE", emergency: "Urgence", steps: "Étapes", avoid: "À éviter", sources: "Sources", checked: "Sources consultées le" }
    : bundle.locale === "ur"
      ? { title: "ابتدائی طبی امداد", draft: "طبی جائزہ درکار ہے", emergency: "ہنگامی حالت", steps: "اقدامات", avoid: "یہ نہ کریں", sources: "ذرائع", checked: "ذرائع دیکھنے کی تاریخ" }
      : { title: "First-aid guides", draft: "CLINICAL REVIEW REQUIRED", emergency: "Emergency", steps: "Steps", avoid: "Do not", sources: "Sources", checked: "Sources checked on" };
  const guides = bundle.guides.map((guide) => `<article><h2>${escapeHtml(guide.title)}</h2><p>${escapeHtml(guide.summary)}</p><div class="emergency"><strong>${escapeHtml(labels.emergency)}:</strong> ${escapeHtml(guide.emergency)}</div><h3>${escapeHtml(labels.steps)}</h3>${list(guide.steps, true)}<h3>${escapeHtml(labels.avoid)}</h3>${list(guide.avoid)}<p class="refs">${escapeHtml(labels.sources)}: ${guide.sources.map(escapeHtml).join(", ")}</p></article>`).join("");
  const sources = bundle.sources.map((source) => `<li><strong>${escapeHtml(source.id)}</strong> — ${escapeHtml(source.publisher)}, ${escapeHtml(source.title)} (${escapeHtml(source.updatedAt)})</li>`).join("");
  return `<!doctype html><html lang="${escapeHtml(bundle.locale)}" dir="${escapeHtml(bundle.dir)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="${standaloneFirstAidMetaCsp}"><title>HELP CONNECT — ${escapeHtml(labels.title)}</title><style>:root{font-family:system-ui,sans-serif;line-height:1.5;color:#161714;background:#fff}body{max-width:48rem;margin:auto;padding:1rem}header{border-bottom:2px solid;padding-bottom:1rem}.draft,.emergency{border:2px solid #8b1d20;border-radius:.5rem;padding:.75rem;color:#711518;background:#fff7f7}.draft{font-weight:800}article{padding:1rem 0;border-bottom:1px solid #bbb}h1{font-size:1.6rem}h2{font-size:1.3rem}h3{font-size:1rem}li{margin:.45rem 0}.refs,footer{font-size:.8rem;color:#555}@media print{body{max-width:none}.draft,.emergency{color:#000;background:#fff}}</style></head><body><header><strong>HELP CONNECT</strong><h1>${escapeHtml(labels.title)}</h1><p class="draft">${escapeHtml(labels.draft)} — ${escapeHtml(bundle.status)}</p><p>${escapeHtml(labels.checked)} ${escapeHtml(bundle.sourceCheckedAt)} · ${escapeHtml(bundle.bundleId)} r${bundle.revision}</p></header><main>${guides}<section><h2>${escapeHtml(labels.sources)}</h2><ul>${sources}</ul></section></main><footer><p>HELP CONNECT · ${escapeHtml(bundle.bundleId)} · ${escapeHtml(bundle.locale)} · r${bundle.revision}</p></footer></body></html>`;
}

export async function buildFirstAidExports(projectRoot, outputDirectory, localeNames) {
  await Promise.all(localeNames.map(async (locale) => {
    const sourcePath = path.join(projectRoot, "public", "first-aid", `${locale}.json`);
    const bundle = validateFirstAidBundle(JSON.parse(await readFile(sourcePath, "utf8")), locale);
    await writeFile(path.join(outputDirectory, "first-aid", `complete-${locale}.html`), `${renderBundle(bundle)}\n`, "utf8");
  }));
}
