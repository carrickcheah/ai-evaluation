# Plan: Eval Automation Agent

- **Date:** 2026-06-22
- **Status:** Draft for review (brainstorm — do NOT implement until approved)
- **Goal:** An AI agent that **automates the eval lifecycle** — generate test cases → run → analyze failures → propose/apply fixes → re-run → monitor — so the tedious, judgement-heavy parts stop being manual.

## Decisions (2026-06-22)

- **Scope:** the **full closed loop** (§2) **+ monitor/mine real chats** (P3+P4) — the complete vision, built incrementally.
- **Autonomy:** **L3 auto-apply** — but only under the **mandatory guardrails in §10** (this is a live healthcare bot; unguarded auto-apply is unsafe).
- **Generation source:** **uploaded docs** (price lists, policy PDFs) for test-case generation; **real chat transcripts** for the mining phase.
- **Runtime:** Claude **Agent SDK on the subscription** (no API tokens) — same path as the grader.
- **Reuse:** copy/adapt proven code from `ai-contact-bun` (§9) — it's a *separate project*, so we vendor the patterns, not cross-import.

---

## 1. Why an agent (not just scripts)

The manual eval loop today is: hand-write a dataset → click Run → read failures → guess what to fix → edit knowledge → re-run. The hard, repetitive parts are **judgement tasks** Claude is good at:
- writing realistic test questions + correct reference answers,
- reading a pile of failures and diagnosing *why* (stale price? missing answer? wrong language?),
- deciding the smallest knowledge edit that fixes each cluster.

An **agent with tools** can chain these autonomously: it decides which tool to call next (generate → run → analyze → fix → re-run) instead of us scripting every step. It runs on the **Claude subscription via the Agent SDK** (`@anthropic-ai/claude-agent-sdk`, the same `claude`-CLI/subscription path our grader uses → **$0 API tokens**).

---

## 2. The lifecycle it automates

```
  ┌─────────────────────────────────────────────────────────────┐
  │ 1. GENERATE  test cases from a knowledge source              │
  │              (FAQ / website / docs / real chat transcripts)  │
  │ 2. RUN       the eval against the live bot (existing loop)   │
  │ 3. ANALYZE   cluster failures, diagnose root cause           │
  │ 4. PROPOSE   the smallest knowledge fix per cluster          │
  │ 5. APPLY*    write the fix to the knowledge source  (*gated) │
  │ 6. RE-RUN    prove the score rose; summarize                 │
  │ 7. MONITOR   schedule runs, alert on regressions, mine new   │
  │              cases from real conversations                   │
  └──────────────────────────── loop ──────────────────────────┘
```

---

## 3. Agent tools (wrap our existing primitives + a few new)

The agent is given a small, abstract toolset (it composes them itself):

| Tool | Backed by | Notes |
|---|---|---|
| `generate_dataset(source, n, focus)` | Claude | synthesize Q&A test cases + reference answers from a knowledge source; writes a project `dataset.json` |
| `list_projects` / `get_project` | existing config loader | |
| `run_eval(project)` | **existing run loop** | returns the scorecard |
| `get_run(id)` / `list_runs` | **existing history (SQLite)** | the agent reads failures + reasons |
| `analyze_run(id)` | Claude reasoning over `get_run` | cluster + diagnose failures |
| `propose_fixes(id)` | Claude | a ranked list of knowledge edits |
| `apply_fix(target, edit)` | knowledge write-back (**gated**) | e.g. Flabee → Continuous Knowledge via chat_now API; generic → per-project source |
| `schedule_eval(project, cron)` | new scheduler | periodic runs |
| `mine_cases(source)` | Claude | turn real conversations into test cases (the QA-pair mining we discussed) |

Grading itself stays the existing model-grader; the agent never grades — it orchestrates.

---

## 4. Autonomy levels (human-in-the-loop spectrum)

| Level | What the agent does | Human role | Fit |
|---|---|---|---|
| **L1 Assist** | generate datasets + analyze failures + *suggest* fixes | runs + applies everything | safest |
| **L2 Semi-auto** *(recommended start)* | generate + run + propose fixes; **waits for approval** to apply | approves/edits each fix | good for a healthcare bot |
| **L3 Auto** | scheduled run → auto-apply *safe* fixes → alert on the rest | reviews after the fact | most autonomous; needs strong guardrails |

**Recommendation:** start at **L2 with an approval gate** — the agent does the thinking and prepares the fixes, but a human OKs any change to a live healthcare bot's knowledge.

---

## 5. Architecture

- **Backend agent runner** — a Hono endpoint (e.g. `POST /api/agent/run`) that drives an Agent-SDK `query()` loop on the **subscription** (no API key), with the tools above exposed as in-process SDK tools (`createSdkMcpServer`, as in ai-contact-bun). Streams the agent's steps/tool-calls over SSE (reuse our SSE pattern).
- **UI** — an **"Agent" page** in the sidebar: pick a goal ("Generate a test set for project X", "Find & fix what's failing", "Audit the bot"), watch the agent's steps live, approve proposed fixes.
- **Storage** — agent runs / proposed fixes / approvals persist in SQLite (new tables), alongside eval runs.

---

## 6. Phases (incremental — one capability at a time)

| Phase | Capability | Output |
|---|---|---|
| **P1** | **Dataset generator** (biggest pain = writing tests) | agent turns a knowledge source into a `dataset.json` (Q + reference), reviewable before save |
| **P2** | **Failure analyst** (read-only) | agent reads a run → clusters + diagnoses failures → ranked fix suggestions |
| **P3** | **Closed loop** (L2) | agent proposes fixes → human approves → `apply_fix` → auto re-run → before/after score |
| **P4** | **Monitor + mine** | scheduled runs + regression alerts + turning real conversations into new test cases |

Each phase ships through our normal flow (typecheck + tests + review + browser test → commit/push).

---

## 7. Open questions (need your answers to finalize)

1. **Primary job to start** — which is most valuable first: (a) generate test cases, (b) analyze failures + suggest fixes, (c) the full closed loop, (d) monitor/mine real chats?
2. **Autonomy** — L1 assist, L2 semi-auto (approval gate, recommended), or L3 auto-apply?
3. **Where it runs** — on-demand ("Ask the agent" button) and/or scheduled (cron)?
4. **Generation source** — what does the agent generate test cases *from*? (the tenant's FAQ table, the crawled website, uploaded docs, or real chat transcripts?)
5. **Apply target** — for auto/semi-auto fixes, where does the agent write? (Flabee → Continuous Knowledge via chat_now API; or generic per-project — needs a configured write-back endpoint.)
6. **Run mechanism** — confirm: Agent SDK with in-process tools on the **subscription** (no API tokens), like the grader.

---

## 8. Risks

- **Auto-fixing a live healthcare bot's knowledge** is the highest risk → that's why L2 (approval gate) is recommended; never auto-apply to a medical KB without review.
- **Generation quality** — agent-written test cases / reference answers must themselves be reviewed (garbage in → misleading scores). Keep a human review of generated datasets (P1).
- **Subscription rate limits** — $0 tokens, but a long agent loop (generate 50 + run + analyze) makes many `claude` calls; keep concurrency modest and steps bounded.
- **Scope** — this is a sizeable feature; build it phase-by-phase (P1 first), same as the promptfoo-page plan.

---

## 9. Reuse from `ai-contact-bun` (separate project → copy/adapt, do NOT cross-import)

Studied the sibling repo for code we can vendor into `ai-evaluation`:

| Need | Source in ai-contact-bun | What to copy / adapt | New dep |
|---|---|---|---|
| **Scheduled monitoring** (P4) | `ai_brain/src/cron/memory-scheduler.ts`, `cron/scheduler.ts` | the `croner` pattern — `new Cron(expr, { timezone }, fn)` job registration + jitter + start/stop registry | **`croner`** |
| **Agent loop on subscription** | `ai_brain/src/brain/runner.ts` (`query()` from `@anthropic-ai/claude-agent-sdk`, in-process tools, subscription auth) | a slim runner: drive an agent `query()` with our tools, **no `ANTHROPIC_API_KEY`** (subscription), stream steps | **`@anthropic-ai/claude-agent-sdk`** |
| **Agent tool definitions** | `ai_brain/src/agents/admin-tools.ts` (`createSdkMcpServer` + `tool(name, desc, schema, handler)`) | the exact pattern for our tools: `generate_dataset`, `run_eval`, `get_run`, `propose_fixes`, `apply_fix`, `mine_cases` | (same SDK) |
| **Mine real chats → cases** (P4) | `ai_brain/src/cron/memory-jobs/knowledge-miner.ts` — `buildTranscript()`, `MINER_SYSTEM_PROMPT`, `parseMinerOutput()`, `scrubPii()`; + `chat_now/src/services/kb-mining.ts` (pgvector dedup) | copy `buildTranscript`/`parseMinerOutput`/`scrubPii`; **adapt the miner prompt to emit TEST CASES (Q + reference) instead of knowledge**; reuse the dedup idea (simplified) | — |
| **Generate from uploaded docs** (P1) | no direct parser exists; the `claude` CLI / Agent SDK **reads PDFs + text natively** | new: a multipart **upload endpoint** → pass the doc to the agent's `generate_dataset` tool. (`ai_brain/src/scripts/website/*` crawler is reusable later if we add a website source) | — |
| **Subscription connect** | `ConnectSubscriptionPage.tsx` + `api/subscription.ts` | already mirrored in our app | — |

> Adds two deps to `server/package.json`: `croner` and `@anthropic-ai/claude-agent-sdk`. Both run on the **subscription** (no API key), consistent with our grader.

---

## 10. L3 auto-apply guardrails (MANDATORY — live healthcare bot)

L3 auto-apply was chosen, so these are required, not optional:

1. **Soft layer only** — auto-apply edits ONLY to the RAG/Continuous-Knowledge layer; **never** the verbatim FAQ rail, and **never** prices or medical-rule numbers (those are human-approval-only — they're the volatile/high-risk facts).
2. **Verify-or-rollback** — every auto-applied fix is immediately followed by an auto **re-run**; if the score does not improve (or any case regresses), the change is **auto-reverted**.
3. **Change cap** — at most *N* auto-changes per cycle; anything beyond queues for human review.
4. **Full audit + one-click revert** — every change logged (what / why / before→after score) and individually revertible.
5. **Shadow mode first** — the agent runs **propose-only** for an initial period; true auto-apply is enabled deliberately once trust is established.
6. **Kill switch** — a single toggle disables all auto-apply instantly.
