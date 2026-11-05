import { resolveInside, readText, rel, languageOf } from "../utils/fileScanner.js";

export interface CodeEvidence {
  file: string;
  language: string;
  lineCount: number;
  imports: string[];
  symbols: { kind: string; name: string; line: number }[];
  exports: string[];
  excerpt: string;
  excerptRange: [number, number];
}

const IMPORT_RE = /^\s*(?:import\s.+?from\s+['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|const\s+.+?=\s*require\(['"]([^'"]+)['"]\)|from\s+([\w.]+)\s+import|import\s+([\w.]+)$|using\s+([\w.]+);|import\s+([\w.]+);)/;
const SYMBOL_RES: [string, RegExp][] = [
  ["class", /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/],
  ["function", /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/],
  ["function", /^\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?\(?[^=]*\)?\s*=>/],
  ["function", /^\s*(?:async\s+)?def\s+(\w+)/],
  ["class", /^\s*class\s+(\w+)/],
  ["method", /^\s*(?:public|private|protected)\s+(?:static\s+)?[\w<>\[\]]+\s+(\w+)\s*\(/],
];

export async function explainCode(root: string, filePath: string, symbol?: string): Promise<CodeEvidence> {
  const abs = resolveInside(root, filePath);
  const text = await readText(abs);
  if (text === null) throw new Error(`Cannot read file (missing, binary or too large): ${filePath}`);
  const lines = text.split(/\r?\n/);
  const imports: string[] = [];
  const symbols: CodeEvidence["symbols"] = [];
  const exports: string[] = [];
  lines.forEach((l, i) => {
    const im = l.match(IMPORT_RE);
    if (im) imports.push(im.slice(1).find(Boolean)!);
    for (const [kind, re] of SYMBOL_RES) {
      const m = l.match(re);
      if (m) {
        symbols.push({ kind, name: m[1], line: i + 1 });
        break;
      }
    }
    if (/^\s*export\s/.test(l) || /module\.exports/.test(l)) exports.push(l.trim().slice(0, 100));
  });

  let start = 0;
  let end = Math.min(lines.length, 120);
  if (symbol) {
    const s = symbols.find((x) => x.name === symbol);
    if (!s) throw new Error(`Symbol '${symbol}' not found in ${filePath}. Found: ${symbols.map((x) => x.name).join(", ") || "none"}`);
    start = s.line - 1;
    const next = symbols.find((x) => x.line > s.line);
    end = Math.min(next ? next.line - 1 : lines.length, start + 120);
  }
  return {
    file: rel(root, abs),
    language: languageOf(abs) ?? "unknown",
    lineCount: lines.length,
    imports: [...new Set(imports)],
    symbols,
    exports,
    excerpt: lines.slice(start, end).join("\n"),
    excerptRange: [start + 1, end],
  };
}
