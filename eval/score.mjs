// Scores saved responses against ground truth and writes eval/results/scores.csv and summary.md.
// Usage: node eval/score.mjs [responsesDir] [outDir]
// Response files: <repo>__<task>__<chat|mcp>.md   Optional: manual-scores.csv (repo,task,mode,rater,accuracy,usefulness,time_s)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const respDir = path.resolve(process.argv[2] ?? path.join(here, "responses"));
const outDir = path.resolve(process.argv[3] ?? path.join(here, "results"));
const gtDir = path.join(here, "ground-truth");

const FILE_RE = /(?<![\w@/.:-])((?:[\w@.-]+\/)*[\w@.-]+\.(?:js|jsx|mjs|cjs|ts|tsx|py|java|json|md|yml|yaml|xml|toml|go|rs|rb|php|cs|c|cpp|h|txt|cfg|ini|gradle))(?![\w/])/g;
const stripUrls = (t) => t.replace(/https?:\/\/\S+/g, " ");

export function scoreResponse(text, gt, task) {
  const clean = stripUrls(text);
  const lower = clean.toLowerCase();
  const files = new Set(gt.files);
  const bases = new Set(gt.files.map((f) => f.split("/").pop()));
  const ids = new Set(gt.identifiers);
  const deps = new Set(gt.dependencies.map((d) => d.toLowerCase()));

  const badFiles = new Set();
  for (const m of clean.matchAll(FILE_RE)) {
    const tok = m[1].replace(/^\.\//, "");
    if (task === "test-generation" && /test|spec/i.test(tok)) continue; // suggested new test files are not references
    const exists = files.has(tok) || [...files].some((f) => f.endsWith("/" + tok)) || (!tok.includes("/") && bases.has(tok));
    if (!exists) badFiles.add(tok);
  }

  const badSymbols = new Set();
  for (const m of clean.matchAll(/`([A-Za-z_][\w.]*)\(/g)) {
    const name = m[1].split(".").pop();
    if (/test/i.test(name) || ids.has(name)) continue;
    badSymbols.add(name);
  }

  const badDeps = new Set();
  if (task === "dependency") {
    for (const m of clean.matchAll(/(?<![\w@/.-])(@?[a-z0-9][\w.-]*(?:\/[\w.-]+)?)@(\d[\w.-]*)/gi)) if (!deps.has(m[1].toLowerCase())) badDeps.add(m[1]);
  }

  const expected = gt.expected[task] ?? [];
  const found = expected.filter((e) => lower.includes(e.toLowerCase()));
  return {
    hallucinations: badFiles.size + badSymbols.size + badDeps.size,
    badFiles: [...badFiles],
    badSymbols: [...badSymbols],
    badDeps: [...badDeps],
    completeness: expected.length ? found.length / expected.length : null,
    expectedCount: expected.length,
    foundCount: found.length,
    words: (clean.match(/\S+/g) ?? []).length,
  };
}

function readCsv(file) {
  if (!fs.existsSync(file)) return [];
  const [head, ...rows] = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const cols = head.split(",").map((c) => c.trim());
  return rows.filter(Boolean).map((r) => Object.fromEntries(r.split(",").map((v, i) => [cols[i], v.trim()])));
}

const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? "n/a" : v.toFixed(d));

export function signTestP(diffs) {
  const d = diffs.filter((x) => x !== 0);
  const n = d.length;
  if (!n) return null;
  const k = Math.min(d.filter((x) => x > 0).length, d.filter((x) => x < 0).length);
  let p = 0;
  let c = 1;
  for (let i = 0; i <= k; i++) {
    p += c;
    c = (c * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * p) / 2 ** n);
}

function main() {
  if (!fs.existsSync(respDir)) {
    console.error(`No responses directory: ${respDir}`);
    process.exit(1);
  }
  const manual = readCsv(path.join(here, "manual-scores.csv"));
  const logFile = path.join(here, "logs", "tool-calls.jsonl");
  const calls = {};
  if (fs.existsSync(logFile))
    for (const l of fs.readFileSync(logFile, "utf8").split(/\r?\n/).filter(Boolean)) {
      try {
        const e = JSON.parse(l);
        if (!e.task_id) continue;
        calls[e.task_id] ??= { n: 0, ms: 0 };
        calls[e.task_id].n++;
        calls[e.task_id].ms += e.ms;
      } catch {
        /* skip bad log line */
      }
    }

  const rows = [];
  for (const f of fs.readdirSync(respDir).filter((f) => f.endsWith(".md")).sort()) {
    const [repo, task, mode] = f.replace(/\.md$/, "").split("__");
    const gtFile = path.join(gtDir, `${repo}.json`);
    if (!mode || !["chat", "mcp"].includes(mode) || !fs.existsSync(gtFile)) {
      console.warn(`skipping ${f} (expected <repo>__<task>__<chat|mcp>.md with ground truth)`);
      continue;
    }
    const gt = JSON.parse(fs.readFileSync(gtFile, "utf8"));
    const s = scoreResponse(fs.readFileSync(path.join(respDir, f), "utf8"), gt, task);
    const m = manual.filter((r) => r.repo === repo && r.task === task && r.mode === mode);
    const num = (k) => mean(m.map((r) => Number(r[k])).filter((v) => !Number.isNaN(v) && r[k] !== ""));
    const tc = calls[`${repo}__${task}`];
    rows.push({ repo, task, mode, ...s, accuracy: num("accuracy"), usefulness: num("usefulness"), time_s: num("time_s"), toolCalls: mode === "mcp" ? tc?.n ?? null : 0 });
  }
  if (!rows.length) {
    console.error("No scorable responses found.");
    process.exit(1);
  }

  fs.mkdirSync(outDir, { recursive: true });
  const cols = ["repo", "task", "mode", "hallucinations", "completeness", "accuracy", "usefulness", "time_s", "toolCalls", "words", "badFiles", "badSymbols", "badDeps"];
  const csv = [cols.join(",")].concat(rows.map((r) => cols.map((c) => (Array.isArray(r[c]) ? `"${r[c].join(" ")}"` : r[c] ?? "")).join(","))).join("\n");
  fs.writeFileSync(path.join(outDir, "scores.csv"), csv + "\n");

  const metrics = [
    ["hallucinations", "Hallucinations (lower is better)"],
    ["completeness", "Completeness (0-1)"],
    ["accuracy", "Accuracy (rater, 0-100)"],
    ["usefulness", "Usefulness (rater, 1-5)"],
    ["time_s", "Time (s)"],
  ];
  const md = ["# Evaluation summary", "", `Responses scored: ${rows.length}`, ""];
  const tasks = [...new Set(rows.map((r) => r.task))];
  md.push("## Mean per task type", "", "| Task | Metric | Normal AI (chat) | MCP-grounded | n pairs |", "|---|---|---|---|---|");
  for (const t of tasks)
    for (const [k, label] of metrics) {
      const c = rows.filter((r) => r.task === t && r.mode === "chat").map((r) => r[k]).filter((v) => v !== null);
      const m = rows.filter((r) => r.task === t && r.mode === "mcp").map((r) => r[k]).filter((v) => v !== null);
      if (c.length || m.length) md.push(`| ${t} | ${label} | ${fmt(mean(c))} | ${fmt(mean(m))} | ${Math.min(c.length, m.length)} |`);
    }

  md.push("", "## Paired comparison over all tasks (MCP minus chat)", "", "| Metric | Mean difference | Pairs | Sign-test p (two-sided) |", "|---|---|---|---|");
  for (const [k, label] of metrics) {
    const diffs = [];
    for (const r of rows.filter((r) => r.mode === "mcp")) {
      const c = rows.find((x) => x.repo === r.repo && x.task === r.task && x.mode === "chat");
      if (c && r[k] !== null && c[k] !== null) diffs.push(r[k] - c[k]);
    }
    if (diffs.length) md.push(`| ${label} | ${fmt(mean(diffs))} | ${diffs.length} | ${fmt(signTestP(diffs), 3)} |`);
  }
  md.push("", "Note: hallucination counts are automatic candidates (file paths, `symbol()` references and name@version tokens not found in the repository); review `badFiles`/`badSymbols` in scores.csv manually before reporting. Accuracy, usefulness and time come from manual-scores.csv.");
  fs.writeFileSync(path.join(outDir, "summary.md"), md.join("\n") + "\n");
  console.log(md.join("\n"));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
