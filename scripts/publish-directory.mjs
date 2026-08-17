import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { projectDirectory } from "./publication-workflow.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const privatePath = path.join(projectRoot, "operator-portal", "data", "demo-records.json");
const publicPath = path.join(projectRoot, "public", "directory.json");
const privateBundle = JSON.parse(await readFile(privatePath, "utf8"));
const publicBundle = projectDirectory(privateBundle);
await writeFile(publicPath, `${JSON.stringify(publicBundle, null, 2)}\n`, "utf8");
console.log(`Published ${publicBundle.points.length} minimized demo points to ${publicPath}`);
