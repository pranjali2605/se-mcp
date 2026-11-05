import fs from "node:fs/promises";
import path from "node:path";
import { walkFiles, languageOf, isCodeFile, isTestFile, readText, rel } from "../utils/fileScanner.js";

export interface RepoSummary {
  root: string;
  totalFiles: number;
  totalCodeLines: number;
  languages: { language: string; files: number; lines: number }[];
  keyFiles: string[];
  testFiles: string[];
  topLevel: string[];
  fileMap: string[];
}

const KEY = /^(readme(\.md)?|license(\.md)?|package\.json|requirements\.txt|pom\.xml|build\.gradle|go\.mod|cargo\.toml|dockerfile|tsconfig\.json|\.gitignore|index\.(js|ts)|main\.(py|js|ts|go)|app\.(js|ts|py))$/i;

export async function analyzeRepository(root: string): Promise<RepoSummary> {
  const langs = new Map<string, { files: number; lines: number }>();
  const keyFiles: string[] = [];
  const testFiles: string[] = [];
  const fileMap: string[] = [];
  let totalFiles = 0;
  let totalCodeLines = 0;

  for await (const file of walkFiles(root)) {
    totalFiles++;
    const r = rel(root, file);
    if (fileMap.length < 300) fileMap.push(r);
    if (KEY.test(path.basename(file))) keyFiles.push(r);
    if (isCodeFile(file) && isTestFile(r)) testFiles.push(r);
    const lang = languageOf(file);
    if (lang && lang !== "JSON" && lang !== "Markdown") {
      const text = await readText(file);
      const lines = text ? text.split(/\r?\n/).length : 0;
      const cur = langs.get(lang) ?? { files: 0, lines: 0 };
      cur.files++;
      cur.lines += lines;
      langs.set(lang, cur);
      if (isCodeFile(file)) totalCodeLines += lines;
    }
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  return {
    root,
    totalFiles,
    totalCodeLines,
    languages: [...langs.entries()].map(([language, v]) => ({ language, ...v })).sort((a, b) => b.lines - a.lines),
    keyFiles,
    testFiles,
    topLevel: entries.filter((e) => !e.name.startsWith(".") && e.name !== "node_modules").map((e) => (e.isDirectory() ? e.name + "/" : e.name)),
    fileMap,
  };
}
