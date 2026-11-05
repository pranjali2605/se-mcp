import { analyzeRepository } from "./analyzeRepository.js";
import { dependencyRiskScan } from "./dependencyRiskScan.js";
import { documentationSummary } from "./documentationSummary.js";
import { searchCode } from "./searchCode.js";

export async function projectHealthReport(root: string, online = true): Promise<string> {
  const [repo, deps, docs, todos] = await Promise.all([
    analyzeRepository(root),
    dependencyRiskScan(root, online),
    documentationSummary(root),
    searchCode(root, "\\b(TODO|FIXME|HACK)\\b", { regex: true, maxResults: 50 }),
  ]);
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  const recs: string[] = [];

  const codeFiles = repo.languages.reduce((n, l) => n + l.files, 0);
  const testRatio = repo.testFiles.length / Math.max(1, codeFiles - repo.testFiles.length);
  if (repo.testFiles.length === 0) {
    weaknesses.push("No test files detected.");
    recs.push("Add unit tests for core modules, starting with business logic.");
  } else if (testRatio < 0.25) {
    weaknesses.push(`Low test coverage signal: ${repo.testFiles.length} test file(s) for ${codeFiles - repo.testFiles.length} source file(s).`);
    recs.push("Increase test coverage for untested modules.");
  } else strengths.push(`${repo.testFiles.length} test file(s) present.`);

  if (deps.vulnerable.length) {
    weaknesses.push(`${deps.vulnerable.length} dependenc${deps.vulnerable.length > 1 ? "ies" : "y"} with known vulnerabilities.`);
    recs.push("Upgrade vulnerable dependencies (see Dependencies section).");
  } else if (deps.osvAvailable) strengths.push("No known vulnerabilities reported by OSV.dev.");
  if (deps.error) weaknesses.push(`Dependency scan incomplete: ${deps.error}`);
  if (deps.unpinned.length) recs.push(`Pin versions for: ${deps.unpinned.join(", ")}.`);
  if (!deps.manifests.length) weaknesses.push("No dependency manifest found.");

  if (docs.score >= 70) strengths.push(`Documentation covers ${docs.score}% of standard sections.`);
  else {
    weaknesses.push(`Documentation completeness is ${docs.score}%.`);
    recs.push(`Improve documentation: ${docs.gaps.slice(0, 3).join("; ")}.`);
  }
  if (todos.length) weaknesses.push(`${todos.length} TODO/FIXME marker(s) in code.`);
  if (repo.keyFiles.some((k) => /license/i.test(k))) strengths.push("License file present.");

  const lines: string[] = [];
  lines.push(`# Project Health Report`, "", `**Root:** \`${repo.root}\``, "");
  lines.push("## Overview", `- Files: ${repo.totalFiles}`, `- Code lines: ${repo.totalCodeLines}`, `- Languages: ${repo.languages.map((l) => `${l.language} (${l.lines})`).join(", ") || "none"}`, "");
  lines.push("## Structure", ...repo.topLevel.map((t) => `- ${t}`), "");
  lines.push("## Dependencies", `- Manifests: ${deps.manifests.join(", ") || "none"}`, `- Dependencies: ${deps.dependencies}`);
  for (const v of deps.vulnerable) lines.push(`- **${v.name}@${v.version}**: ${v.vulns.map((x) => `${x.id}${x.fixed ? ` (fixed in ${x.fixed})` : ""}`).join(", ")}`);
  lines.push("", "## Testing", `- Test files: ${repo.testFiles.length}`, ...repo.testFiles.slice(0, 10).map((t) => `  - ${t}`), "");
  lines.push("## Documentation", `- Completeness: ${docs.score}%`, `- README: ${docs.readme ?? "missing"}`, ...docs.gaps.map((g) => `- Gap: ${g}`), "");
  lines.push("## Issues in Code", ...(todos.length ? todos.slice(0, 10).map((t) => `- ${t.file}:${t.line} ${t.text}`) : ["- No TODO/FIXME markers"]), "");
  lines.push("## Strengths", ...(strengths.length ? strengths.map((s) => `- ${s}`) : ["- (none identified)"]), "");
  lines.push("## Risks and Weaknesses", ...(weaknesses.length ? weaknesses.map((s) => `- ${s}`) : ["- (none identified)"]), "");
  lines.push("## Recommendations", ...(recs.length ? recs.map((s, i) => `${i + 1}. ${s}`) : ["1. Maintain current practices."]));
  return lines.join("\n");
}
