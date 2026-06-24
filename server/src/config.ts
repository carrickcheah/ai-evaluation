/** Load and validate project configs (eval.config.yaml + dataset.json). */
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";
import type { ProjectConfig, TestCase, TargetConfig, JudgeConfig } from "./types";

/** projects/ dir lives at repo root, one level above server/. Overridable for tests. */
export const PROJECTS_DIR =
  process.env.PROJECTS_DIR || resolve(import.meta.dir, "../../projects");

/** Recursively replace ${VAR} in string values with process.env values (fail loud). */
function resolveEnvVars(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{(\w+)\}/g, (_, name: string) => {
      const v = process.env[name];
      if (v === undefined || v === "") {
        throw new Error(`Project config references missing/empty env var: ${name}`);
      }
      return v;
    });
  }
  if (Array.isArray(value)) return value.map(resolveEnvVars);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveEnvVars(v);
    return out;
  }
  return value;
}

/** List project names = subdirs of projects/ that contain an eval.config.yaml. */
export function listProjects(): string[] {
  if (!existsSync(PROJECTS_DIR)) return [];
  return readdirSync(PROJECTS_DIR)
    .filter((name) => {
      const dir = join(PROJECTS_DIR, name);
      const st = statSync(dir, { throwIfNoEntry: false }); // tolerate races/removed entries
      return !!st && st.isDirectory() && existsSync(join(dir, "eval.config.yaml"));
    })
    .sort();
}

function assertString(v: unknown, field: string): string {
  if (typeof v !== "string" || v.trim() === "") {
    throw new Error(`Project config: "${field}" must be a non-empty string`);
  }
  return v;
}

/** Load a project by name; throws with a clear message on any problem. */
export function loadProject(name: string): ProjectConfig {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    throw new Error(`Invalid project name: ${JSON.stringify(name)}`);
  }
  const dir = join(PROJECTS_DIR, name);
  const configPath = join(dir, "eval.config.yaml");
  if (!existsSync(configPath)) {
    throw new Error(`No eval.config.yaml found for project "${name}" (looked in ${dir})`);
  }

  const parsed = resolveEnvVars(parseYaml(readFileSync(configPath, "utf8"))) as Record<
    string,
    unknown
  >;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Project "${name}": eval.config.yaml is empty or not an object`);
  }

  // target is OPTIONAL: dataset-only projects (uploaded datasets) have no bot
  // endpoint and only run in Prompt mode / Models comparison. Validate it only
  // when present; Bot mode raises a clear error later if it's missing.
  const targetRaw = parsed.target as Record<string, unknown> | undefined;
  let target: TargetConfig | undefined;
  if (targetRaw) {
    if (targetRaw.method !== undefined && typeof targetRaw.method !== "string") {
      throw new Error(`Project "${name}": target.method must be a string`);
    }
    if (
      targetRaw.headers !== undefined &&
      (typeof targetRaw.headers !== "object" ||
        targetRaw.headers === null ||
        Array.isArray(targetRaw.headers))
    ) {
      throw new Error(`Project "${name}": target.headers must be an object`);
    }
    target = {
      url: assertString(targetRaw.url, "target.url"),
      method: typeof targetRaw.method === "string" ? targetRaw.method : "POST",
      headers: (targetRaw.headers as Record<string, string>) ?? {},
      body: targetRaw.body,
      answerPath: assertString(targetRaw.answerPath, "target.answerPath"),
    };
  }

  const judgeRaw = (parsed.judge as Record<string, unknown>) ?? {};
  const judge: JudgeConfig = {
    provider: typeof judgeRaw.provider === "string" ? judgeRaw.provider : "claude-subscription",
    model: typeof judgeRaw.model === "string" ? judgeRaw.model : "sonnet",
  };
  if (judge.provider !== "claude-subscription") {
    throw new Error(
      `Project "${name}": judge.provider must be "claude-subscription" (got "${judge.provider}")`,
    );
  }

  const rubric = assertString(parsed.rubric, "rubric");

  const datasetRel = typeof parsed.dataset === "string" ? parsed.dataset : "./dataset.json";
  const datasetPath = isAbsolute(datasetRel) ? datasetRel : resolve(dir, datasetRel);
  if (!existsSync(datasetPath)) {
    throw new Error(`Project "${name}": dataset not found at ${datasetPath}`);
  }
  let dataset: TestCase[];
  try {
    dataset = JSON.parse(readFileSync(datasetPath, "utf8")) as TestCase[];
  } catch (err) {
    throw new Error(`Project "${name}": dataset.json is not valid JSON — ${String(err)}`);
  }
  if (!Array.isArray(dataset) || dataset.length === 0) {
    throw new Error(`Project "${name}": dataset must be a non-empty JSON array`);
  }
  const seenInputs = new Set<string>();
  dataset.forEach((c, i) => {
    if (
      typeof c?.input !== "string" ||
      c.input.trim() === "" ||
      typeof c?.expected !== "string" ||
      c.expected.trim() === ""
    ) {
      throw new Error(`Project "${name}": dataset[${i}] needs non-empty "input" and "expected"`);
    }
    if (
      c.tags !== undefined &&
      (!Array.isArray(c.tags) || c.tags.some((t) => typeof t !== "string"))
    ) {
      throw new Error(`Project "${name}": dataset[${i}].tags must be an array of strings`);
    }
    if (c.description !== undefined && typeof c.description !== "string") {
      throw new Error(`Project "${name}": dataset[${i}].description must be a string`);
    }
    if (seenInputs.has(c.input)) {
      // duplicate inputs collide on the bot's per-question session id → drop the dup
      throw new Error(`Project "${name}": duplicate dataset input at [${i}]: ${c.input.slice(0, 40)}`);
    }
    seenInputs.add(c.input);
  });

  return {
    name: typeof parsed.name === "string" ? parsed.name : name,
    target,
    judge,
    rubric,
    datasetPath,
    dataset,
  };
}

/** Append cases to a project's dataset.json, skipping blanks and inputs that
 * already exist (the no-duplicate-inputs invariant the loader enforces).
 * Returns how many were added/skipped and the new total. */
export function appendCases(
  name: string,
  cases: Array<{ input?: string; expected?: string; tags?: string[]; description?: string }>,
): { added: number; skipped: number; total: number } {
  const project = loadProject(name); // validates the existing dataset + gives datasetPath
  const seen = new Set(project.dataset.map((c) => c.input));
  const merged: TestCase[] = [...project.dataset];
  let added = 0;
  let skipped = 0;

  for (const c of cases) {
    const input = (c.input ?? "").trim();
    const expected = (c.expected ?? "").trim();
    if (!input || !expected || seen.has(input)) {
      skipped++;
      continue;
    }
    seen.add(input);
    const row: TestCase = { input, expected };
    if (c.tags && c.tags.length) row.tags = c.tags;
    if (c.description) row.description = c.description;
    merged.push(row);
    added++;
  }

  if (added > 0) {
    writeFileSync(project.datasetPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
  }
  return { added, skipped, total: merged.length };
}

/** Default grading rubric for an uploaded dataset (no bot, Prompt-mode only).
 * Editable afterwards in the dataset's eval.config.yaml. */
const DEFAULT_RUBRIC = `You grade an assistant's answer against a correct reference answer.
PASS only if the answer is factually consistent with the reference and actually
addresses the question. Minor wording or formatting differences are fine; a FAIL is
a contradiction, a missing required fact, or an invented detail not in the reference.`;

/** Turn a human dataset name into a safe folder slug (matches loadProject's rule). */
function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/** Create a brand-new dataset-only project: writes eval.config.yaml (no target,
 * judge=Claude sonnet, default rubric) + dataset.json. Used by the Upload page so
 * a fresh dataset shows up in the dropdown, ready for Prompt mode / Models. */
export function createProject(
  displayName: string,
  cases: Array<{ input?: string; expected?: string; tags?: string[]; description?: string }>,
  rubric?: string,
): { name: string; displayName: string; total: number } {
  const name = (displayName ?? "").trim();
  if (!name) throw new Error("Dataset name is required");
  const slug = slugify(name);
  if (!slug || !/^[A-Za-z0-9._-]+$/.test(slug)) {
    throw new Error("Dataset name must contain at least one letter or number");
  }
  const dir = join(PROJECTS_DIR, slug);
  if (existsSync(dir)) {
    throw new Error(`A dataset named "${slug}" already exists — pick a different name`);
  }

  // Same invariants loadProject enforces: non-empty input+expected, no dup inputs.
  const seen = new Set<string>();
  const rows: TestCase[] = [];
  for (const c of cases) {
    const input = (c.input ?? "").trim();
    const expected = (c.expected ?? "").trim();
    if (!input || !expected || seen.has(input)) continue;
    seen.add(input);
    const row: TestCase = { input, expected };
    if (c.tags && c.tags.length) row.tags = c.tags;
    if (c.description) row.description = c.description;
    rows.push(row);
  }
  if (rows.length === 0) {
    throw new Error("No valid cases — each needs a non-empty input and expected answer");
  }

  const config = {
    name,
    judge: { provider: "claude-subscription", model: "sonnet" },
    rubric: (rubric ?? "").trim() || DEFAULT_RUBRIC,
    dataset: "./dataset.json",
  };

  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "eval.config.yaml"), stringifyYaml(config), "utf8");
  writeFileSync(join(dir, "dataset.json"), JSON.stringify(rows, null, 2) + "\n", "utf8");
  return { name: slug, displayName: name, total: rows.length };
}
