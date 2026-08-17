import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const domain = Buffer.from("HELP_CONNECT_RELEASE_TREE_V1\0", "utf8");

function unsigned64(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(value));
  return buffer;
}

async function listFiles(directory, relative = "") {
  const currentDirectory = relative ? path.join(directory, ...relative.split("/")) : directory;
  const entries = await readdir(currentDirectory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    const relativePath = relative ? `${relative}/${entry.name}` : entry.name;
    const absolutePath = path.join(directory, ...relativePath.split("/"));
    if (entry.isDirectory()) files.push(...await listFiles(directory, relativePath));
    else if (entry.isFile()) files.push({ absolutePath, relativePath });
    else throw new Error(`Unsupported release filesystem entry: ${relativePath}`);
  }
  return files;
}

export async function hashReleaseDirectory(directory) {
  const files = await listFiles(directory);
  if (files.length === 0) throw new Error(`Release directory is empty: ${directory}`);
  const hash = createHash("sha256");
  hash.update(domain);
  hash.update(unsigned64(files.length));
  for (const file of files) {
    const relativePath = Buffer.from(file.relativePath, "utf8");
    const content = await readFile(file.absolutePath);
    hash.update(unsigned64(relativePath.length));
    hash.update(relativePath);
    hash.update(unsigned64(content.length));
    hash.update(content);
  }
  return Object.freeze({ fileCount: files.length, sha256: hash.digest("hex") });
}
