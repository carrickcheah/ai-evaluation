# Plan: Port promptfoo pages into ai-evaluation

- **Date:** 2026-06-22
- **Status:** DEFERRED — build incrementally, one page at a time (see Decision)
- **Goal:** Bring promptfoo's key pages into our app — `/setup`, `/redteam/setup` (with examples), the **View Results** nav, `/prompts`, `/datasets`, and a richer `/history`.

## Decision (2026-06-22)

**Focus the eval tool first; add these promptfoo pages one at a time later** (not the big-bang port). Recorded choices for when we resume:
- **Approach:** refactor toward promptfoo / rebuild-to-match in our stack (not a literal MUI vendor).
- **Storage:** ✅ **SQLite adopted now** (`server/db.ts`, `data/eval.db`) — runs + settings moved off JSON files; legacy JSON runs auto-imported on boot. This is the foundation for the queryable History/Datasets/Prompts pages.
- **Red Team:** subset first (a few attack categories, Claude-generated), expand to "all examples" later.
- **`/prompts`:** a reusable **rubric / reference-answer library**.
- **Order:** revisit page-by-page; nothing else from §5 is being built yet.

---

## 0. The core reality (read this first)

promptfoo's web app is **React + MUI (Material UI) + Zustand + react-router**, backed by a **substantial REST + SQLite backend** (a datasets store, a prompts store, an eval-job runner, and a server-side **red-team generation engine** with ~50+ attack plugins).

Our app is intentionally minimal: **React + plain CSS + Bun/Hono + JSON-file storage + subscription grading**, using a **project-folder model** (`eval.config.yaml` + `dataset.json`).

So "copy promptfoo code" has two possible meanings, and we must pick one:

| Option | What it means | Cost |
|---|---|---|
| **A. Literal vendor** | Copy promptfoo's `.tsx` files as-is → adopt **MUI + Zustand** + port the matching **backend endpoints/DB** | Large dep + architecture shift; two UI styles in one app; must replicate promptfoo's server |
| **B. Rebuild-to-match** *(recommended)* | Keep our stack; **rebuild each page in our plain-CSS style to look + behave like promptfoo** (as we already did for the results table) | More UI code, but consistent app, no MUI, backend stays ours |

**This plan assumes Option B** unless you choose A. Everything below maps each promptfoo page → the equivalent we'd build in our stack. promptfoo source paths are cited so we copy structure/UX/labels faithfully.

---

## 1. Page-by-page mapping

| Page | promptfoo source | What it does there | Our adaptation | New backend | Size |
|---|---|---|---|---|---|
| **Rich History** | `pages/history/History.tsx` | Sortable table of all evals with **Columns / Filters / Export / Search** toolbar; cols: Eval, Dataset, Provider, Prompt, Pass Rate, Pass Count, Fail Count, Raw score | Replace our History table with this richer one over our runs | extend run summary (below) | **M** |
| **View Results nav** | `components/Navigation.tsx` | Top-nav dropdowns: **Create** (Setup, Redteam Setup), **View Results** (Latest Eval, All Evals, Red Team Vulnerabilities, Media Library), plus Prompts/Datasets/History links | Restructure our sidebar into the same groups | — | **S** |
| **`/setup`** | `pages/eval-creator/` (20 files) | Wizard to build a config: prompts + providers + test cases | A **"New Project"** form that writes `eval.config.yaml` + `dataset.json` (target, judge, rubric, cases) | `POST /api/projects` (create/update) | **L** |
| **`/datasets`** | `pages/datasets/` | List/inspect/CRUD saved datasets | List all projects' datasets; view + **add/edit/delete test cases** in the UI | dataset CRUD endpoints | **M** |
| **`/prompts`** | `pages/prompts/` | Manage reusable prompts used across evals | ⚠️ **needs definition** — our app sends *questions to a live bot*, it doesn't manage prompt templates. Candidate meaning: a library of **rubrics / reference answers** reused across projects | prompts/rubric store | **M** (after we define it) |
| **`/redteam/setup`** | `pages/redteam/` (**68 files**) | Pick attack **plugins + strategies**, generate adversarial cases, run + produce a **vulnerability report** | Big: a plugin catalog UI + a **Claude-generated adversarial dataset** + run + report (details in §4) | redteam plugin catalog, generator, report store | **XL** |

Sizes: S ≈ hours, M ≈ 1 day, L ≈ 2–3 days, XL ≈ 1–2 weeks.

---

## 2. Backend / data-model additions

Our `RunResult`/`RunSummary` and project model need fields to fill promptfoo's columns and power the new pages:

- **Run summary** → add `datasetHash` (short hash of the dataset), `targetLabel` (e.g. `chat-sync:account-14`, our analog of promptfoo's "Provider"), and `promptSnippet` (the project's rubric or a representative input — our analog of "Prompt"), plus `rawScore` (sum of case scores). Powers the rich History columns.
- **Projects CRUD** → `GET /api/projects/:name` (full config), `POST /api/projects` (create), `PUT /api/projects/:name` (update) → writes `eval.config.yaml` + `dataset.json`. Powers `/setup` and `/datasets`.
- **Datasets CRUD** → reuse projects: edit `dataset.json` entries (add/edit/delete/reorder cases) via the project endpoints.
- **Prompts store** → only if we define `/prompts` (a JSON store of reusable rubrics/reference snippets).
- **Redteam** → `redteam/plugins` catalog (static), `POST /api/redteam/generate` (Claude synthesizes adversarial cases → a dataset), and the run reuses the normal eval loop with a "did the bot resist?" rubric; a report view reads the run.

---

## 3. Nav restructure (View Results)

Mirror promptfoo's `Navigation.tsx` groups, in our left sidebar:

```
⚡ ai-eval
  Create ▾            → Setup (/setup) · Red Team Setup (/redteam/setup)
  View Results ▾      → Latest Eval (newest run) · All Evals (/history)
                        · Red Team Vulnerabilities (/redteam/report) · Media Library*
  Prompts (/prompts)
  Datasets (/datasets)
  History (/history)
  Subscription
  ● claude connected
```
\* **Media Library** has no analog in our app (promptfoo stores generated images). Recommend **omit** unless you want it. Same question for promptfoo's **Model Audit** (omit).

---

## 4. Red Team — the big one (how it'd work on our model)

promptfoo's redteam generates adversarial inputs from **attack plugins** (jailbreak, prompt-injection, PII-leak, harmful-content, hallucination, etc.) + **strategies** (encodings, multi-turn, etc.), runs them against the target, and grades whether the target was exploited.

This **fits our subscription model**:
1. **`/redteam/setup`** — UI to pick plugins + strategies (catalog copied from promptfoo's config) + the target (a project's `target`). "Include all examples" = ship promptfoo's full plugin list with example seed attacks.
2. **Generate** — `POST /api/redteam/generate` uses **Claude (subscription)** to synthesize N adversarial `input`s per selected plugin, each with `expected = "the bot must refuse / not comply / not leak"`, written as a normal `dataset.json`.
3. **Run** — reuse the existing eval loop; the grader rubric becomes "did the bot RESIST this attack?" → pass = resisted, fail = vulnerable.
4. **Report** — `/redteam/report`: vulnerabilities grouped by plugin/severity (rebuild promptfoo's report view).

This is a **product-sized phase on its own** (promptfoo dedicates 68 files). Recommend doing it **last**, as Phase D, and possibly starting with a **subset of plugins** then expanding to "all examples."

---

## 5. Phased roadmap

| Phase | Scope | Why first |
|---|---|---|
| **A** | Rich **History** table + **View Results** nav restructure | Highest value, smallest effort, pure UI over data we already have |
| **B** | **`/setup`** project-creator + **`/datasets`** CRUD | Lets you create/edit projects in the UI (no hand-editing files) |
| **C** | **`/prompts`** | Only after we agree what a "prompt" means for us |
| **D** | **`/redteam/setup`** + generate + report (all examples) | Largest; a feature in itself; benefits from A–C being done |

Each phase ships through our normal flow: typecheck + unit tests + code review + browser test, then commit/push.

---

## 6. Open questions (need your answers to finalize)

1. **Option A or B?** Literal MUI vendor (drag in MUI + replicate promptfoo's backend), or rebuild-to-match in our plain-CSS stack (recommended)?
2. **Red Team** — full "all examples" build, or start with a handful of attack categories and expand? And confirm the target = the live bot (e.g. nexgpt account 14) being attacked + graded on resistance.
3. **What is a "prompt" in our app?** We test a live bot with questions; we don't manage prompt templates. Should `/prompts` be a library of **rubrics/reference answers**, or is it not applicable?
4. **Datasets** — do you want full in-UI editing of test cases (add/edit/delete), or read-only listing for now?
5. **Media Library & Model Audit** nav items — **omit** (no analog here), or stub them?
6. **Order** — is Phase A→D the right priority, or do you want Red Team earlier?

---

## 7. Out of scope / risks

- We will not replicate promptfoo's SQLite DB; storage stays JSON files (fine at our scale).
- Literal `.tsx` copying (Option A) is not recommended: MUI + Zustand + their server would double the surface and clash with our app.
- Red Team "all examples" depends on Claude-generated adversarial content; volume/quality must be eval-tuned and is the main risk/cost (still $0 tokens on subscription, but many generations).
