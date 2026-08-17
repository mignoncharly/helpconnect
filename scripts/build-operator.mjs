import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const portalRoot = path.join(projectRoot, "operator-portal");
const outputDirectory = path.join(portalRoot, "dist");
if (outputDirectory !== path.resolve(projectRoot, "operator-portal", "dist")) throw new Error("Refusing to clean an unexpected operator output directory");

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  build({
    bundle: true,
    charset: "utf8",
    drop: ["console"],
    entryPoints: [path.join(portalRoot, "src", "app.ts")],
    format: "esm",
    legalComments: "none",
    minify: true,
    outfile: path.join(outputDirectory, "app.js"),
    platform: "browser",
    sourcemap: false,
    target: ["es2020"]
  }),
  build({
    bundle: true,
    entryPoints: [path.join(portalRoot, "src", "styles.css")],
    legalComments: "none",
    minify: true,
    outfile: path.join(outputDirectory, "styles.css"),
    sourcemap: false
  })
]);
const sourceHtml = await readFile(path.join(portalRoot, "src", "index.html"), "utf8");
const html = sourceHtml.replace(/<!--(?!\!)[\s\S]*?-->/g, "").replace(/>\s+</g, "><").trim();
await writeFile(path.join(outputDirectory, "index.html"), `${html}\n`, "utf8");
console.log(`Built isolated operator prototype at ${outputDirectory}`);
