import { walkFiles, readText, rel } from "../utils/fileScanner.js";

export interface Match {
  file: string;
  line: number;
  text: string;
  context: string[];
}

export async function searchCode(root: string, query: string, opts: { extensions?: string[]; maxResults?: number; regex?: boolean } = {}): Promise<Match[]> {
  const max = Math.min(opts.maxResults ?? 50, 200);
  const escaped = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(escaped, "i");
  const out: Match[] = [];
  for await (const file of walkFiles(root, { extensions: opts.extensions })) {
    if (out.length >= max) break;
    const text = await readText(file);
    if (!text) continue;
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length && out.length < max; i++) {
      if (re.test(lines[i])) {
        out.push({ file: rel(root, file), line: i + 1, text: lines[i].trim().slice(0, 240), context: lines.slice(Math.max(0, i - 1), i + 2).map((l) => l.slice(0, 240)) });
      }
    }
  }
  return out;
}
