import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { logCall } from "../logging.js";
import { resolveSource } from "../utils/repoSource.js";
import { analyzeRepository } from "./analyzeRepository.js";
import { searchCode } from "./searchCode.js";
import { explainCode } from "./explainCode.js";
import { summarizeIssue } from "./summarizeIssue.js";
import { dependencyRiskScan } from "./dependencyRiskScan.js";
import { generateTestCases } from "./generateTestCases.js";
import { documentationSummary } from "./documentationSummary.js";
import { projectHealthReport } from "./projectHealthReport.js";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

/** Wraps a handler with error handling and tool-call logging. */
function wrap<A>(name: string, fn: (args: A) => Promise<string | object>) {
  return async (args: A): Promise<Result> => {
    const t = Date.now();
    try {
      const out = await fn(args);
      const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
      await logCall(name, args, true, Date.now() - t, text.length);
      return { content: [{ type: "text", text }] };
    } catch (e) {
      const text = `Error: ${(e as Error).message}`;
      await logCall(name, args, false, Date.now() - t, text.length);
      return { content: [{ type: "text", text }], isError: true };
    }
  };
}

const repo = z.string().describe("Local repository path, or a public GitHub URL (https://github.com/owner/repo)");

export function registerAllTools(server: McpServer): void {
  server.registerTool(
    "analyze_repository",
    { description: "Analyze folder structure, languages, key files and tests of a repository.", inputSchema: { repo } },
    wrap("analyze_repository", async ({ repo }: { repo: string }) => analyzeRepository(await resolveSource(repo))),
  );

  server.registerTool(
    "search_code",
    {
      description: "Search source files for a keyword (or regex) and return matching lines with context.",
      inputSchema: {
        repo,
        query: z.string().min(1),
        extensions: z.array(z.string()).optional().describe("File extensions to include, e.g. ['ts','js']"),
        regex: z.boolean().optional(),
        maxResults: z.number().int().min(1).max(200).optional(),
      },
    },
    wrap("search_code", async (a: { repo: string; query: string; extensions?: string[]; regex?: boolean; maxResults?: number }) =>
      searchCode(await resolveSource(a.repo), a.query, a),
    ),
  );

  server.registerTool(
    "explain_code",
    {
      description: "Return verified structural evidence (imports, symbols, exports, excerpt) for a file or function so it can be explained accurately.",
      inputSchema: { repo, file: z.string().describe("File path relative to repo root"), symbol: z.string().optional() },
    },
    wrap("explain_code", async (a: { repo: string; file: string; symbol?: string }) => explainCode(await resolveSource(a.repo), a.file, a.symbol)),
  );

  server.registerTool(
    "summarize_issue",
    {
      description: "Fetch a public GitHub issue and link it to probable code areas in a local repository.",
      inputSchema: { issue: z.string().describe("Issue URL or owner/repo#number"), repo: repo.optional() },
    },
    wrap("summarize_issue", async (a: { issue: string; repo?: string }) => summarizeIssue(a.issue, a.repo ? await resolveSource(a.repo) : undefined)),
  );

  server.registerTool(
    "dependency_risk_scan",
    {
      description: "Parse package.json, requirements.txt and pom.xml and check dependencies against the public OSV.dev vulnerability database.",
      inputSchema: { repo, offline: z.boolean().optional().describe("Skip network lookups") },
    },
    wrap("dependency_risk_scan", async (a: { repo: string; offline?: boolean }) => dependencyRiskScan(await resolveSource(a.repo), !a.offline)),
  );

  server.registerTool(
    "generate_test_cases",
    {
      description: "Generate normal, boundary and failure test ideas plus a sample test structure for a file or function.",
      inputSchema: { repo, file: z.string(), symbol: z.string().optional() },
    },
    wrap("generate_test_cases", async (a: { repo: string; file: string; symbol?: string }) => generateTestCases(await resolveSource(a.repo), a.file, a.symbol)),
  );

  server.registerTool(
    "documentation_summary",
    { description: "Summarize README/docs and detect missing documentation sections.", inputSchema: { repo } },
    wrap("documentation_summary", async ({ repo }: { repo: string }) => documentationSummary(await resolveSource(repo))),
  );

  server.registerTool(
    "project_health_report",
    {
      description: "Generate a combined Markdown health report covering structure, dependencies, tests, documentation and code issues.",
      inputSchema: { repo, offline: z.boolean().optional() },
    },
    wrap("project_health_report", async (a: { repo: string; offline?: boolean }) => projectHealthReport(await resolveSource(a.repo), !a.offline)),
  );
}
