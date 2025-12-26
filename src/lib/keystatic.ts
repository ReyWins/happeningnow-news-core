import { createReader } from "@keystatic/core/reader";
import rawConfig from "../../keystatic.config";
import path from "node:path";
import { readdir } from "node:fs/promises";

// Normalize ESM/CJS default interop
const resolvedConfig =
  (rawConfig as unknown as { default?: unknown })?.default ?? rawConfig;

if (
  !resolvedConfig ||
  typeof resolvedConfig !== "object" ||
  !(
    (resolvedConfig as { collections?: unknown }).collections ||
    (resolvedConfig as { singletons?: unknown }).singletons
  )
) {
  throw new Error(
    "Keystatic config is not loaded. Ensure keystatic.config.ts exports a config object."
  );
}

const repoPath = process.cwd();

export function getKeystaticReader() {
  return createReader(repoPath, resolvedConfig as any);
}

export async function listBlogSlugs() {
  const blogDir = path.join(repoPath, "src/content/blog");
  try {
    const entries = await readdir(blogDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith("."));
  } catch (err) {
    return [];
  }
}
