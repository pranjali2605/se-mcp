import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const DIR = path.resolve(process.env.SE_MCP_CACHE_DIR ?? ".cache");
const TTL_MS = 60 * 60 * 1000;

/** Small JSON file cache keyed by request, used for repeatable demos and evaluation. */
export async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const file = path.join(DIR, crypto.createHash("sha1").update(key).digest("hex") + ".json");
  try {
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs < TTL_MS) return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    /* cache miss */
  }
  const value = await load();
  try {
    await fs.mkdir(DIR, { recursive: true });
    await fs.writeFile(file, JSON.stringify(value));
  } catch {
    /* cache is best effort */
  }
  return value;
}
