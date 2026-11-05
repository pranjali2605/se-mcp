import fs from "node:fs/promises";
import path from "node:path";
import { readText, walkFiles, rel } from "../utils/fileScanner.js";

export interface DocSummary {
  readme: string | null;
  docFiles: string[];
  wordCount: number;
  headings: string[];
  sections: Record<string, "present" | "thin" | "missing">;
  gaps: string[];
  todoMarkers: number;
  score: number;
}

const SECTIONS: Record<string, RegExp> = {
  "Description / overview": /(about|overview|description|introduction|what is)/i,
  Installation: /(install|setup|getting started)/i,
  Usage: /(usage|how to use|examples?|quick ?start)/i,
  "API / reference": /(api|reference|endpoints?|routes)/i,
  Testing: /(test)/i,
  Contributing: /(contribut)/i,
  License: /(licen[sc]e)/i,
};

export async function documentationSummary(root: string): Promise<DocSummary> {
  const entries = await fs.readdir(root);
  const readmeName = entries.find((e) => /^readme(\.md|\.txt)?$/i.test(e)) ?? null;
  const docFiles: string[] = [];
  for await (const f of walkFiles(root, { extensions: [".md", ".rst", ".txt"] })) {
    const r = rel(root, f);
    if (/^docs?\//i.test(r) || /(readme|contributing|changelog|api)/i.test(path.basename(r))) docFiles.push(r);
  }
  let text = "";
  for (const f of docFiles) text += "\n" + ((await readText(path.join(root, f))) ?? "");
  const headings = [...text.matchAll(/^#{1,4}\s+(.+)$/gm)].map((m) => m[1].trim());
  const sections: DocSummary["sections"] = {};
  for (const [name, re] of Object.entries(SECTIONS)) {
    const hit = headings.find((h) => re.test(h));
    if (!hit) {
      sections[name] = "missing";
      continue;
    }
    const idx = text.indexOf(hit);
    const after = text.slice(idx + hit.length).split(/^#{1,4}\s/m)[0];
    sections[name] = after.trim().split(/\s+/).length < 15 ? "thin" : "present";
  }
  const gaps = Object.entries(sections).filter(([, v]) => v !== "present").map(([k, v]) => `${k}: ${v}`);
  const score = Math.round((Object.values(sections).filter((v) => v === "present").length / Object.keys(SECTIONS).length) * 100);
  return {
    readme: readmeName,
    docFiles,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    headings: headings.slice(0, 40),
    sections,
    gaps,
    todoMarkers: (text.match(/\b(TODO|TBD|FIXME)\b/g) ?? []).length,
    score,
  };
}
