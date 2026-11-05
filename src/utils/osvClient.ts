import { cached } from "./cache.js";

export interface Dep {
  name: string;
  version: string;
  ecosystem: "npm" | "PyPI" | "Maven";
  dev?: boolean;
}

export interface Vuln {
  id: string;
  summary: string;
  severity?: string;
  fixed?: string;
}

const clean = (v: string) => v.replace(/^[\^~><=\s]+/, "").split(/[\s,]/)[0];

export function parseManifest(file: string, content: string): Dep[] {
  const deps: Dep[] = [];
  if (file.endsWith("package.json")) {
    const j = JSON.parse(content);
    for (const [k, dev] of [["dependencies", false], ["devDependencies", true]] as const)
      for (const [name, v] of Object.entries<string>(j[k] ?? {})) deps.push({ name, version: clean(v), ecosystem: "npm", dev });
  } else if (file.endsWith("requirements.txt")) {
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.split("#")[0].trim();
      const m = line.match(/^([A-Za-z0-9_.\-]+)\s*(?:==|>=|~=)\s*([\w.\-]+)/);
      if (m) deps.push({ name: m[1], version: m[2], ecosystem: "PyPI" });
    }
  } else if (file.endsWith("pom.xml")) {
    const re = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*(?:<version>([^<]+)<\/version>)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) if (m[3] && !m[3].startsWith("$")) deps.push({ name: `${m[1]}:${m[2]}`, version: m[3], ecosystem: "Maven" });
  }
  return deps;
}

export async function queryOsv(deps: Dep[]): Promise<Map<string, Vuln[]>> {
  const out = new Map<string, Vuln[]>();
  if (!deps.length) return out;
  const key = "osv:" + deps.map((d) => `${d.ecosystem}:${d.name}@${d.version}`).join(",");
  const results = await cached(key, async () => {
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queries: deps.map((d) => ({ package: { name: d.name, ecosystem: d.ecosystem }, version: d.version })) }),
    });
    if (!res.ok) throw new Error(`OSV request failed: ${res.status}`);
    const batch = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
    const detailed: Record<string, any> = {};
    const ids = [...new Set(batch.results.flatMap((r) => (r.vulns ?? []).map((v) => v.id)))].slice(0, 40);
    await Promise.all(
      ids.map(async (id) => {
        const r = await fetch(`https://api.osv.dev/v1/vulns/${id}`);
        if (r.ok) detailed[id] = await r.json();
      }),
    );
    return { batch: batch.results, detailed };
  });
  deps.forEach((d, i) => {
    const vulns = (results.batch[i]?.vulns ?? []).map((v: { id: string }): Vuln => {
      const det = results.detailed[v.id];
      const fixed = det?.affected?.flatMap((a: any) => a.ranges ?? []).flatMap((r: any) => r.events ?? []).find((e: any) => e.fixed)?.fixed;
      return { id: v.id, summary: det?.summary ?? "(no summary)", severity: det?.database_specific?.severity, fixed };
    });
    out.set(`${d.name}@${d.version}`, vulns);
  });
  return out;
}
