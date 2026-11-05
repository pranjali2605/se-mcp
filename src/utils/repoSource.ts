import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { resolveRepo } from "./fileScanner.js";

const run = promisify(execFile);

/** Accepts a local path or a public GitHub URL (shallow-cloned into the cache) and returns a local directory. */
export async function resolveSource(input: string): Promise<string> {
  if (!/^https:\/\/github\.com\/[\w.\-]+\/[\w.\-]+(\.git)?\/?$/i.test(input)) return resolveRepo(input);
  const url = input.replace(/\/$/, "").replace(/(\.git)?$/, ".git");
  const dest = path.resolve(process.env.SE_MCP_CACHE_DIR ?? ".cache", "repos", crypto.createHash("sha1").update(url).digest("hex").slice(0, 12));
  if (!(await fs.stat(dest).catch(() => null))) {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await run("git", ["clone", "--depth", "1", url, dest], { timeout: 120_000 });
  }
  return dest;
}
