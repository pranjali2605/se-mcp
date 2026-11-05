import fs from "node:fs/promises";
import path from "node:path";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "build", "dist", "out", ".cache", "__pycache__", ".venv", "venv", "target", ".idea", ".vscode", "coverage",
]);

const LANGUAGES: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript",
  ".py": "Python", ".java": "Java", ".cs": "C#", ".go": "Go", ".rs": "Rust", ".rb": "Ruby", ".php": "PHP",
  ".c": "C", ".h": "C", ".cpp": "C++", ".hpp": "C++", ".kt": "Kotlin", ".swift": "Swift",
  ".html": "HTML", ".css": "CSS", ".json": "JSON", ".md": "Markdown", ".yml": "YAML", ".yaml": "YAML", ".sql": "SQL",
};

const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".java", ".cs", ".go", ".rs", ".rb", ".php", ".c", ".h", ".cpp", ".hpp", ".kt", ".swift"]);
const MAX_FILE_BYTES = 1_000_000;

export function languageOf(file: string): string | undefined {
  return LANGUAGES[path.extname(file).toLowerCase()];
}

export function isCodeFile(file: string): boolean {
  return CODE_EXT.has(path.extname(file).toLowerCase());
}

export function isTestFile(file: string): boolean {
  return /(^|[\\/])(tests?|__tests__|spec)([\\/]|$)|\.(test|spec)\.[a-z]+$|(^|[\\/])test_[^\\/]+\.py$/i.test(file);
}

/** Resolves a user-supplied path to an absolute path that must exist. */
export async function resolveRepo(repoPath: string): Promise<string> {
  const abs = path.resolve(repoPath);
  const stat = await fs.stat(abs).catch(() => null);
  if (!stat || !stat.isDirectory()) throw new Error(`Repository path not found or not a directory: ${repoPath}`);
  return abs;
}

/** Resolves a file inside the repository root and blocks traversal outside it. */
export function resolveInside(root: string, target: string): string {
  const abs = path.resolve(root, target);
  const rel = path.relative(root, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Access outside the allowed repository root is blocked");
  }
  return abs;
}

export async function* walkFiles(root: string, opts: { extensions?: string[]; maxFiles?: number } = {}): AsyncGenerator<string> {
  const exts = opts.extensions?.map((e) => (e.startsWith(".") ? e : "." + e).toLowerCase());
  let count = 0;
  const max = opts.maxFiles ?? 5000;
  async function* rec(dir: string): AsyncGenerator<string> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (count >= max) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name)) yield* rec(full);
      } else if (e.isFile()) {
        if (exts && !exts.includes(path.extname(e.name).toLowerCase())) continue;
        count++;
        yield full;
      }
    }
  }
  yield* rec(root);
}

export async function readText(file: string): Promise<string | null> {
  const stat = await fs.stat(file).catch(() => null);
  if (!stat || stat.size > MAX_FILE_BYTES) return null;
  const buf = await fs.readFile(file);
  if (buf.includes(0)) return null;
  return buf.toString("utf8");
}

export const rel = (root: string, file: string) => path.relative(root, file).split(path.sep).join("/");
