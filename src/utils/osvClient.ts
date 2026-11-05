import { cached } from "./cache.js";

export interface Dep {
  name: string;
  version: string;
  ecosystem: "npm" | "PyPI" | "Maven";
  dev?: boolean;
  /** true when the manifest pins an exact version; false when it is a range / lower bound */
  pinned?: boolean;
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
      for (const [name, v] of Object.entries<string>(j[k] ?? {})) deps.push({ name, version: clean(v), ecosystem: "npm", dev, pinned: /^\d/.test(v.trim()) });
  } else if (/requirements[\w.-]*\.txt$/.test(file)) {
    for (const raw of content.split(/\r?\n/)) {
      const line = raw.split("#")[0].trim();
      const m = line.match(/^([A-Za-z0-9_.\-]+)\s*(?:\[[^\]]*\])?\s*(==|>=|~=)\s*([\w.\-]+)/);
      if (m) deps.push({ name: m[1], version: m[3], ecosystem: "PyPI", pinned: m[2] === "==" });
    }
  } else if (file.endsWith("pyproject.toml")) {
    const block = content.match(/^dependencies\s*=\s*\[([\s\S]*?)\n?\]/m)?.[1] ?? "";
    for (const s of block.matchAll(/["']([^"']+)["']/g)) {
      const m = s[1].match(/^([A-Za-z0-9_.\-]+)\s*(?:\[[^\]]*\])?\s*(==|>=|~=)\s*([\w.\-]+)/);
      if (m) deps.push({ name: m[1], version: m[3], ecosystem: "PyPI", pinned: m[2] === "==" });
    }
  } else if (file.endsWith("pom.xml")) {
    const re = /<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>\s*(?:<version>([^<]+)<\/version>)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) if (m[3] && !m[3].startsWith("$")) deps.push({ name: `${m[1]}:${m[2]}`, version: m[3], ecosystem: "Maven", pinned: true });
  }
  return deps;
}

const OSV = () => process.env.SE_MCP_OSV_URL ?? "https://api.osv.dev";
const NPM = () => process.env.SE_MCP_NPM_URL ?? "https://registry.npmjs.org";
const PYPI = () => process.env.SE_MCP_PYPI_URL ?? "https://pypi.org/pypi";

/** Turns low-level fetch errors (TLS interception, offline) into an actionable message. */
export function networkError(e: unknown): Error {
  const cause = (e as { cause?: { code?: string } }).cause?.code;
  const msg = (e as Error).message;
  if (cause && /CERT|SSL/.test(cause)) return new Error(`${msg}: TLS certificate not trusted (${cause}). Set NODE_EXTRA_CA_CERTS to your CA bundle or run node with --use-system-ca.`);
  return new Error(cause ? `${msg} (${cause})` : msg);
}

const parts = (v: string) => (v.match(/\d+/g) ?? []).slice(0, 3).map(Number);

/** Returns how far `current` is behind `latest`, or null when it is up to date or not comparable. */
export function versionGap(current: string, latest: string): "major" | "minor" | "patch" | null {
  const c = parts(current);
  const l = parts(latest);
  if (!c.length || !l.length) return null;
  for (let i = 0; i < 3; i++) {
    const a = c[i] ?? 0;
    const b = l[i] ?? 0;
    if (a === b) continue;
    return a > b ? null : (["major", "minor", "patch"] as const)[i];
  }
  return null;
}

export async function latestVersion(dep: Dep): Promise<string | null> {
  if (dep.ecosystem === "Maven") return null;
  return cached(`latest:${dep.ecosystem}:${dep.name}`, async () => {
    const url = dep.ecosystem === "npm" ? `${NPM()}/${encodeURIComponent(dep.name).replace("%40", "@")}/latest` : `${PYPI()}/${dep.name}/json`;
    let res: Response;
    try {
      res = await fetch(url);
    } catch (e) {
      throw networkError(e);
    }
    if (!res.ok) throw new Error(`Registry request failed: ${res.status}`);
    const j = (await res.json()) as any;
    return (dep.ecosystem === "npm" ? j.version : j.info?.version) ?? null;
  });
}

export async function queryOsv(deps: Dep[]): Promise<Map<string, Vuln[]>> {
  const out = new Map<string, Vuln[]>();
  if (!deps.length) return out;
  const key = "osv:" + deps.map((d) => `${d.ecosystem}:${d.name}@${d.version}`).join(",");
  const results = await cached(key, async () => {
    let res: Response;
    try {
      res = await fetch(`${OSV()}/v1/querybatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries: deps.map((d) => ({ package: { name: d.name, ecosystem: d.ecosystem }, version: d.version })) }),
      });
    } catch (e) {
      throw networkError(e);
    }
    if (!res.ok) throw new Error(`OSV request failed: ${res.status}`);
    const batch = (await res.json()) as { results: { vulns?: { id: string }[] }[] };
    const detailed: Record<string, any> = {};
    const ids = [...new Set(batch.results.flatMap((r) => (r.vulns ?? []).map((v) => v.id)))].slice(0, 40);
    await Promise.all(
      ids.map(async (id) => {
        const r = await fetch(`${OSV()}/v1/vulns/${id}`).catch(() => null);
        if (r?.ok) detailed[id] = await r.json();
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
