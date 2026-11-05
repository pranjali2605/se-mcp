import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const sample = path.resolve("samples/student-api");
let client;

test.before(async () => {
  client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["build/index.js"],
      env: { ...process.env, SE_MCP_LOG_DIR: path.resolve(".cache/test-logs"), SE_MCP_CACHE_DIR: path.resolve(".cache/test") },
    }),
  );
});
test.after(async () => client.close());

const call = async (name, args) => {
  const r = await client.callTool({ name, arguments: args });
  return { text: r.content[0].text, isError: !!r.isError };
};

test("TC-01 lists all eight tools", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "analyze_repository", "dependency_risk_scan", "documentation_summary", "explain_code",
    "generate_test_cases", "project_health_report", "search_code", "summarize_issue",
  ]);
});

test("TC-02 analyze_repository returns file map and languages", async () => {
  const r = JSON.parse((await call("analyze_repository", { repo: sample })).text);
  assert.ok(r.languages.some((l) => l.language === "JavaScript"));
  assert.ok(r.keyFiles.includes("README.md"));
  assert.equal(r.testFiles.length, 0);
});

test("TC-04 search_code finds a keyword with line numbers", async () => {
  const r = JSON.parse((await call("search_code", { repo: sample, query: "calculateGrade" })).text);
  assert.ok(r.length >= 2);
  assert.ok(r.every((m) => m.line > 0));
});

test("TC-05 search_code with no match returns empty list", async () => {
  assert.deepEqual(JSON.parse((await call("search_code", { repo: sample, query: "zzzNotThere" })).text), []);
});

test("TC-06 explain_code returns symbols", async () => {
  const r = JSON.parse((await call("explain_code", { repo: sample, file: "src/studentService.js", symbol: "calculateGrade" })).text);
  assert.ok(r.symbols.some((s) => s.name === "add"));
  assert.match(r.excerpt, /return "A"/);
});

test("TC-08 dependency_risk_scan parses manifest offline", async () => {
  const r = JSON.parse((await call("dependency_risk_scan", { repo: sample, offline: true })).text);
  assert.equal(r.dependencies, 3);
});

test("TC-10 generate_test_cases lists boundary and failure cases", async () => {
  const r = JSON.parse((await call("generate_test_cases", { repo: sample, file: "src/studentService.js", symbol: "add" })).text);
  const types = r.targets[0].cases.map((c) => c.type);
  assert.ok(types.includes("failure") && types.includes("boundary"));
});

test("TC-11 documentation_summary flags missing sections", async () => {
  const r = JSON.parse((await call("documentation_summary", { repo: sample })).text);
  assert.equal(r.sections.Contributing, "missing");
});

test("TC-12 project_health_report produces all sections", async () => {
  const { text } = await call("project_health_report", { repo: sample, offline: true });
  for (const s of ["Overview", "Dependencies", "Testing", "Documentation", "Recommendations"]) assert.match(text, new RegExp(`## ${s}`));
  assert.match(text, /No test files detected/);
});

test("TC-13 path traversal is rejected", async () => {
  const r = await call("explain_code", { repo: sample, file: "../../package.json" });
  assert.ok(r.isError);
  assert.match(r.text, /blocked/);
});

test("TC-03 / invalid repo path gives a clear error", async () => {
  const r = await call("analyze_repository", { repo: "C:/does/not/exist" });
  assert.ok(r.isError);
});
