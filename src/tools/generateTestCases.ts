import { explainCode } from "./explainCode.js";
import { readText, resolveInside } from "../utils/fileScanner.js";

export interface TestPlan {
  file: string;
  framework: string;
  targets: {
    name: string;
    line: number;
    params: string[];
    branches: number;
    throws: number;
    cases: { type: "normal" | "boundary" | "failure"; description: string }[];
  }[];
  sampleStructure: string;
}

function pickFramework(file: string): string {
  if (/\.py$/.test(file)) return "pytest";
  if (/\.java$/.test(file)) return "JUnit";
  return "node:test / Jest";
}

export async function generateTestCases(root: string, filePath: string, symbol?: string): Promise<TestPlan> {
  const ev = await explainCode(root, filePath);
  const text = (await readText(resolveInside(root, filePath))) ?? "";
  const lines = text.split(/\r?\n/);
  const syms = ev.symbols.filter((s) => (symbol ? s.name === symbol : s.kind !== "class"));
  if (!syms.length) throw new Error(symbol ? `Symbol '${symbol}' not found` : "No functions found to generate tests for");

  const targets = syms.map((s) => {
    const next = ev.symbols.find((x) => x.line > s.line);
    const body = lines.slice(s.line - 1, next ? next.line - 1 : lines.length);
    const sig = body[0] ?? "";
    const params = (sig.match(/\(([^)]*)\)/)?.[1] ?? "").split(",").map((p) => p.trim().split(/[:=\s]/)[0]).filter(Boolean);
    const joined = body.join("\n");
    const branches = (joined.match(/\b(?:if|elif|switch|case)\b|&&|\|\|/g) ?? []).length;
    const throws = (joined.match(/\b(throw|raise)\b/g) ?? []).length;
    const cases: TestPlan["targets"][number]["cases"] = [{ type: "normal", description: `${s.name} returns the expected result for typical valid input` }];
    for (const p of params) {
      cases.push({ type: "boundary", description: `${s.name} with empty / zero / null value for '${p}'` });
    }
    if (/length|\.size|count|limit|max|min|>=|<=|<|>/.test(joined)) cases.push({ type: "boundary", description: `${s.name} at the exact limit values used in its comparisons` });
    if (throws) cases.push({ type: "failure", description: `${s.name} raises the expected error for invalid input (${throws} throw/raise site(s))` });
    if (branches) cases.push({ type: "normal", description: `cover each of the ${branches} conditional branch(es) in ${s.name}` });
    return { name: s.name, line: s.line, params, branches, throws, cases };
  });

  const fw = pickFramework(filePath);
  const first = targets[0];
  const sample =
    fw === "pytest"
      ? `def test_${first.name}_typical():\n    assert ${first.name}(...) == ...  # fill expected value\n\ndef test_${first.name}_invalid():\n    with pytest.raises(Exception):\n        ${first.name}(...)`
      : `import test from "node:test";\nimport assert from "node:assert/strict";\n\ntest("${first.name} handles typical input", () => {\n  assert.equal(${first.name}(/* args */), /* expected */);\n});\n\ntest("${first.name} rejects invalid input", () => {\n  assert.throws(() => ${first.name}(/* bad args */));\n});`;
  return { file: ev.file, framework: fw, targets, sampleStructure: sample };
}
