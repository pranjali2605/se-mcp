import { fetchIssue, parseIssueRef, IssueData } from "../utils/githubClient.js";
import { searchCode } from "./searchCode.js";

const STOP = new Set("the a an and or but if is are was were be to of in on for with this that it as at by from not when then than have has had can could should would will does did into out up about error issue bug fix add use using need want please thanks better over coming wire also just like some more make which there their them they what where while been being because other these those same only very much many such currently still should maybe actually really something anything".split(" "));

export function extractKeywords(text: string, limit = 8): string[] {
  const counts = new Map<string, number>();
  const ids = text.match(/`([\w./-]+)`/g)?.map((s) => s.slice(1, -1)) ?? [];
  ids.forEach((w) => counts.set(w, (counts.get(w) ?? 0) + 5));
  for (const w of text.toLowerCase().match(/[a-z_][a-z0-9_]{3,}/g) ?? []) if (!STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

export interface IssueSummary {
  issue: Pick<IssueData, "number" | "title" | "state" | "labels" | "url">;
  bodyExcerpt: string;
  commentCount: number;
  keywords: string[];
  probableCodeAreas: { keyword: string; file: string; line: number }[];
  actionPlan: string[];
}

export async function summarizeIssue(issueRef: string, repoPath?: string): Promise<IssueSummary> {
  const issue = await fetchIssue(parseIssueRef(issueRef));
  const text = [issue.title, issue.body, ...issue.comments.map((c) => c.body)].join("\n");
  const keywords = extractKeywords(text);
  const areas: IssueSummary["probableCodeAreas"] = [];
  if (repoPath) {
    for (const k of keywords) {
      for (const m of await searchCode(repoPath, k, { maxResults: 3 })) areas.push({ keyword: k, file: m.file, line: m.line });
      if (areas.length >= 12) break;
    }
  }
  const files = [...new Set(areas.map((a) => a.file))].slice(0, 3);
  return {
    issue: { number: issue.number, title: issue.title, state: issue.state, labels: issue.labels, url: issue.url },
    bodyExcerpt: issue.body.slice(0, 1200),
    commentCount: issue.comments.length,
    keywords,
    probableCodeAreas: areas,
    actionPlan: [
      "Reproduce the problem using the steps in the issue body.",
      files.length ? `Inspect likely code areas: ${files.join(", ")}.` : "Locate the relevant code using search_code with the keywords above.",
      "Write a failing test that captures the reported behaviour.",
      "Implement the fix, run the test suite and reference the issue in the commit message.",
    ],
  };
}
