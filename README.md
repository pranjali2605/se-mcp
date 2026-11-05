# SE-MCP

An AI-powered **Model Context Protocol (MCP)** server for software engineering. It lets an AI assistant
(Claude Desktop, VS Code Copilot, Cursor, …) retrieve verified project context — repository structure, code,
issues, dependency risks, docs — before answering, instead of guessing.

## Tools

| Tool | Purpose |
|------|---------|
| `analyze_repository` | Folder map, languages, key files, test files |
| `search_code` | Keyword / regex search with line numbers and context |
| `explain_code` | Imports, symbols, exports and excerpt for a file or function |
| `summarize_issue` | Fetch a public GitHub issue and map it to likely code areas |
| `dependency_risk_scan` | Parse `package.json` / `requirements.txt` / `pom.xml` and query OSV.dev |
| `generate_test_cases` | Normal / boundary / failure test ideas + sample test structure |
| `documentation_summary` | README/docs coverage and gaps |
| `project_health_report` | Combined Markdown report |

`repo` accepts a local path or a public `https://github.com/owner/repo` URL (shallow-cloned into `.cache/`).

## Setup

```bash
npm install
npm run build
npm test          # builds and runs integration tests through a real MCP client
```

## Connect a client

```json
{
  "mcpServers": {
    "se-mcp": {
      "command": "node",
      "args": ["C:/Users/320320889/source/se-mcp/build/index.js"],
      "env": { "GITHUB_TOKEN": "<optional>" }
    }
  }
}
```

VS Code: add the same entry under `servers` in `.vscode/mcp.json`.

## Demo

`samples/student-api` is a small Express API with intentional defects (no tests, outdated dependencies,
thin README, a `FIXME`, a function with edge cases). Ask your client:

1. "Analyze `C:/Users/320320889/source/se-mcp/samples/student-api` and explain its architecture."
2. "Find missing test cases for `src/studentService.js`."
3. "Check dependency risks using public vulnerability data."
4. "Generate the project health report."

## Evaluation

Every tool call is logged to `logs/tool-calls.jsonl` (timestamp, tool, input, duration) so answers can be traced
to evidence. Compare normal AI chat vs MCP-grounded answers using the metrics in the project report
(accuracy, hallucination count, completeness, usefulness, time).

## Environment variables

`GITHUB_TOKEN` (optional, higher rate limits) · `SE_MCP_CACHE_DIR` · `SE_MCP_LOG_DIR`

## Design notes

Read-only; paths are confined to the repository root; network failures return clear errors; responses from GitHub
and OSV.dev are cached for repeatable demos.
