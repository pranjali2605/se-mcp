# SE-MCP Evaluation Harness

Compares **normal AI chat** (no tools) with the **same model connected to SE-MCP** on identical tasks.

## 1. Prepare (once)

```bash
node eval/prepare.mjs
```

Clones the public repositories listed in `tasks.json` into `eval/repos/` (shallow, commit recorded), computes ground truth
independently of the MCP tools (`eval/ground-truth/<repo>.json`) and writes one prompt per task into `eval/prompts/`.

Task types: architecture explanation, dependency risk, test generation, issue summarisation (public repos only).

## 2. Collect responses

For every prompt file `eval/prompts/<repo>__<task>.md`, run it twice with the **same model, same prompt, fresh conversation**:

| Mode | Setup | Save response as |
|------|-------|------------------|
| `chat` | MCP server **disabled**, repository not attached | `eval/responses/<repo>__<task>__chat.md` |
| `mcp`  | SE-MCP enabled; start the server with `SE_MCP_LOG_DIR=eval/logs` and `SE_MCP_TASK_ID=<repo>__<task>` | `eval/responses/<repo>__<task>__mcp.md` |

Set `SE_MCP_TASK_ID` in the client's MCP server `env` block before each task so tool calls are tagged and counted.
Note the time from prompt to final answer for each run.

## 3. Manual scores

Copy `manual-scores.template.csv` to `manual-scores.csv` and fill one row per response and rater:
`accuracy` = % of statements that are correct (0–100), `usefulness` = 1–5, `time_s` = seconds. Use at least two raters
(rows are averaged); report agreement in the paper.

## 4. Score

```bash
node eval/score.mjs
```

Outputs `eval/results/scores.csv` and `eval/results/summary.md` (means per task, paired differences, sign-test p-values).

| Metric | How it is computed |
|--------|--------------------|
| Hallucinations | Automatic candidates: file paths, `symbol()` references and `name@version` tokens that do not exist in the repository. Verify manually. |
| Completeness | Share of ground-truth items (top-level entries, dependency names, functions of the target file, issue keywords) mentioned. |
| Accuracy / usefulness / time | Manual (`manual-scores.csv`). |
| Tool calls | Count of logged MCP calls for the task (`eval/logs/tool-calls.jsonl`). |

Do not report numbers that were not produced by a real run.
