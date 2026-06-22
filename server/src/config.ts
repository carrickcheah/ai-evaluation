/** Load and validate project configs (eval.config.yaml + dataset.json). */
import { parse as parseYaml } from "yaml";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
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

  const targetRaw = parsed.target as Record<string, unknown> | undefined;
  if (!targetRaw) throw new Error(`Project "${name}": missing "target" block`);
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
  const target: TargetConfig = {
    url: assertString(targetRaw.url, "target.url"),
    method: typeof targetRaw.method === "string" ? targetRaw.method : "POST",
    headers: (targetRaw.headers as Record<string, string>) ?? {},
    body: targetRaw.body,
    answerPath: assertString(targetRaw.answerPath, "target.answerPath"),
  };

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
