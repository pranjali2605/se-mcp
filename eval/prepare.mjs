// Prepares the evaluation: clones public repos, builds ground truth and writes one prompt file per task.
// Usage: node eval/prepare.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walk, isCode, isTest, symbolsOf, dependencyNames } from "./lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, "tasks.json"), "utf8"));
const STOP = new Set("this that with from have when then than into about does doesn should would could which there their being been also just like some more make only very much many such after before using used uses".split(" "));

fs.mkdirSync(path.join(here, "repos"), { recursive: true });
fs.mkdirSync(path.join(here, "ground-truth"), { recursive: true });
fs.mkdirSync(path.join(here, "prompts"), { recursive: true });
fs.mkdirSync(path.join(here, "responses"), { recursive: true });

async function issueTitle(ref) {
  const m = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  const headers = { "User-Agent": "se-mcp-eval", Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = "Bearer " + process.env.GITHUB_TOKEN;
  const r = await fetch(`https://api.github.com/repos/${m[1]}/${m[2]}/issues/${m[3]}`, { headers });
  if (!r.ok) throw new Error(`GitHub ${r.status} for ${ref}`);
  return (await r.json()).title;
}

for (const repo of cfg.repos) {
  let root;
  let commit = null;
  if (repo.path) root = path.resolve(here, repo.path);
  else {
    root = path.join(here, "repos", repo.id);
    if (!fs.existsSync(root)) execFileSync("git", ["clone", "--depth", "1", repo.url, root], { stdio: "inherit" });
    commit = execFileSync("git", ["-C", root, "rev-parse", "HEAD"]).toString().trim();
  }

  const files = walk(root);
  const codeFiles = files.filter(isCode);
  const symbolsByFile = {};
  const identifiers = new Set();
  for (const f of codeFiles) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, f), "utf8");
    } catch {
      continue;
    }
    symbolsByFile[f] = symbolsOf(text);
    for (const w of text.match(/[A-Za-z_][A-Za-z0-9_]{2,}/g) ?? []) identifiers.add(w);
  }
  const symbols = [...new Set(Object.values(symbolsByFile).flat())];
  const testFiles = codeFiles.filter(isTest);
  const topLevel = fs.readdirSync(root, { withFileTypes: true }).filter((e) => !e.name.startsWith(".") && !["node_modules", "build"].includes(e.name)).map((e) => e.name);
  const deps = dependencyNames(root, files);

  // test-generation target: the non-test source file with the most functions (deterministic)
  const candidates = codeFiles
    .filter((f) => !isTest(f) && (symbolsByFile[f]?.length ?? 0) > 0)
    .sort((a, b) => symbolsByFile[b].length - symbolsByFile[a].length || a.localeCompare(b));
  const testFile = candidates[0] ?? null;

  const expected = {
    architecture: topLevel.filter((n) => !/^(package-lock\.json|yarn\.lock)$/.test(n)),
    dependency: deps,
    "test-generation": testFile ? [...new Set(symbolsByFile[testFile])].slice(0, 15) : [],
    "issue-summary": [],
  };
  let issueTitleText = null;
  if (repo.issue) {
    try {
      issueTitleText = await issueTitle(repo.issue);
      expected["issue-summary"] = [...new Set((issueTitleText.toLowerCase().match(/[a-z_][a-z0-9_]{4,}/g) ?? []).filter((w) => !STOP.has(w)))].slice(0, 6);
    } catch (e) {
      console.warn(`  could not fetch issue for ${repo.id}: ${e.message}`);
    }
  }

  const gt = { repo: repo.id, commit, root: repo.path ? repo.path : `repos/${repo.id}`, files, identifiers: [...identifiers], symbols, dependencies: deps, testFiles, topLevel, testFile, issue: repo.issue ?? null, issueTitle: issueTitleText, expected };
  fs.writeFileSync(path.join(here, "ground-truth", `${repo.id}.json`), JSON.stringify(gt, null, 1));

  for (const t of cfg.taskTypes) {
    if (t.id === "test-generation" && !testFile) continue;
    if (t.id === "issue-summary" && !repo.issue) continue;
    const prompt = t.prompt.replace("{{testFile}}", testFile ?? "").replace("{{issue}}", repo.issue ?? "");
    const repoRef = repo.url ?? `local path ${root}`;
    fs.writeFileSync(path.join(here, "prompts", `${repo.id}__${t.id}.md`), `Repository: ${repoRef}\n\n${prompt}\n`);
  }
  console.log(`${repo.id}: ${files.length} files, ${symbols.length} symbols, ${deps.length} deps, test target ${testFile}`);
}
console.log("Prompts written to eval/prompts, ground truth to eval/ground-truth.");
