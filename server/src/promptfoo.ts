/** Import a promptfoo eval YAML into our dataset shape.
 *
 * promptfoo files look like:
 *   tests:
 *     - description: "price · 5D · ..."
 *       vars: { message: "Berapa harga 5D scan?" }
 *       assert:
 *         - type: icontains-any
 *           value: ["107.80", ...]
 *         - type: llm-rubric
 *           value: "Reference correct answer: «...the answer...». PASS only if ..."
 *
 * We map each test → { input: vars.message, expected: «reference», tags, description }.
 * The reference answer lives inside «...» in the llm-rubric assert. */
import { parse as parseYaml } from "yaml";

export interface ImportedCase {
  input: string;
  expected: string;
  tags: string[];
  description?: string;
}

/** Pull the «reference answer» out of a test's assert list (the llm-rubric value). */
function extractReference(asserts: unknown): string {
  if (!Array.isArray(asserts)) return "";
  for (const a of asserts) {
    const value = (a as { type?: string; value?: unknown })?.value;
    if ((a as { type?: string })?.type === "llm-rubric" && typeof value === "string") {
      const start = value.indexOf("«"); // «
      const end = value.indexOf("»", start + 1); // »
      if (start !== -1 && end !== -1) return value.slice(start + 1, end).trim();
      // Fallback: text after "Reference correct answer:" up to ". PASS".
      const m = value.match(/Reference correct answer:\s*([\s\S]*?)(?:\.\s*PASS|$)/i);
      if (m?.[1]) return m[1].trim();
    }
  }
  return "";
}

/** Category tags from a "price · 5D anatomy · <question>" description (drop the question). */
function tagsFromDescription(desc: unknown): string[] {
  if (typeof desc !== "string") return [];
  const parts = desc.split("·").map((s) => s.trim()).filter(Boolean); // ·
  return parts.slice(0, Math.max(0, parts.length - 1)).slice(0, 2);
}

export function parsePromptfoo(yamlText: string): ImportedCase[] {
  const doc = parseYaml(yamlText) as { tests?: unknown };
  const tests = Array.isArray(doc?.tests) ? doc.tests : [];
  const out: ImportedCase[] = [];
  for (const t of tests) {
    const test = t as { vars?: Record<string, unknown>; assert?: unknown; description?: unknown };
    const vars = test?.vars ?? {};
    const input = String(vars.message ?? Object.values(vars)[0] ?? "").trim();
    const expected = extractReference(test?.assert);
    if (!input || !expected) continue; // need both to grade
    out.push({
      input,
      expected,
      tags: tagsFromDescription(test?.description),
      description: typeof test?.description === "string" ? test.description : undefined,
    });
  }
  return out;
}

/** Heuristic: does this text look like a promptfoo YAML (vs a CSV)? */
export function looksLikePromptfoo(text: string): boolean {
  return /(^|\n)\s*tests:\s*(\n|$)/.test(text) || text.includes("llm-rubric");
}
