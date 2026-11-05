import fs from "node:fs/promises";
import path from "node:path";

/** Appends one JSON line per tool call so AI outputs can be traced to evidence. */
export async function logCall(tool: string, input: unknown, ok: boolean, ms: number, bytes: number): Promise<void> {
  try {
    const dir = path.resolve(process.env.SE_MCP_LOG_DIR ?? "logs");
    await fs.mkdir(dir, { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), tool, input, ok, ms, bytes });
    await fs.appendFile(path.join(dir, "tool-calls.jsonl"), line + "\n");
  } catch {
    /* logging must never break a tool call */
  }
}
