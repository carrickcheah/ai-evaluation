# ai-evaluation

A local, **config-driven** bot-accuracy eval tool. Point it at any bot via a project
config, give it questions + correct answers, click **Run**, and get a promptfoo-style
scorecard — graded by **Claude on your local subscription** (no API tokens).

It's "promptfoo-lite, subscription-powered": same config ergonomics (a YAML config + a
JSON dataset per project), but grading runs through the local `claude` CLI instead of the
paid API, and it stays minimal (model-based grading only).

## How it works

```
question (dataset.json) → ask the live bot (eval.config.yaml target)
                        → grade the answer vs the reference with `claude` (subscription)
                        → scorecard (pass/fail + score + reasoning + latency)
```

## Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- The `claude` CLI installed and **logged into a Claude Max subscription** on this machine
  (the grader shells out to it with **no `ANTHROPIC_API_KEY`**).

## Run it

```bash
# 1. configure (the target bot's key, etc.)
cp .env.example .env      # edit BOT_KEY if needed

# 2. backend (port 8787)
cd server && bun install && bun run dev

# 3. UI (port 5173, proxies /api → 8787) — in another terminal
cd ui && bun install && bun run dev
# open http://localhost:5173
```

CLI (no UI):

```bash
bun server/src/cli.ts projects          # list projects
bun server/src/cli.ts run flabee        # run + grade the whole dataset
bun server/src/cli.ts run flabee --limit 3
```

## Add a project

Create `projects/<name>/`:

- **`eval.config.yaml`** — the target bot (any HTTP endpoint), the judge, and the grading rubric.
- **`dataset.json`** — `[{ "input": "...", "expected": "...", "tags": [...], "description": "..." }]`.

`{{input}}` (the question) and `{{uid}}` (a fresh per-run session id) are substituted into the
request body; `answerPath` extracts the reply from the JSON response. See `projects/flabee/`.

## Layout

```
server/   Bun + Hono API: config loader, bot runner, subscription grader, eval loop, SSE, history
ui/       React + Vite: sidebar, Run page, promptfoo-style results table, History, Subscription
projects/ one folder per project (eval.config.yaml + dataset.json)
docs/     design + plan
guides/   eval + prompt-engineering reference
```

## Grading

Model-based only. The judge prompt = the project rubric + the question + the bot's answer +
the reference answer; the verdict is `{ pass, score (1–10), reason }`. The judge runs on the
Claude subscription via the `claude` CLI — **$0 in API tokens**. Default judge: `claude-sonnet-4-6`.
