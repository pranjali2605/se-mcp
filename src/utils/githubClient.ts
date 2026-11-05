import { cached } from "./cache.js";

export interface IssueData {
  number: number;
  title: string;
  state: string;
  labels: string[];
  body: string;
  url: string;
  comments: { author: string; body: string }[];
}

export function parseIssueRef(input: string): { owner: string; repo: string; number: number } {
  const m = input.match(/github\.com\/([^/]+)\/([^/]+)\/(?:issues|pull)\/(\d+)/i) ?? input.match(/^([^/\s]+)\/([^#\s]+)#(\d+)$/);
  if (!m) throw new Error("Issue must be a GitHub issue URL or 'owner/repo#number'");
  return { owner: m[1], repo: m[2], number: Number(m[3]) };
}

async function gh<T>(url: string): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "se-mcp" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(url, { headers });
  if (res.status === 403 || res.status === 429) throw new Error("GitHub rate limit reached; set GITHUB_TOKEN or retry later");
  if (!res.ok) throw new Error(`GitHub request failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export function fetchIssue(ref: { owner: string; repo: string; number: number }): Promise<IssueData> {
  const base = `https://api.github.com/repos/${ref.owner}/${ref.repo}/issues/${ref.number}`;
  return cached(base, async () => {
    const issue = await gh<any>(base);
    const comments = await gh<any[]>(base + "/comments?per_page=20");
    return {
      number: issue.number,
      title: issue.title,
      state: issue.state,
      labels: (issue.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)),
      body: issue.body ?? "",
      url: issue.html_url,
      comments: comments.map((c) => ({ author: c.user?.login ?? "unknown", body: c.body ?? "" })),
    };
  });
}
