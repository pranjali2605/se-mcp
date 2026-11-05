import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** One id per server process; evaluation runs can also set SE_MCP_TASK_ID to tag calls. */
const SESSION_ID = process.env.SE_MCP_SESSION_ID ?? crypto.randomUUID();

/** Appends one JSON line per tool call so AI outputs can be traced to evidence. */
export async function logCall(tool: string, input: unknown, ok: boolean, ms: number, bytes: number, error?: string): Promise<void> {
  try {
    const dir = path.resolve(process.env.SE_MCP_LOG_DIR ?? "logs");
    await fs.mkdir(dir, { recursive: true });
    const entry = {
      ts: new Date().toISOString(),
      session_id: SESSION_ID,
      task_id: process.env.SE_MCP_TASK_ID ?? null,
      tool,
      input,
      ok,
      ms,
      bytes,
      ...(error ? { error } : {}),
    };
    await fs.appendFile(path.join(dir, "tool-calls.jsonl"), JSON.stringify(entry) + "\n");
  } catch {
    /* logging must never break a tool call */
  }
}
