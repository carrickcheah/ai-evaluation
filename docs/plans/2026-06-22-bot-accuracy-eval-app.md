# Bot Eval App — Design & Plan

- **Date:** 2026-06-22
- **Status:** Draft for review (v3 — generic & config-driven)
- **Project:** `/Users/carrickcheah/Project/root_ai/ai-evaluation` (standalone)
- **Method:** Claude prompt-eval, **model-based grading only**, run on the **local Claude subscription** (API forbidden)

---

## ✅ Confirmed decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Scope | **Generic & config-driven** — works for *any* project/bot. Flabee = one config, not hardcoded |
| 2 | Test-case format | **JSON** (`dataset.json`) |
| 3 | Config format | **YAML** (`eval.config.yaml`) |
| 4 | Grader | **Model-based only**, judge = **Claude Sonnet 4.6** |
| 5 | Grader auth | **Local Claude subscription** (`claude` CLI) — **no `ANTHROPIC_API_KEY`** (API forbidden) |
| 6 | Where it runs | **Local** machine |
| 7 | App login | **No** (local use) |
| 8 | UI | **Left sidebar** |
| 9 | Fix-back to knowledge | **v1 = find + show + export**; **v2 = one-click "Add to knowledgebase"** |

**Process:** finish planning → **user reviews this doc** → then build (M1→M5).

---

## 1. Goal

A **local, generic eval tool**: any developer points it at **any bot** (via a config file), gives it a set of questions + correct answers, clicks **Run**, and sees an accuracy scorecard — graded by **Claude on their subscription** (no API tokens). Flabee/Sonobee is just the **first sample project**.

---

## 2. What it does — 4 pieces

1. **Test set** (`dataset.json`) — questions + correct ("reference") answers.
2. **Bot runner** — calls the **target bot** defined in config (any HTTP endpoint).
3. **Model grader (subscription)** — Claude Sonnet 4.6 (via local `claude` CLI) compares *bot answer* vs *reference* → `{pass, score, reason}`.
4. **Scorecard** — overall % + per-question verdicts (with the judge's reasoning).

> Model-eval only. Subscription-powered (**$0 tokens**). Nothing project-specific in the code.

---

## 3. Project format (the core of "generic")

An expert defines a **project folder** — no code:

```
projects/flabee/
  eval.config.yaml     # what to test + how to grade
  dataset.json         # the questions + correct answers
```

**`eval.config.yaml`**
```yaml
name: flabee-bot
target:                                   # the bot under test — ANY http endpoint
  url: https://api.nexgpt.nexerp.io/api/chat/sync
  method: POST
  headers: { X-API-Key: "${BOT_KEY}" }
  body: { message: "{{input}}", account_id: 14, session_id: "{{uid}}" }
  answerPath: output                      # where the reply sits in the JSON response
judge:
  provider: claude-subscription           # local claude CLI — no API key
  model: claude-sonnet-4-6
rubric: |                                 # per-project pass rule
  PASS if factually consistent with `expected`. Prices must match (range ok).
  Reply must be in the same language as the input.
dataset: ./dataset.json
```

**`dataset.json`**
```json
[
  { "input": "Berapa harga 5D scan?",
    "expected": "5D scan RM75–148.40 (varies by branch)",
    "tags": ["price","ms"] },
  { "input": "How much is a KUB scan?",
    "expected": "RM135–241.70",
    "tags": ["price","en"] }
]
```

**Why this format:** `target` is config → the same tool tests any bot by swapping `url`/`body`. `{{input}}` is the question, `{{uid}}` a per-case unique id (fresh session + phone — fixes the "already answered" bug). `answerPath` extracts the reply from any response shape.

---

## 4. Architecture

```
  ADMIN (browser)     ai-evaluation backend (Bun+Hono)              external
   │  pick project,        │                                          │
   │  click Run            │ 1. load eval.config.yaml + dataset.json   │
   ├──────────────────────>│ 2. for each case:                        │
   │                       │      call target bot (config) ──────────>│ any bot URL
   │                       │      answer  <───────────────────────────│
   │                       │ 3. GRADE via local `claude` CLI ──────────┐
   │                       │    {input, answer, expected, rubric}      │ subscription
   │                       │    → {pass, score, reason}  <─────────────┘ (no API key)
   │                       │ 4. aggregate → score + verdicts           │
   │  SSE progress +       │ 5. save run to history (JSON)             │
   │  scorecard            │                                          │
   │<──────────────────────┤                                          │
```
- **`server/`** — Bun + Hono. Loads projects, runs the loop, spawns `claude` for grading, stores runs.
- **`ui/`** — React 18 + Vite + TS, left-sidebar layout.

---

## 5. Screens (left sidebar)

**Run page**
```
┌──────────────┬──────────────────────────────────────────────┐
│  ⚡ ai-eval   │  🎯 Run Eval                                   │
│              │──────────────────────────────────────────────│
│ 🗂 Projects   │  Project:  flabee-bot                    [▼]   │
│ ▶ Run        │  Dataset:  67 cases · Judge: Sonnet 4.6 (sub)  │
│ 📊 History    │          ┌──────────────────┐                  │
│ 🔌 Subscript. │          │   ▶  Run          │                  │
│ ⚙  Settings   │          └──────────────────┘                  │
│              │  Last run: 22 Jun · 75% · [view →]              │
│ ───────────  │                                                │
│ ● claude     │                                                │
│   connected  │                                                │
└──────────────┴──────────────────────────────────────────────┘
```

**Result page** (the Claude method made visible — bot answer, reference, judge's reason)
```
│  Eval — flabee-bot — Result               22 Jun 2026 │
│  Judge: Claude Sonnet 4.6 · subscription · model-graded│
│  SCORE 75%    ✅ 50 pass   ❌ 17 fail      (target ≥90%) │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░                                   │
│  [All] [❌ Failed (17)]  tag ▼   🔍        [⬇ Export]   │
│  ❌ Berapa harga 5D scan?                    price · ms │
│     🤖 bot:     "RM107.80…"                             │
│     📋 correct: "5D scan RM75–148.40…"                  │
│     ⚖ judge:    FAIL · 3/10 — quoted an expired promo   │
│  ✅ Boleh walk-in untuk scan?                booking·ms │
│     ⚖ judge:    PASS · 9/10 — matches reference         │
```

Sidebar: **Projects · Run · History · Connect Subscription · Settings**, with a live `claude` indicator.

---

## 6. Tech stack

| Layer | Choice |
|---|---|
| Backend | Bun + Hono (TypeScript) |
| Judge | `@anthropic-ai/claude-agent-sdk` `query()` → spawns local `claude` CLI on the **Max subscription** (no API key) |
| Frontend | React 18 + Vite + TS + Tailwind/shadcn, sidebar layout |
| Run history | JSON files (`server/data/runs/`) v1 |
| Progress | SSE |

---

## 7. Backend API

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/projects` | GET | List project configs found in `projects/` |
| `/api/eval/run` | POST | Run `{ project }` → SSE progress + final result |
| `/api/eval/runs` | GET / `:id` | Run history + detail |
| `/api/subscription/{status,connect,disconnect}` | GET/POST | `claude` CLI detection + on/off *(copied from ai-contact-bun)* |

---

## 8. Bot runner (config-driven target)

Builds the request from `target` in the config: substitute `{{input}}` (question) + `{{uid}}` (unique id) into `body`/`headers`, POST to `url`, extract the reply via `answerPath`. **Unique `{{uid}}` per case** → fresh session/phone (fixes "I already answered that").

---

## 9. Model grader — Claude Sonnet 4.6 on the subscription

One grading call per answer via the local `claude` CLI:
- **Prompt:** the project `rubric` + `input` + `bot answer` + `expected`. Judge **reasons first** (`<thinking>`) then outputs `{pass, score, reason}`.
- **Default judge:** `claude-sonnet-4-6` (rigorous on facts).
- **Auth:** spawn `claude` with **no `ANTHROPIC_API_KEY`** → uses the Max login. Reuses `ai_brain/src/api/subscription.ts` (`detectClaudeCli`) + `brain/runner.ts` subscription path + `ConnectSubscriptionPage.tsx`.
- ⚠️ **No prefill+stop-sequence** to force JSON (the notebook's trick **400s on Sonnet 4.6**). Use **structured output / ask-for-JSON + parse with retry**.
- Keep `EVAL_CONCURRENCY` ≈ 3 (subscription rate limits). Tokens = **$0**.

---

## 10. Config (`.env`)

```
BOT_KEY=<key for the target bot, referenced as ${BOT_KEY} in config>
JUDGE_MODEL=claude-sonnet-4-6
EVAL_CONCURRENCY=3
# NO ANTHROPIC_API_KEY — grading uses the local `claude` subscription.
# Prereq: `claude` CLI installed + logged into a Claude Max account on this machine.
```

---

## 11. The improvement loop (how results improve a knowledgebase)

The eval **finds** problems; **you fix them in the project's own knowledge source**, then re-run to prove it.

```
1. RUN  →  score + ❌ failures (each with the judge's reason)
2. Each ❌ tells you exactly what's wrong + why
3. FIX in the project's knowledge tool — NOT the raw DB:
      • stale price  → update the Continuous Knowledge article (re-embeds for you)
      • missing      → add a new Continuous Knowledge article
      • wrong/mixed  → split/clarify the article
      • wrong lang / **bold** → fix the BOT's instruction (prompt), not the KB
4. RE-RUN  →  score rises ──repeat until ≥90%──┐
        └──────────────────────────────────────┘
```

- **v1:** the app shows + exports the failures; you apply fixes in the target's own admin UI (for Flabee: the nexgpt **Continuous Knowledge** page, which writes `kb_articles` + re-embeds pgvector — never raw SQL).
- **v2 (optional, per-project):** a **"➕ Add correct answer to knowledgebase"** button writes the reference answer straight into the project's KB via its API (e.g. chat_now), closing the loop in-app. Requires a configured write-back endpoint.

> The eval never edits a DB directly. Fixes go through the knowledge tool so the text is **re-embedded** — otherwise the bot's RAG wouldn't find it.

---

## 12. Build milestones

| # | Milestone | Output |
|---|---|---|
| M1 | Server + config/dataset loader + **config-driven bot runner** | CLI: load a project, ask the target bot 1 question |
| M2 | **Sonnet-4.6 subscription grader** + run loop | CLI: run a project, print score + failures |
| M3 | REST + SSE progress + run history + subscription status/connect | `curl` a run w/ live progress; saved result |
| M4 | **React UI + sidebar** — Projects / Run / Result / Connect Subscription | Click Run → progress → scorecard |
| M5 | Polish: failed-only filter, tag filter, search, export, history | Shippable local v1 |
| v2 | "Add to knowledgebase" write-back button | One-click fix → re-run |

---

## 13. Out of scope (v1)

Code/syntax graders; human grading; auto-schedule + alerts; app login; token-cost guard (subscription = free); in-UI dataset editing; the v2 write-back button.

---

## 14. To copy/adapt from `ai-contact-bun`

| From | Use for |
|---|---|
| `ui/src/components/settings/ConnectSubscriptionPage.tsx` + `ui/src/hooks/useSubscription.ts` | Connect-Subscription page + hooks |
| `ai_brain/src/api/subscription.ts` | `detectClaudeCli()` + pref file + status endpoints |
| `ai_brain/src/brain/runner.ts` (subscription path) | spawn `claude` with no API key → Max login |

---

## 15. Success criteria (measurable)

Specific, Measurable, Achievable, Relevant. For a project like Flabee:
- **Accuracy ≥ 90%** of test cases graded *correct* (price = correct range; rule = correct number)
- **Language match** to the customer's question
- **No stale/invented facts**; **no markdown `**bold**`** (WhatsApp-safe)
- Track score across runs — every fix should raise it.

---

## 16. Grading best practices (from the guides)

- Clear **rubric** (reference answer + explicit pass rule) per project.
- **Empirical output:** pass/fail (+1–10), never vague prose.
- **Reason first, then verdict** — a score-only shortcut yields lazy middling scores.
- ⚠️ **No prefill+stop-sequence** (400 on Claude 4.6) — use structured output + parse/retry.
- **Grade with a stronger model than the one tested** (bot ≈ Haiku-class; judge = Sonnet) to reduce self-grading bias.

---

## 17. References

| Doc | Path | Used for |
|---|---|---|
| Build evaluations | `guides/build-evaluations.md` | success criteria; eval design; grading methods + LLM-grading tips; golden-answer pattern |
| Prompt engineering | `guides/prompt-engineering.md` | grader-prompt quality; **prefill deprecation on 4.6**; "say what to do, not what not to do" (later bold→prose fix) |
| Course notebook | `~/Downloads/001_prompt_evals_grader.ipynb` | Python blueprint `run_prompt → grade_by_model → run_eval`; ported to TS, target = live bot, grade on subscription, against a reference answer |
