import { describe, it, expect } from "bun:test";
import { uidFor, substitute, getByPath } from "../bot-runner";
import { extractJson } from "../grader";
import { loadProject, listProjects } from "../config";

// config resolves ${BOT_KEY}; ensure it's present for the project-loading tests
process.env.BOT_KEY ??= "eval";

describe("uidFor", () => {
  it("is deterministic and prefixed", () => {
    expect(uidFor("hello")).toBe(uidFor("hello"));
    expect(uidFor("hello")).toMatch(/^eval-/);
    expect(uidFor("a")).not.toBe(uidFor("b"));
  });
});

describe("substitute", () => {
  it("replaces {{input}}/{{uid}} deeply, leaves other values", () => {
    const out = substitute(
      { message: "{{input}}", session_id: "{{uid}}", account_id: 14, arr: ["{{input}}"] },
      { input: "hi", uid: "x1" },
    );
    expect(out).toEqual({ message: "hi", session_id: "x1", account_id: 14, arr: ["hi"] });
  });
  it("leaves unknown placeholders intact", () => {
    expect(substitute("{{nope}}", { input: "hi", uid: "x" })).toBe("{{nope}}");
  });
});

describe("getByPath", () => {
  it("reads nested paths and returns undefined for missing", () => {
    expect(getByPath({ a: { b: "v" } }, "a.b")).toBe("v");
    expect(getByPath({ a: {} }, "a.b.c")).toBeUndefined();
    expect(getByPath({ output: "x" }, "output")).toBe("x");
  });
});

describe("extractJson", () => {
  it("parses clean JSON", () => {
    expect(extractJson('{"pass":true,"score":9}')).toEqual({ pass: true, score: 9 });
  });
  it("parses JSON wrapped in fences/prose", () => {
    expect(extractJson('Here:\n```json\n{"pass":false,"score":3}\n```')).toEqual({
      pass: false,
      score: 3,
    });
  });
  it("returns null on non-JSON", () => {
    expect(extractJson("no json here")).toBeNull();
  });
});

describe("project loading", () => {
  it("lists the flabee sample project", () => {
    expect(listProjects()).toContain("flabee");
  });
  it("loads and validates flabee (env resolved)", () => {
    const p = loadProject("flabee");
    expect(p.name).toBe("flabee-bot");
    expect(p.target.url).toContain("nexgpt");
    expect(p.target.headers?.["X-API-Key"]).toBe(process.env.BOT_KEY);
    expect(p.dataset.length).toBeGreaterThanOrEqual(10);
    expect(p.rubric).toContain("PASS");
  });
  it("throws on an unknown project", () => {
    expect(() => loadProject("does-not-exist")).toThrow();
  });
});
