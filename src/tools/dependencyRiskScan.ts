import { walkFiles, readText, rel } from "../utils/fileScanner.js";
import { parseManifest, queryOsv, latestVersion, versionGap, Dep, Vuln } from "../utils/osvClient.js";
import path from "node:path";

export interface OutdatedDep {
  name: string;
  ecosystem: string;
  current: string;
  latest: string;
  gap: "major" | "minor" | "patch";
  pinned: boolean;
}

export interface DependencyReport {
  manifests: string[];
  dependencies: number;
  vulnerable: { name: string; version: string; ecosystem: string; vulns: Vuln[] }[];
  outdated: OutdatedDep[];
  unpinned: string[];
  osvAvailable: boolean;
  registryAvailable: boolean;
  error?: string;
  registryError?: string;
}

const MANIFESTS = (name: string) => name === "package.json" || name === "pom.xml" || name === "pyproject.toml" || /^requirements[\w.-]*\.txt$/.test(name);

export async function dependencyRiskScan(root: string, online = true): Promise<DependencyReport> {
  const manifests: string[] = [];
  const deps: Dep[] = [];
  for await (const file of walkFiles(root)) {
    if (!MANIFESTS(path.basename(file))) continue;
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
    let j: any = {};
    try {
      j = text ? JSON.parse(text) : {};
    } catch {
      /* already skipped when parsing the manifest */
    }
    for (const [n, v] of Object.entries<string>({ ...j.dependencies, ...j.devDependencies })) if (/^(\*|latest|)$/.test(v)) unpinned.push(`${n}@${v || "*"}`);
  }
  const report: DependencyReport = { manifests, dependencies: deps.length, vulnerable: [], outdated: [], unpinned, osvAvailable: false, registryAvailable: false };
  const checkable = deps.filter((d) => /\d/.test(d.version));
  if (!online || !checkable.length) return report;

  try {
    const found = await queryOsv(checkable);
    report.osvAvailable = true;
    for (const d of checkable) {
      const vulns = found.get(`${d.name}@${d.version}`) ?? [];
      if (vulns.length) report.vulnerable.push({ name: d.name, version: d.version, ecosystem: d.ecosystem, vulns });
    }
  } catch (e) {
    report.error = (e as Error).message + " (vulnerability data unavailable; retry later)";
  }

  const registryDeps = checkable.filter((d) => d.ecosystem !== "Maven");
  const results = await Promise.allSettled(registryDeps.map((d) => latestVersion(d)));
  results.forEach((r, i) => {
    const d = registryDeps[i];
    if (r.status === "rejected") {
      report.registryError ??= (r.reason as Error).message + " (latest-version data unavailable)";
      return;
    }
    report.registryAvailable = true;
    const gap = r.value ? versionGap(d.version, r.value) : null;
    if (gap && r.value) report.outdated.push({ name: d.name, ecosystem: d.ecosystem, current: d.version, latest: r.value, gap, pinned: !!d.pinned });
  });
  return report;
}
