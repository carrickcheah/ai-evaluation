# ai-evaluation — local dev servers (backend :8787 + UI :5173)
SERVER_PORT ?= 8787
UI_PORT ?= 5173
# Bot requests fired in parallel per run. 1 = gentle on the bot (no overload/
# timeouts), but slower. Bump for speed only against a bot that can take it.
EVAL_CONCURRENCY ?= 1

.PHONY: run down logs

## down: kill the related servers (backend + UI)
down:
	@echo "↓ stopping ai-evaluation (ports $(SERVER_PORT), $(UI_PORT))…"
	-@lsof -ti tcp:$(SERVER_PORT) 2>/dev/null | xargs kill -9 2>/dev/null || true
	-@lsof -ti tcp:$(UI_PORT) 2>/dev/null | xargs kill -9 2>/dev/null || true
	-@pkill -f "server/src/server.ts" 2>/dev/null || true
	@echo "✓ down"

## run: stop anything running, then start backend + UI in the background
run: down
	@echo "↑ starting backend (:$(SERVER_PORT)) + UI (:$(UI_PORT))…"
	@PORT=$(SERVER_PORT) EVAL_CONCURRENCY=$(EVAL_CONCURRENCY) nohup bun server/src/server.ts > /tmp/ai-eval-server.log 2>&1 &
	@cd ui && nohup bun run dev > /tmp/ai-eval-ui.log 2>&1 &
	@sleep 2
	@echo "✓ backend → http://localhost:$(SERVER_PORT)"
	@echo "✓ UI      → http://localhost:$(UI_PORT)"
	@echo "  logs:  make logs"

## logs: tail both server logs
logs:
	@tail -n 40 -f /tmp/ai-eval-server.log /tmp/ai-eval-ui.log
