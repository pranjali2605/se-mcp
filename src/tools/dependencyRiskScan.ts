import { walkFiles, readText, rel } from "../utils/fileScanner.js";
import { parseManifest, queryOsv, Dep, Vuln } from "../utils/osvClient.js";
import path from "node:path";

export interface DependencyReport {
  manifests: string[];
  dependencies: number;
  vulnerable: { name: string; version: string; ecosystem: string; vulns: Vuln[] }[];
  unpinned: string[];
  osvAvailable: boolean;
  error?: string;
}

const MANIFESTS = new Set(["package.json", "requirements.txt", "pom.xml"]);

export async function dependencyRiskScan(root: string, online = true): Promise<DependencyReport> {
  const manifests: string[] = [];
  const deps: Dep[] = [];
  for await (const file of walkFiles(root)) {
    if (!MANIFESTS.has(path.basename(file))) continue;
    const text = await readText(file);
    if (!text) continue;
    manifests.push(rel(root, file));
    try {
      deps.push(...parseManifest(file, text));
    } catch {
      /* malformed manifest is reported as having no dependencies */
    }
  }
  const unpinned: string[] = [];
  for (const m of manifests.filter((m) => m.endsWith("package.json"))) {
    const text = await readText(path.join(root, m));
    const j = text ? JSON.parse(text) : {};
    for (const [n, v] of Object.entries<string>({ ...j.dependencies, ...j.devDependencies })) if (/^(\*|latest|)$/.test(v)) unpinned.push(`${n}@${v || "*"}`);
  }
  const report: DependencyReport = { manifests, dependencies: deps.length, vulnerable: [], unpinned, osvAvailable: false };
  if (!online || !deps.length) return report;
  try {
    const found = await queryOsv(deps);
    report.osvAvailable = true;
    for (const d of deps) {
      const vulns = found.get(`${d.name}@${d.version}`) ?? [];
      if (vulns.length) report.vulnerable.push({ name: d.name, version: d.version, ecosystem: d.ecosystem, vulns });
    }
  } catch (e) {
    report.error = (e as Error).message + " (vulnerability data unavailable; retry later)";
  }
  return report;
}
