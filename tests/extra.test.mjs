import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

process.env.SE_MCP_CACHE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "semcp-cache-"));
process.env.SE_MCP_LOG_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "semcp-log-"));

const { parseIssueRef } = await import("../build/utils/githubClient.js");
const { extractKeywords } = await import("../build/tools/summarizeIssue.js");
const { parseManifest, versionGap } = await import("../build/utils/osvClient.js");
const { dependencyRiskScan } = await import("../build/tools/dependencyRiskScan.js");
const { logCall } = await import("../build/logging.js");
const { scoreResponse } = await import("../eval/score.mjs");

const sample = path.resolve("samples/student-api");

test("TC-07 issue reference parsing and keyword extraction", () => {
  assert.deepEqual(parseIssueRef("expressjs/cors#422"), { owner: "expressjs", repo: "cors", number: 422 });
  assert.deepEqual(parseIssueRef("https://github.com/psf/requests/issues/7639"), { owner: "psf", repo: "requests", number: 7639 });
  assert.throws(() => parseIssueRef("not an issue"));
  const kw = extractKeywords("Cookie parsing crashes when cookie value contains semicolon; cookie jar fails");
  assert.ok(kw.includes("cookie"));
  assert.ok(!kw.includes("when"));
});

test("manifest parsing: requirements.txt and pyproject.toml", () => {
  const req = parseManifest("requirements.txt", "requests==2.0.0\nflask[async]>=2.1\n# c\n");
  assert.deepEqual(req.map((d) => d.name).sort(), ["flask", "requests"]);
  const py = parseManifest("pyproject.toml", 'dependencies = [\n  "httpx>=0.20",\n  "click==8.0.0",\n]\n');
  assert.deepEqual(py.map((d) => d.name).sort(), ["click", "httpx"]);
});

test("versionGap classifies upgrades", () => {
  assert.equal(versionGap("1.2.3", "2.0.0"), "major");
  assert.equal(versionGap("1.2.3", "1.4.0"), "minor");
  assert.equal(versionGap("1.2.3", "1.2.9"), "patch");
  assert.equal(versionGap("1.2.3", "1.2.3"), null);
});

test("TC-09 network failure degrades gracefully", async () => {
  process.env.SE_MCP_OSV_URL = "http://127.0.0.1:9";
  process.env.SE_MCP_NPM_URL = "http://127.0.0.1:9";
  const r = await dependencyRiskScan(sample, true);
  assert.equal(r.dependencies, 3);
  assert.ok(r.error || r.registryError);
});

test("OSV + registry results via mock servers", async () => {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      if (req.url.endsWith("/querybatch")) {
        const q = JSON.parse(body).queries;
        res.end(JSON.stringify({ results: q.map((x) => (x.package.name === "minimist" ? { vulns: [{ id: "GHSA-test" }] } : {})) }));
      } else if (req.url.includes("/vulns/")) {
        res.end(JSON.stringify({ id: "GHSA-test", summary: "mock vuln", severity: [] }));
      } else {
        res.end(JSON.stringify({ version: "99.0.0" }));
      }
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.SE_MCP_OSV_URL = base + "/v1";
  process.env.SE_MCP_NPM_URL = base;
  process.env.SE_MCP_CACHE_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "semcp-cache2-"));
  try {
    const r = await dependencyRiskScan(sample, true);
    assert.ok(r.outdated.length >= 1);
    assert.ok(JSON.stringify(r).includes("GHSA-test"));
  } finally {
    server.close();
  }
});

test("TC-14 log entries carry session_id", async () => {
  await logCall("unit_test_tool", { a: 1 }, true, 5, 10);
  const dir = process.env.SE_MCP_LOG_DIR;
  const files = await fs.readdir(dir);
  const text = await fs.readFile(path.join(dir, files[0]), "utf8");
  const entry = JSON.parse(text.trim().split("\n").pop());
  assert.ok(entry.session_id);
  assert.equal(entry.tool, "unit_test_tool");
});

test("eval scorer is exported", () => {
  assert.equal(typeof scoreResponse, "function");
});
