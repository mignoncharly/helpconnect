import { readdir } from "node:fs/promises";
import path from "node:path";

export async function listRelativeFiles(rootDirectory, currentDirectory = rootDirectory) {
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(currentDirectory, entry.name);
    if (entry.isDirectory()) {
      return listRelativeFiles(rootDirectory, entryPath);
    }
    if (!entry.isFile()) {
      return [];
    }
    return [path.relative(rootDirectory, entryPath).split(path.sep).join("/")];
  }));
  return nested.flat().sort();
}
