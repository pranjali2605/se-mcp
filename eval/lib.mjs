import fs from "node:fs";
import path from "node:path";

export const CODE_EXT = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".java", ".go", ".rs", ".rb", ".php", ".cs", ".c", ".cpp", ".h"]);
const SKIP_DIR = new Set(["node_modules", ".git", "build", "dist", "out", ".cache", "__pycache__", ".venv", "venv", "target", ".idea", ".vscode", "coverage", ".tox"]);
const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "function", "return", "else", "with", "elif", "def", "class", "super"]);

/** Independent file walk (does not use the SE-MCP tools, so ground truth is not circular). */
export function walk(root, rel = "") {
  const out = [];
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(root, r));
    else out.push(r);
  }
  return out;
}

export const isCode = (f) => CODE_EXT.has(path.extname(f).toLowerCase());
export const isTest = (f) => /(^|\/)(tests?|__tests__|spec)(\/|$)|(\.|_)(test|spec)\.\w+$|(^|\/)test_[^/]+$/i.test(f);

export function symbolsOf(text) {
  const names = [];
  for (const line of text.split(/\r?\n/)) {
    const m =
      line.match(/^\s*(?:export\s+)?(?:async\s+)?function\s*\*?\s*(\w+)/) ||
      line.match(/^\s*(?:async\s+)?def\s+(\w+)/) ||
      line.match(/^\s*(?:export\s+)?class\s+(\w+)/) ||
      line.match(/^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?[^=]*\)?\s*=>/) ||
      line.match(/^\s{2,}(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{\s*$/);
    if (m && !KEYWORDS.has(m[1]) && !m[1].startsWith("__")) names.push(m[1]);
  }
  return names;
}

export function dependencyNames(root, files) {
  const names = new Set();
  for (const f of files) {
    const base = path.basename(f);
    let text;
    try {
      text = fs.readFileSync(path.join(root, f), "utf8");
    } catch {
      continue;
    }
    if (base === "package.json") {
      try {
        const j = JSON.parse(text);
        Object.keys({ ...j.dependencies, ...j.devDependencies }).forEach((n) => names.add(n));
      } catch {
        /* ignore malformed manifest */
      }
    } else if (/^requirements[\w.-]*\.txt$/.test(base)) {
      for (const l of text.split(/\r?\n/)) {
        const m = l.split("#")[0].trim().match(/^([A-Za-z0-9_.-]+)\s*(?:\[[^\]]*\])?\s*(?:==|>=|~=)/);
        if (m) names.add(m[1]);
      }
    } else if (base === "pyproject.toml") {
      const block = text.match(/^dependencies\s*=\s*\[([\s\S]*?)\n?\]/m)?.[1] ?? "";
      for (const s of block.matchAll(/["']([^"']+)["']/g)) {
        const m = s[1].match(/^([A-Za-z0-9_.-]+)/);
        if (m) names.add(m[1]);
      }
    }
  }
  return [...names];
}
